import {
  DuplicateServiceNameError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  CreateServiceInput,
  Service,
  ServiceStatus,
  UpdateServiceInput,
} from "../domain/types";
import { type ServiceRow, toService } from "./row-mapping";

const serviceColumns = `id, organization_id, name, duration_minutes,
  price_amount_cents, price_currency, status, version, created_at, updated_at`;

/**
 * Pliega el nombre del servicio para que la unicidad no dependa de mayúsculas
 * ni de espacios en los extremos. SQLite solo aplica `NOCASE` a ASCII, así que
 * la normalización se calcula aquí y se persiste, como en `contact_tags`.
 */
function normalizeServiceName(name: string): string {
  return name.trim().toLocaleLowerCase("es");
}

/**
 * Catálogo de servicios de la organización. Todo método recibe
 * `organizationId` como primer parámetro y lo incluye en su cláusula `WHERE`:
 * una consulta sin organización falla antes de tocar D1 (ADR-0006).
 */
export class ServiceRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Catálogo ordenado alfabéticamente. Sin `status` devuelve solo los activos,
   * que es lo que necesita quien va a vender; el panel pide `all` para poder
   * reactivar un servicio archivado.
   */
  async list(
    organizationId: string,
    options: { status?: ServiceStatus | "all" } = {},
  ): Promise<Service[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "ServiceRepository.list",
    );
    const status = options.status ?? "active";
    const clauses = ["organization_id = ?"];
    const bindings: unknown[] = [scope];
    if (status !== "all") {
      clauses.push("status = ?");
      bindings.push(status);
    }

    const { results } = await this.#db
      .prepare(
        `SELECT ${serviceColumns} FROM services
          WHERE ${clauses.join(" AND ")}
          ORDER BY normalized_name, id`,
      )
      .bind(...bindings)
      .all<ServiceRow>();

    return results.map(toService);
  }

  /** Devuelve `null` fuera de la organización activa, nunca la fila ajena. */
  async findById(
    organizationId: string,
    serviceId: string,
  ): Promise<Service | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "ServiceRepository.findById",
    );
    const row = await this.#db
      .prepare(
        `SELECT ${serviceColumns} FROM services
          WHERE organization_id = ? AND id = ?`,
      )
      .bind(scope, serviceId)
      .first<ServiceRow>();

    return row === null ? null : toService(row);
  }

  /**
   * El nombre repetido se resuelve con `ON CONFLICT ... DO NOTHING`: sin fila
   * devuelta el nombre ya existe. Comprobarlo antes con un `SELECT` dejaría una
   * ventana entre verificar e insertar, y capturar el error de D1 obligaría a
   * interpretar su mensaje.
   */
  async create(
    organizationId: string,
    input: CreateServiceInput,
  ): Promise<Service> {
    const scope = requireOrganizationScope(
      organizationId,
      "ServiceRepository.create",
    );
    const now = new Date().toISOString();
    const name = input.name.trim();

    const row = await this.#db
      .prepare(
        `INSERT INTO services
           (id, organization_id, name, normalized_name, duration_minutes,
            price_amount_cents, price_currency, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (organization_id, normalized_name) DO NOTHING
         RETURNING ${serviceColumns}`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        name,
        normalizeServiceName(name),
        input.durationMinutes,
        input.priceAmountCents ?? null,
        input.priceCurrency ?? null,
        input.status ?? "active",
        now,
        now,
      )
      .first<ServiceRow>();

    if (row === null) {
      throw new DuplicateServiceNameError(name);
    }

    return toService(row);
  }

  /**
   * Concurrencia optimista como en `contacts`: sin la versión vigente la
   * edición se rechaza en vez de sobrescribir lo que otra persona acaba de
   * escribir. Un campo ausente se conserva.
   *
   * La colisión de nombre se comprueba dentro del mismo `UPDATE`, de modo que
   * no exista ventana entre verificar y escribir. Cuando no cambia ninguna
   * fila hay dos causas posibles y se distinguen después, para responder con
   * precisión sin revelar filas de otra organización.
   */
  async update(
    organizationId: string,
    serviceId: string,
    input: UpdateServiceInput,
  ): Promise<Service | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "ServiceRepository.update",
    );
    const current = await this.findById(scope, serviceId);
    if (current === null || current.version !== input.expectedVersion) {
      return null;
    }

    const name = input.name === undefined ? current.name : input.name.trim();
    const normalized = normalizeServiceName(name);
    const price =
      input.price === undefined
        ? {
            amountCents: current.priceAmountCents,
            currency: current.priceCurrency,
          }
        : input.price === null
          ? { amountCents: null, currency: null }
          : { amountCents: input.price.amountCents, currency: input.price.currency };

    const result = await this.#db
      .prepare(
        `UPDATE services
            SET name = ?, normalized_name = ?, duration_minutes = ?,
                price_amount_cents = ?, price_currency = ?, status = ?,
                version = version + 1, updated_at = ?
          WHERE organization_id = ? AND id = ? AND version = ?
            AND NOT EXISTS (SELECT 1 FROM services other
                             WHERE other.organization_id = services.organization_id
                               AND other.normalized_name = ?
                               AND other.id <> services.id)`,
      )
      .bind(
        name,
        normalized,
        input.durationMinutes ?? current.durationMinutes,
        price.amountCents,
        price.currency,
        input.status ?? current.status,
        new Date().toISOString(),
        scope,
        serviceId,
        input.expectedVersion,
        normalized,
      )
      .run();

    if (result.meta.changes !== 1) {
      const taken = await this.#db
        .prepare(
          `SELECT 1 AS taken FROM services
            WHERE organization_id = ? AND normalized_name = ? AND id <> ?`,
        )
        .bind(scope, normalized, serviceId)
        .first<{ taken: number }>();
      if (taken !== null) {
        throw new DuplicateServiceNameError(name);
      }
      return null;
    }

    return this.findById(scope, serviceId);
  }

  /**
   * Deja constancia de quién tocó el catálogo. Guarda el identificador del
   * servicio, nunca su precio: la auditoría no es un segundo lugar donde
   * acaben los datos del negocio.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    serviceId: string | null;
    action: "service.create" | "service.update";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "ServiceRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'service', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.serviceId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }
}
