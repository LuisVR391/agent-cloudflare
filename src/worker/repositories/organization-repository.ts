import { requireOrganizationScope } from "../domain/errors";
import type { CreateOrganizationInput, Organization } from "../domain/types";
import { type OrganizationRow, toOrganization } from "./row-mapping";

/**
 * Acceso a la tabla raíz del aislamiento. `organizations` es la única tabla
 * empresarial sin `organization_id`: su clave primaria cumple esa función.
 */
export class OrganizationRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async create(input: CreateOrganizationInput): Promise<Organization> {
    const now = new Date().toISOString();
    const row = await this.#db
      .prepare(
        `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        input.slug,
        input.displayName,
        input.status ?? "active",
        now,
        now,
      )
      .first<OrganizationRow>();

    if (row === null) {
      throw new Error("No se pudo crear la organización.");
    }

    return toOrganization(row);
  }

  async findById(organizationId: string): Promise<Organization | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "OrganizationRepository.findById",
    );

    const row = await this.#db
      .prepare(`SELECT * FROM organizations WHERE id = ?`)
      .bind(scope)
      .first<OrganizationRow>();

    return row === null ? null : toOrganization(row);
  }

  async findBySlug(slug: string): Promise<Organization | null> {
    const row = await this.#db
      .prepare(`SELECT * FROM organizations WHERE slug = ?`)
      .bind(slug)
      .first<OrganizationRow>();

    return row === null ? null : toOrganization(row);
  }

  /**
   * Cambia la zona horaria con la que se interpreta la agenda. El identificador
   * IANA se valida antes de llegar aquí: es entrada no confiable y decide qué
   * citas se ven, no solo cómo se dibujan.
   *
   * Las marcas de tiempo ya guardadas no se tocan. Siguen siendo el mismo
   * instante; lo que cambia es el día al que se asignan al mostrarlas.
   */
  async updateTimeZone(
    organizationId: string,
    timeZone: string,
  ): Promise<Organization | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "OrganizationRepository.updateTimeZone",
    );

    const row = await this.#db
      .prepare(
        `UPDATE organizations SET time_zone = ?, updated_at = ?
          WHERE id = ?
          RETURNING *`,
      )
      .bind(timeZone, new Date().toISOString(), scope)
      .first<OrganizationRow>();

    return row === null ? null : toOrganization(row);
  }

  /**
   * Deja constancia de quién cambió la configuración de la organización, con el
   * mismo formato que el resto de superficies del panel.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    action: "organization.update";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "OrganizationRepository.recordAudit",
    );

    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'organization', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        scope,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  async deleteById(organizationId: string): Promise<void> {
    const scope = requireOrganizationScope(
      organizationId,
      "OrganizationRepository.deleteById",
    );

    await this.#db
      .prepare("DELETE FROM organizations WHERE id = ?")
      .bind(scope)
      .run();
  }
}
