import {
  ContactNotInOrganizationError,
  ServiceNotInOrganizationError,
  StageNotInPipelineError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  CreateOpportunityInput,
  Opportunity,
  OpportunityDetail,
  OpportunityStageTransition,
  UpdateOpportunityInput,
} from "../domain/types";

type OpportunityRow = {
  id: string;
  organization_id: string;
  contact_id: string;
  contact_display_name: string | null;
  conversation_id: string | null;
  pipeline_id: string;
  stage_id: string;
  stage_name: string;
  stage_position: number;
  service_id: string | null;
  service_name: string | null;
  version: number;
  created_at: string;
  updated_at: string;
};

type TransitionRow = {
  id: string;
  previous_stage_id: string | null;
  previous_stage_name: string | null;
  next_stage_id: string;
  next_stage_name: string;
  actor_type: string;
  actor_id: string | null;
  correlation_id: string;
  occurred_at: string;
};

/**
 * Mostrar una oportunidad exige resolver contacto, etapa y servicio dentro de
 * la organización, que es el costo que ADR-0010 acepta a cambio de mantener los
 * tres estados separados. Se resuelven en la misma consulta para no producir
 * una lectura por tarjeta del tablero.
 */
const opportunitySelect = `SELECT o.id, o.organization_id, o.contact_id,
    c.display_name AS contact_display_name, o.conversation_id, o.pipeline_id,
    o.stage_id, s.name AS stage_name, s.position AS stage_position,
    o.service_id, sv.name AS service_name, o.version, o.created_at, o.updated_at
  FROM opportunities o
  JOIN contacts c
    ON c.organization_id = o.organization_id AND c.id = o.contact_id
  JOIN pipeline_stages s
    ON s.organization_id = o.organization_id AND s.id = o.stage_id
  LEFT JOIN services sv
    ON sv.organization_id = o.organization_id AND sv.id = o.service_id`;

function toOpportunity(row: OpportunityRow): Opportunity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    contactDisplayName: row.contact_display_name,
    conversationId: row.conversation_id,
    pipelineId: row.pipeline_id,
    stageId: row.stage_id,
    stageName: row.stage_name,
    stagePosition: row.stage_position,
    serviceId: row.service_id,
    serviceName: row.service_name,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTransition(row: TransitionRow): OpportunityStageTransition {
  return {
    id: row.id,
    previousStageId: row.previous_stage_id,
    previousStageName: row.previous_stage_name,
    nextStageId: row.next_stage_id,
    nextStageName: row.next_stage_name,
    actorType: row.actor_type === "system" ? "system" : "staff",
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at,
  };
}

/**
 * Oportunidades y su historial de etapa. Todo método recibe `organizationId`
 * como primer parámetro y lo incluye en su cláusula `WHERE`: una consulta sin
 * organización falla antes de tocar D1 (ADR-0006).
 */
