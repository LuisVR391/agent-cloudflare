import { InvalidPersistedValueError, requireOrganizationScope } from "../domain/errors";
import type { AgentRun, AgentRunStatus } from "../domain/types";

type AgentRunRow = {
  id: string;
  organization_id: string;
  conversation_id: string;
  agent_id: string;
  agent_version_id: string;
  version_number: number;
  model: string;
  trigger_message_id: string;
  response_message_id: string | null;
  status: string;
  failure_code: string | null;
  correlation_id: string;
  started_at: string;
  finished_at: string | null;
};

const runStatuses: readonly AgentRunStatus[] = [
  "running",
  "succeeded",
  "failed",
  "skipped",
];

/**
 * El modelo y el ordinal se leen de la versión, que es inmutable: la traza no
 * los copia porque tendrían dos dueños.
 */
const runSelect = `SELECT r.id, r.organization_id, r.conversation_id, r.agent_id,
    r.agent_version_id, v.version_number, v.model, r.trigger_message_id,
    r.response_message_id, r.status, r.failure_code, r.correlation_id,
    r.started_at, r.finished_at
  FROM agent_runs r
  JOIN agent_versions v
    ON v.organization_id = r.organization_id AND v.id = r.agent_version_id`;

function toAgentRun(row: AgentRunRow): AgentRun {
  const status = runStatuses.find((candidate) => candidate === row.status);
  if (status === undefined) {
    throw new InvalidPersistedValueError("agent_runs.status", row.status);
  }
  return {
    id: row.id,
    organizationId: row.organization_id,
    conversationId: row.conversation_id,
    agentId: row.agent_id,
    agentVersionId: row.agent_version_id,
    agentVersionNumber: row.version_number,
    model: row.model,
    triggerMessageId: row.trigger_message_id,
    responseMessageId: row.response_message_id,
    status,
    failureCode: row.failure_code,
    correlationId: row.correlation_id,
    startedAt: row.started_at,
    finishedAt: row.finished_at,
  };
}

export class AgentRunRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Abre la traza antes de invocar al modelo. Devuelve `null` cuando otra
   * corrida ya tomó el mismo mensaje disparador: el índice único es lo que
   * impide que un reintento, un segundo vencimiento del buffer o dos
   * invocaciones concurrentes produzcan dos respuestas al contacto.
   */
  async start(input: {
    organizationId: string;
    conversationId: string;
    agentId: string;
    agentVersionId: string;
    triggerMessageId: string;
    correlationId: string;
    startedAt: string;
  }): Promise<string | null> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "AgentRunRepository.start",
    );
    const runId = crypto.randomUUID();
    const inserted = await this.db.prepare(`INSERT INTO agent_runs
      (id, organization_id, conversation_id, agent_id, agent_version_id,
       trigger_message_id, status, correlation_id, started_at)
      VALUES (?, ?, ?, ?, ?, ?, 'running', ?, ?)
      ON CONFLICT (organization_id, trigger_message_id) DO NOTHING
      RETURNING id`)
      .bind(
        runId,
        scope,
        input.conversationId,
        input.agentId,
        input.agentVersionId,
        input.triggerMessageId,
        input.correlationId,
        input.startedAt,
      ).first<{ id: string }>();
    return inserted?.id ?? null;
  }

  /** Cierra la traza con el mensaje que la corrida produjo. */
  async complete(input: {
    organizationId: string;
    runId: string;
    responseMessageId: string;
    finishedAt: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "AgentRunRepository.complete",
    );
    await this.db.prepare(`UPDATE agent_runs
      SET status = 'succeeded', response_message_id = ?, finished_at = ?
      WHERE organization_id = ? AND id = ? AND status = 'running'`)
      .bind(input.responseMessageId, input.finishedAt, scope, input.runId)
      .run();
  }

  /**
   * Cierra la traza sin respuesta. `failed` es lo que salió mal; `skipped` es lo
   * que no llegó a invocar al modelo porque no había nada que responder. Ambos
   * conservan un código estable, nunca el cuerpo del proveedor.
   */
  async close(input: {
    organizationId: string;
    runId: string;
    status: Extract<AgentRunStatus, "failed" | "skipped">;
    failureCode: string;
    finishedAt: string;
    /**
     * El mensaje que llegó a existir aunque la corrida no lo entregara. Sin él,
     * un fallo al encolar dejaría en el hilo un mensaje que ninguna traza
     * explica.
     */
    responseMessageId?: string | null;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "AgentRunRepository.close",
    );
    await this.db.prepare(`UPDATE agent_runs
      SET status = ?, failure_code = ?, finished_at = ?,
        response_message_id = COALESCE(?, response_message_id)
      WHERE organization_id = ? AND id = ? AND status = 'running'`)
      .bind(input.status, input.failureCode, input.finishedAt,
        input.responseMessageId ?? null, scope, input.runId)
      .run();
  }

  /**
   * Deja constancia de la corrida en la auditoría de la organización. El actor
   * es el sistema, y el agente es el recurso que actuó: ninguna persona
   * autorizó este envío en concreto, sino la configuración que alguien publicó.
   */
  async recordAudit(input: {
    organizationId: string;
    agentId: string;
    runId: string | null;
    result: "allowed" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "AgentRunRepository.recordAudit",
    );
    await this.db.prepare(`INSERT INTO audit_logs
      (id, organization_id, actor_type, actor_id, action, resource_type,
       resource_id, result, correlation_id, occurred_at)
      VALUES (?, ?, 'system', ?, 'conversation.agent.run', 'agent_run', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        scope,
        input.agentId,
        input.runId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      ).run();
  }

  /** Qué ocurrió con el mensaje que disparó una corrida. */
  async findByTriggerMessage(
    organizationId: string,
    triggerMessageId: string,
  ): Promise<AgentRun | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AgentRunRepository.findByTriggerMessage",
    );
    const row = await this.db.prepare(`${runSelect}
      WHERE r.organization_id = ? AND r.trigger_message_id = ?`)
      .bind(scope, triggerMessageId).first<AgentRunRow>();
    return row ? toAgentRun(row) : null;
  }
}
