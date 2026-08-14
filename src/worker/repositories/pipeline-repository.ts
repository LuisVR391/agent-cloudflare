import {
  LastPipelineStageError,
  StageOrderMismatchError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  Pipeline,
  PipelineStage,
  PipelineWithStages,
  SemanticColor,
} from "../domain/types";
import {
  type PipelineRow,
  type PipelineStageRow,
  toPipeline,
  toPipelineStage,
} from "./row-mapping";

const pipelineColumns = `id, organization_id, name, template_key, version,
  created_at, updated_at`;
const stageColumns = `id, organization_id, pipeline_id, name, position, color,
  created_at, updated_at`;

/**
 * Plantilla del pipeline inicial de salón de belleza, según la guía §16.3.
 * Es la definición canónica para una organización nueva; `migrations/0013`
 * reproduce exactamente este contenido para las ya instaladas, y
 * `test/pipelines.test.ts` compara ambos caminos. Cambiar una etapa aquí sin
 * cambiarla allí deja organizaciones distintas según cuándo se crearon.
 */
export const initialPipelineTemplate = {
  key: "beauty-salon-initial",
  name: "Pipeline de salón",
  stages: [
    { name: "Nuevo contacto", color: "neutral" },
    { name: "Servicio identificado", color: "info" },
    { name: "Prospecto calificado", color: "info" },
    { name: "Información enviada", color: "info" },
    { name: "Cita propuesta", color: "warning" },
    { name: "Cita agendada", color: "warning" },
    { name: "Cita confirmada", color: "success" },
    { name: "Servicio realizado", color: "success" },
    { name: "Seguimiento posterior", color: "info" },
    { name: "Próximo retoque", color: "info" },
    { name: "Cliente recurrente", color: "success" },
    { name: "Oportunidad perdida", color: "danger" },
  ] satisfies Array<{ name: string; color: SemanticColor }>,
} as const;

/**
 * Pipelines y etapas de la organización. Todo método recibe `organizationId`
 * como primer parámetro y lo incluye en su cláusula `WHERE`: una consulta sin
 * organización falla antes de tocar D1 (ADR-0006).
 *
 * Toda mutación de la configuración pasa por la versión del pipeline. Sin ella
 * dos reordenamientos simultáneos podrían intercalarse y dejar posiciones
 * incoherentes sin que nada lo detectara.
 */
