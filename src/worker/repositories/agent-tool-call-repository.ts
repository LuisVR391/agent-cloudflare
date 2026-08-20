import { requireOrganizationScope } from "../domain/errors";

/**
 * Traza de cada herramienta que una corrida intentó ejecutar (ADR-0017).
 *
 * `succeeded` es la ejecución que terminó; `rejected` es la decisión de
 * autorización que impidió ejecutar —no estaba anunciada, los argumentos no
 * validan—; `failed` es la ejecución autorizada que no terminó. Distinguirlos
 * importa: lo segundo es contención funcionando y lo tercero es una avería.
 */
export type AgentToolCallResult = "succeeded" | "rejected" | "failed";

/**
 * La auditoría de la organización conserva quién intentó qué y con qué
 * resultado; la tabla conserva qué ocurrió dentro de una corrida y en qué
 * orden. Se escriben juntas porque un intento sin una de las dos deja una
 * pregunta sin respuesta.
 */
const auditResults: Record<AgentToolCallResult, string> = {
  succeeded: "allowed",
  rejected: "rejected",
  failed: "failed",
};

export class AgentToolCallRepository {
  constructor(private readonly db: D1Database) {}

  /**
   * Deja constancia de un intento. Ni la tabla ni la auditoría reciben los
   * argumentos ni el resultado: los argumentos que propone el modelo pueden
   * arrastrar lo que la clienta escribió, y el resultado ya tiene dueño en
   * `services` y en `appointments`.
   *
   * `sequence` es el ordinal del intento dentro de su corrida, y el índice
   * único es lo que impide que un reintento duplique la traza; por eso el
   * conflicto no es un error, sino la garantía funcionando.
   */
  async record(input: {
    organizationId: string;
    runId: string;
    agentId: string;
    sequence: number;
    toolKey: string;
    result: AgentToolCallResult;
    /** Código estable y redactado. Obligatorio salvo en un intento que terminó. */
    failureCode: string | null;
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "AgentToolCallRepository.record",
    );
    const callId = crypto.randomUUID();
    const occurredAt = new Date().toISOString();
    await this.db.batch([
      this.db.prepare(`INSERT INTO agent_tool_calls
        (id, organization_id, run_id, sequence, tool_key, result, failure_code,
         correlation_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT (organization_id, run_id, sequence) DO NOTHING`)
        .bind(
          callId,
          scope,
          input.runId,
          input.sequence,
          input.toolKey,
          input.result,
          input.failureCode,
          input.correlationId,
          occurredAt,
        ),
      // El actor es el sistema y el agente es quien actuó: ninguna persona
      // autorizó este intento en concreto, sino la configuración que alguien
      // publicó.
      this.db.prepare(`INSERT INTO audit_logs
        (id, organization_id, actor_type, actor_id, action, resource_type,
         resource_id, result, correlation_id, occurred_at)
        VALUES (?, ?, 'system', ?, 'conversation.agent.tool', 'agent_tool_call',
          ?, ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          scope,
          input.agentId,
          callId,
          auditResults[input.result],
          input.correlationId,
          occurredAt,
        ),
    ]);
  }
}