export class OpportunityRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Crea la oportunidad y su primera transición en el mismo lote. Contacto,
   * etapa y servicio se toman de consultas ya filtradas por organización dentro
   * de la propia sentencia que inserta, así que no queda ventana entre
   * verificar y escribir; la etapa debe pertenecer además al pipeline indicado.
   */
  async create(
    organizationId: string,
    input: CreateOpportunityInput,
  ): Promise<OpportunityDetail> {
    const scope = requireOrganizationScope(
      organizationId,
      "OpportunityRepository.create",
    );
    const now = new Date().toISOString();
    const id = crypto.randomUUID();

    const pipelineId = input.pipelineId ?? (await this.#defaultPipeline(scope));
    if (pipelineId === null) throw new Error("PIPELINE_NOT_CONFIGURED");
    const stageId =
      input.stageId ?? (await this.#firstStage(scope, pipelineId));
    if (stageId === null) throw new StageNotInPipelineError("");

    const [insert] = await this.#db.batch([
      this.#db
        .prepare(
          `INSERT INTO opportunities
             (id, organization_id, contact_id, conversation_id, pipeline_id,
              stage_id, service_id, created_at, updated_at)
           SELECT ?, ?, contacts.id, ?, stage.pipeline_id, stage.id, ?, ?, ?
             FROM contacts
             JOIN pipeline_stages stage
               ON stage.organization_id = contacts.organization_id
              AND stage.id = ? AND stage.pipeline_id = ?
            WHERE contacts.organization_id = ? AND contacts.id = ?
              AND (? IS NULL OR EXISTS (
                    SELECT 1 FROM services sv
                     WHERE sv.organization_id = contacts.organization_id
                       AND sv.id = ?))
              AND (? IS NULL OR EXISTS (
                    SELECT 1 FROM conversations cv
                     WHERE cv.organization_id = contacts.organization_id
                       AND cv.id = ?))`,
        )
        .bind(
          id,
          scope,
          input.conversationId ?? null,
          input.serviceId ?? null,
          now,
          now,
          stageId,
          pipelineId,
          scope,
          input.contactId,
          input.serviceId ?? null,
          input.serviceId ?? null,
          input.conversationId ?? null,
          input.conversationId ?? null,
        ),
      this.#db
        .prepare(
          `INSERT INTO opportunity_stage_transitions
             (id, organization_id, opportunity_id, previous_stage_id,
              next_stage_id, actor_type, actor_id, correlation_id, occurred_at)
           SELECT ?, ?, ?, NULL, ?, 'staff', ?, ?, ?
            WHERE EXISTS (SELECT 1 FROM opportunities
                           WHERE organization_id = ? AND id = ?)`,
        )
        .bind(
          crypto.randomUUID(),
          scope,
          id,
          stageId,
          input.actorId,
          input.correlationId,
          now,
          scope,
          id,
        ),
    ]);

    // Sin filas candidatas no hubo inserción: alguna de las referencias no vive
    // en esta organización. Se distingue después para responder con precisión
    // sin revelar a quién pertenece un identificador ajeno.
    if (insert.meta.changes !== 1) {
      if (input.serviceId && !(await this.#serviceExists(scope, input.serviceId))) {
        throw new ServiceNotInOrganizationError(input.serviceId);
      }
      if (!(await this.#contactExists(scope, input.contactId))) {
        throw new ContactNotInOrganizationError(input.contactId);
      }
      throw new StageNotInPipelineError(stageId);
    }

    const created = await this.find(scope, id);
    if (created === null) throw new Error("OPPORTUNITY_CREATION_FAILED");
    return created;
  }

  /**
   * Oportunidades del pipeline, ordenadas por etapa y por actividad reciente.
   * El límite es explícito: el tablero anuncia cuántas muestra en vez de
   * recortar en silencio.
   */
  async listByPipeline(
    organizationId: string,
    pipelineId: string,
    options: { limit?: number } = {},
  ): Promise<Opportunity[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "OpportunityRepository.listByPipeline",
    );
    const { results } = await this.#db
      .prepare(
        `${opportunitySelect}
          WHERE o.organization_id = ? AND o.pipeline_id = ?
          ORDER BY s.position, o.updated_at DESC, o.id DESC
          LIMIT ?`,
      )
      .bind(scope, pipelineId, options.limit ?? 200)
      .all<OpportunityRow>();

    return results.map(toOpportunity);
  }

  /** Oportunidades de un contacto, para su ficha y para el hilo. */
  async listByContact(
    organizationId: string,
    contactId: string,
  ): Promise<Opportunity[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "OpportunityRepository.listByContact",
    );
    const { results } = await this.#db
      .prepare(
        `${opportunitySelect}
          WHERE o.organization_id = ? AND o.contact_id = ?
          ORDER BY o.updated_at DESC, o.id DESC
          LIMIT 50`,
      )
      .bind(scope, contactId)
      .all<OpportunityRow>();

    return results.map(toOpportunity);
  }

  /** Detalle con historial. `null` fuera de la organización activa. */
  async find(
    organizationId: string,
    opportunityId: string,
  ): Promise<OpportunityDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "OpportunityRepository.find",
    );
    const row = await this.#db
      .prepare(`${opportunitySelect} WHERE o.organization_id = ? AND o.id = ?`)
      .bind(scope, opportunityId)
      .first<OpportunityRow>();
    if (row === null) return null;

    const { results } = await this.#db
      .prepare(
        `SELECT t.id, t.previous_stage_id, previous.name AS previous_stage_name,
                t.next_stage_id, next.name AS next_stage_name, t.actor_type,
                t.actor_id, t.correlation_id, t.occurred_at
           FROM opportunity_stage_transitions t
           LEFT JOIN pipeline_stages previous
             ON previous.organization_id = t.organization_id
            AND previous.id = t.previous_stage_id
           JOIN pipeline_stages next
             ON next.organization_id = t.organization_id
            AND next.id = t.next_stage_id
          WHERE t.organization_id = ? AND t.opportunity_id = ?
          ORDER BY t.occurred_at DESC, t.id DESC`,
      )
      .bind(scope, opportunityId)
      .all<TransitionRow>();

    return { ...toOpportunity(row), transitions: results.map(toTransition) };
  }

  /**
   * Mueve la oportunidad y registra la transición en el mismo lote. La etapa
   * destino se valida contra el pipeline de la propia fila dentro del `UPDATE`:
   * una clave foránea simple demostraría que la etapa es de la organización,
   * pero no que pertenezca a este pipeline.
   *
   * Cambiar solo el servicio no registra transición: el historial explica el
   * recorrido comercial, no cada edición.
   */
  async update(
    organizationId: string,
    opportunityId: string,
    input: UpdateOpportunityInput,
  ): Promise<OpportunityDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "OpportunityRepository.update",
    );
    const current = await this.find(scope, opportunityId);
    if (current === null || current.version !== input.expectedVersion) {
      return null;
    }

    const now = new Date().toISOString();
    const nextStage = input.stageId ?? current.stageId;
    const nextService =
      input.serviceId === undefined ? current.serviceId : input.serviceId;

    // Sonda de que la fila quedó como la dejó esta operación: la versión sola no
    // basta, porque otra petición podría haber alcanzado el mismo número.
    const applied = `WHERE EXISTS (SELECT 1 FROM opportunities
      WHERE organization_id = ? AND id = ? AND version = ? AND updated_at = ?)`;
    const appliedBindings = [
      scope,
      opportunityId,
      input.expectedVersion + 1,
      now,
    ];

    const statements = [
      this.#db
        .prepare(
          `UPDATE opportunities
              SET stage_id = ?, service_id = ?, version = version + 1,
                  updated_at = ?
            WHERE organization_id = ? AND id = ? AND version = ?
              AND EXISTS (SELECT 1 FROM pipeline_stages stage
                           WHERE stage.organization_id = opportunities.organization_id
                             AND stage.id = ?
                             AND stage.pipeline_id = opportunities.pipeline_id)
              AND (? IS NULL OR EXISTS (
                    SELECT 1 FROM services sv
                     WHERE sv.organization_id = opportunities.organization_id
                       AND sv.id = ?))`,
        )
        .bind(
          nextStage,
          nextService,
          now,
          scope,
          opportunityId,
          input.expectedVersion,
          nextStage,
          nextService,
          nextService,
        ),
    ];

    if (nextStage !== current.stageId) {
      statements.push(
        this.#db
          .prepare(
            `INSERT INTO opportunity_stage_transitions
               (id, organization_id, opportunity_id, previous_stage_id,
                next_stage_id, actor_type, actor_id, correlation_id, occurred_at)
             SELECT ?, ?, ?, ?, ?, 'staff', ?, ?, ? ${applied}`,
          )
          .bind(
            crypto.randomUUID(),
            scope,
            opportunityId,
            current.stageId,
            nextStage,
            input.actorId,
            input.correlationId,
            now,
            ...appliedBindings,
          ),
      );
    }

    const [update] = await this.#db.batch(statements);
    if (update.meta.changes !== 1) {
      // El lote no cambió nada: o la versión quedó obsoleta, o una referencia no
      // es válida aquí. Distinguirlo permite responder con precisión.
      if (nextService && !(await this.#serviceExists(scope, nextService))) {
        throw new ServiceNotInOrganizationError(nextService);
      }
      if (!(await this.#stageInPipeline(scope, current.pipelineId, nextStage))) {
        throw new StageNotInPipelineError(nextStage);
      }
      return null;
    }

    return this.find(scope, opportunityId);
  }

  /**
   * Deja constancia de quién creó o movió la oportunidad. Guarda
   * identificadores, nunca el contenido comercial.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    opportunityId: string | null;
    action: "opportunity.create" | "opportunity.update";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "OpportunityRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'opportunity', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.opportunityId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  /** El pipeline sembrado, o el más antiguo si la plantilla ya no existe. */
  #defaultPipeline(organizationId: string): Promise<string | null> {
    return this.#db
      .prepare(
        `SELECT id FROM pipelines
          WHERE organization_id = ?
          ORDER BY template_key IS NULL, created_at, id
          LIMIT 1`,
      )
      .bind(organizationId)
      .first<{ id: string }>()
      .then((row) => row?.id ?? null);
  }

  #firstStage(
    organizationId: string,
    pipelineId: string,
  ): Promise<string | null> {
    return this.#db
      .prepare(
        `SELECT id FROM pipeline_stages
          WHERE organization_id = ? AND pipeline_id = ?
          ORDER BY position, id
          LIMIT 1`,
      )
      .bind(organizationId, pipelineId)
      .first<{ id: string }>()
      .then((row) => row?.id ?? null);
  }

  #stageInPipeline(
    organizationId: string,
    pipelineId: string,
    stageId: string,
  ): Promise<boolean> {
    return this.#db
      .prepare(
        `SELECT 1 AS present FROM pipeline_stages
          WHERE organization_id = ? AND pipeline_id = ? AND id = ?`,
      )
      .bind(organizationId, pipelineId, stageId)
      .first<{ present: number }>()
      .then((row) => row !== null);
  }

  #contactExists(organizationId: string, contactId: string): Promise<boolean> {
    return this.#db
      .prepare(
        `SELECT 1 AS present FROM contacts
          WHERE organization_id = ? AND id = ?`,
      )
      .bind(organizationId, contactId)
      .first<{ present: number }>()
      .then((row) => row !== null);
  }

  #serviceExists(organizationId: string, serviceId: string): Promise<boolean> {
    return this.#db
      .prepare(
        `SELECT 1 AS present FROM services
          WHERE organization_id = ? AND id = ?`,
      )
      .bind(organizationId, serviceId)
      .first<{ present: number }>()
      .then((row) => row !== null);
  }
}