export class PipelineRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Siembra el pipeline inicial. Es idempotente por dos vías: el índice único
   * de plantilla impide un segundo pipeline sembrado, y las etapas solo se
   * insertan si el pipeline aún no tiene ninguna. Un pipeline al que alguien
   * borró etapas no las recupera: reconstruirlas revertiría una edición
   * deliberada.
   */
  async seedInitial(organizationId: string): Promise<PipelineWithStages> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.seedInitial",
    );
    const now = new Date().toISOString();

    await this.#db
      .prepare(
        `INSERT INTO pipelines
           (id, organization_id, name, template_key, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         -- El predicado repite el del índice parcial: sin él, SQLite no
         -- reconoce a qué restricción se refiere la resolución de conflicto.
         ON CONFLICT (organization_id, template_key)
           WHERE template_key IS NOT NULL DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        initialPipelineTemplate.name,
        initialPipelineTemplate.key,
        now,
        now,
      )
      .run();

    const pipeline = await this.#db
      .prepare(
        `SELECT ${pipelineColumns} FROM pipelines
          WHERE organization_id = ? AND template_key = ?`,
      )
      .bind(scope, initialPipelineTemplate.key)
      .first<PipelineRow>();
    if (pipeline === null) throw new Error("PIPELINE_SEED_FAILED");

    // Cada etapa comprueba su propio nombre dentro de la misma sentencia que
    // escribe, así que dos instalaciones simultáneas no producen veinticuatro
    // etapas. La condición es por etapa y no «si el pipeline ya tiene alguna»:
    // dentro de un lote, la segunda sentencia ya vería la primera insertada y
    // se descartaría a sí misma.
    await this.#db.batch(
      initialPipelineTemplate.stages.map((stage, index) =>
        this.#db
          .prepare(
            `INSERT INTO pipeline_stages
               (id, organization_id, pipeline_id, name, position, color,
                created_at, updated_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?
              WHERE NOT EXISTS (
                SELECT 1 FROM pipeline_stages existing
                 WHERE existing.organization_id = ? AND existing.pipeline_id = ?
                   AND existing.name = ?
              )`,
          )
          .bind(
            crypto.randomUUID(),
            scope,
            pipeline.id,
            stage.name,
            index + 1,
            stage.color,
            now,
            now,
            scope,
            pipeline.id,
            stage.name,
          ),
      ),
    );

    const seeded = await this.find(scope, pipeline.id);
    if (seeded === null) throw new Error("PIPELINE_SEED_FAILED");
    return seeded;
  }

  /** Pipelines de la organización con sus etapas en orden. */
  async list(organizationId: string): Promise<PipelineWithStages[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.list",
    );
    const { results: pipelines } = await this.#db
      .prepare(
        `SELECT ${pipelineColumns} FROM pipelines
          WHERE organization_id = ?
          ORDER BY created_at, id`,
      )
      .bind(scope)
      .all<PipelineRow>();
    if (pipelines.length === 0) return [];

    const { results: stages } = await this.#db
      .prepare(
        `SELECT ${stageColumns} FROM pipeline_stages
          WHERE organization_id = ?
          ORDER BY pipeline_id, position, id`,
      )
      .bind(scope)
      .all<PipelineStageRow>();

    const grouped = new Map<string, PipelineStage[]>();
    for (const row of stages) {
      const list = grouped.get(row.pipeline_id) ?? [];
      list.push(toPipelineStage(row));
      grouped.set(row.pipeline_id, list);
    }

    return pipelines.map((row) => ({
      ...toPipeline(row),
      stages: grouped.get(row.id) ?? [],
    }));
  }

  /** Devuelve `null` fuera de la organización activa, nunca la fila ajena. */
  async find(
    organizationId: string,
    pipelineId: string,
  ): Promise<PipelineWithStages | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.find",
    );
    const pipeline = await this.#db
      .prepare(
        `SELECT ${pipelineColumns} FROM pipelines
          WHERE organization_id = ? AND id = ?`,
      )
      .bind(scope, pipelineId)
      .first<PipelineRow>();
    if (pipeline === null) return null;

    const { results } = await this.#db
      .prepare(
        `SELECT ${stageColumns} FROM pipeline_stages
          WHERE organization_id = ? AND pipeline_id = ?
          ORDER BY position, id`,
      )
      .bind(scope, pipelineId)
      .all<PipelineStageRow>();

    return { ...toPipeline(pipeline), stages: results.map(toPipelineStage) };
  }

  /** Renombra el pipeline. `null` cuando la versión ya no es la vigente. */
  async rename(
    organizationId: string,
    pipelineId: string,
    input: { expectedVersion: number; name: string },
  ): Promise<PipelineWithStages | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.rename",
    );
    const now = new Date().toISOString();
    const result = await this.#db
      .prepare(
        `UPDATE pipelines
            SET name = ?, version = version + 1, updated_at = ?
          WHERE organization_id = ? AND id = ? AND version = ?`,
      )
      .bind(input.name.trim(), now, scope, pipelineId, input.expectedVersion)
      .run();
    if (result.meta.changes !== 1) return null;

    return this.find(scope, pipelineId);
  }

  /**
   * Agrega una etapa al final. La posición se calcula dentro de la misma
   * sentencia, a partir de las etapas del propio pipeline, para que dos altas
   * simultáneas no reciban la misma: la versión del pipeline solo deja pasar
   * una de ellas.
   */
  async addStage(
    organizationId: string,
    pipelineId: string,
    input: { expectedVersion: number; name: string; color?: SemanticColor },
  ): Promise<PipelineWithStages | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.addStage",
    );
    const now = new Date().toISOString();
    const [version] = await this.#db.batch([
      this.#versionBump(scope, pipelineId, input.expectedVersion, now),
      this.#db
        .prepare(
          `INSERT INTO pipeline_stages
             (id, organization_id, pipeline_id, name, position, color,
              created_at, updated_at)
           SELECT ?, ?, ?, ?,
                  (SELECT COALESCE(MAX(position), 0) + 1 FROM pipeline_stages
                    WHERE organization_id = ? AND pipeline_id = ?),
                  ?, ?, ?
            ${this.#appliedClause()}`,
        )
        .bind(
          crypto.randomUUID(),
          scope,
          pipelineId,
          input.name.trim(),
          scope,
          pipelineId,
          input.color ?? "neutral",
          now,
          now,
          ...this.#appliedBindings(scope, pipelineId, input.expectedVersion, now),
        ),
    ]);
    if (version.meta.changes !== 1) return null;

    return this.find(scope, pipelineId);
  }

  /** Renombra o recolorea una etapa. `null` si la etapa no es de este pipeline. */
  async updateStage(
    organizationId: string,
    pipelineId: string,
    stageId: string,
    input: { expectedVersion: number; name?: string; color?: SemanticColor },
  ): Promise<PipelineWithStages | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.updateStage",
    );
    const current = await this.#findStage(scope, pipelineId, stageId);
    if (current === null) return null;

    const now = new Date().toISOString();
    const [version, stage] = await this.#db.batch([
      this.#versionBump(scope, pipelineId, input.expectedVersion, now),
      this.#db
        .prepare(
          `UPDATE pipeline_stages
              SET name = ?, color = ?, updated_at = ?
            WHERE organization_id = ? AND pipeline_id = ? AND id = ?
              AND EXISTS (SELECT 1 FROM pipelines
                           WHERE organization_id = ? AND id = ?
                             AND version = ? AND updated_at = ?)`,
        )
        .bind(
          input.name === undefined ? current.name : input.name.trim(),
          input.color ?? current.color,
          now,
          scope,
          pipelineId,
          stageId,
          scope,
          pipelineId,
          input.expectedVersion + 1,
          now,
        ),
    ]);
    if (version.meta.changes !== 1 || stage.meta.changes !== 1) return null;

    return this.find(scope, pipelineId);
  }

  /**
   * Reasigna las posiciones en un solo lote. La lista debe enumerar
   * exactamente las etapas vigentes: una parcial dejaría posiciones huérfanas y
   * una con etapas ajenas cruzaría el aislamiento.
   */
  async reorderStages(
    organizationId: string,
    pipelineId: string,
    input: { expectedVersion: number; stageIds: string[] },
  ): Promise<PipelineWithStages | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.reorderStages",
    );
    const pipeline = await this.find(scope, pipelineId);
    if (pipeline === null) return null;

    const current = pipeline.stages.map((stage) => stage.id);
    const requested = new Set(input.stageIds);
    if (
      requested.size !== input.stageIds.length ||
      requested.size !== current.length ||
      current.some((id) => !requested.has(id))
    ) {
      throw new StageOrderMismatchError(pipelineId);
    }

    const now = new Date().toISOString();
    const [version] = await this.#db.batch([
      this.#versionBump(scope, pipelineId, input.expectedVersion, now),
      ...input.stageIds.map((stageId, index) =>
        this.#db
          .prepare(
            `UPDATE pipeline_stages
                SET position = ?, updated_at = ?
              WHERE organization_id = ? AND pipeline_id = ? AND id = ?
                AND EXISTS (SELECT 1 FROM pipelines
                             WHERE organization_id = ? AND id = ?
                               AND version = ? AND updated_at = ?)`,
          )
          .bind(
            index + 1,
            now,
            scope,
            pipelineId,
            stageId,
            scope,
            pipelineId,
            input.expectedVersion + 1,
            now,
          ),
      ),
    ]);
    if (version.meta.changes !== 1) return null;

    return this.find(scope, pipelineId);
  }

  /**
   * Borra una etapa y compacta las posiciones siguientes. La última no se
   * borra: un pipeline sin etapas no puede recibir oportunidades y la siembra
   * no lo repuebla.
   */
  async removeStage(
    organizationId: string,
    pipelineId: string,
    stageId: string,
    expectedVersion: number,
  ): Promise<PipelineWithStages | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "PipelineRepository.removeStage",
    );
    const pipeline = await this.find(scope, pipelineId);
    if (pipeline === null) return null;
    const target = pipeline.stages.find((stage) => stage.id === stageId);
    if (target === undefined) return null;
    if (pipeline.stages.length === 1) {
      throw new LastPipelineStageError(pipelineId);
    }

    const now = new Date().toISOString();
    const remaining = pipeline.stages.filter((stage) => stage.id !== stageId);
    const [version, removal] = await this.#db.batch([
      this.#versionBump(scope, pipelineId, expectedVersion, now),
      this.#db
        .prepare(
          `DELETE FROM pipeline_stages
            WHERE organization_id = ? AND pipeline_id = ? AND id = ?
              AND EXISTS (SELECT 1 FROM pipelines
                           WHERE organization_id = ? AND id = ?
                             AND version = ? AND updated_at = ?)`,
        )
        .bind(
          scope,
          pipelineId,
          stageId,
          scope,
          pipelineId,
          expectedVersion + 1,
          now,
        ),
      ...remaining.map((stage, index) =>
        this.#db
          .prepare(
            `UPDATE pipeline_stages
                SET position = ?, updated_at = ?
              WHERE organization_id = ? AND pipeline_id = ? AND id = ?
                AND EXISTS (SELECT 1 FROM pipelines
                             WHERE organization_id = ? AND id = ?
                               AND version = ? AND updated_at = ?)`,
          )
          .bind(
            index + 1,
            now,
            scope,
            pipelineId,
            stage.id,
            scope,
            pipelineId,
            expectedVersion + 1,
            now,
          ),
      ),
    ]);
    if (version.meta.changes !== 1 || removal.meta.changes !== 1) return null;

    return this.find(scope, pipelineId);
  }

  /**
   * Deja constancia de quién reconfiguró el pipeline. Guarda identificadores,
   * nunca el contenido comercial de la etapa.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    pipelineId: string;
    action:
      | "pipeline.update"
      | "pipeline.stage.create"
      | "pipeline.stage.update"
      | "pipeline.stage.delete"
      | "pipeline.stages.reorder";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "PipelineRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'pipeline', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.pipelineId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  #findStage(organizationId: string, pipelineId: string, stageId: string) {
    return this.#db
      .prepare(
        `SELECT ${stageColumns} FROM pipeline_stages
          WHERE organization_id = ? AND pipeline_id = ? AND id = ?`,
      )
      .bind(organizationId, pipelineId, stageId)
      .first<PipelineStageRow>()
      .then((row) => (row === null ? null : toPipelineStage(row)));
  }

  #versionBump(
    organizationId: string,
    pipelineId: string,
    expectedVersion: number,
    now: string,
  ) {
    return this.#db
      .prepare(
        `UPDATE pipelines
            SET version = version + 1, updated_at = ?
          WHERE organization_id = ? AND id = ? AND version = ?`,
      )
      .bind(now, organizationId, pipelineId, expectedVersion);
  }

  /**
   * Sonda que la fila quedó como la dejó esta operación. La versión sola no
   * basta: otra petición podría haber alcanzado el mismo número, así que se
   * compara también el instante que escribió este lote.
   */
  #appliedClause(): string {
    return `WHERE EXISTS (SELECT 1 FROM pipelines
              WHERE organization_id = ? AND id = ? AND version = ? AND updated_at = ?)`;
  }

  #appliedBindings(
    organizationId: string,
    pipelineId: string,
    expectedVersion: number,
    now: string,
  ): unknown[] {
    return [organizationId, pipelineId, expectedVersion + 1, now];
  }
}

/** Tipo auxiliar para quien consume la plantilla sin importar el repositorio. */
export type InitialPipelineTemplate = typeof initialPipelineTemplate;
export type { Pipeline, PipelineStage, PipelineWithStages };
