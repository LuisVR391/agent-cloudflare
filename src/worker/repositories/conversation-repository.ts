import {
  AgentNotRunnableError,
  MembershipNotActiveInOrganizationError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  AttentionMode,
  ConversationMessage,
  ConversationStatus,
  ConversationSummary,
  PageCursor,
} from "../domain/types";

type SummaryRow = {
  id: string; organization_id: string; channel_id: string; contact_id: string;
  contact_display_name: string | null; contact_external_id: string;
  channel_display_name: string | null; status: ConversationStatus;
  attention_mode: AttentionMode; version: number; last_message_at: string;
  last_message_text: string | null; assignee_membership_id: string | null;
  assignee_user_id: string | null; assignee_name: string | null;
  agent_id: string | null; agent_name: string | null;
};

/** Filtro del inbox: una membresía concreta o las conversaciones sin dueño. */
export type AssigneeFilter =
  | { kind: "membership"; membershipId: string }
  | { kind: "unassigned" };
type MessageRow = {
  id: string; organization_id: string; conversation_id: string;
  direction: "incoming" | "outgoing"; sender_type: "customer" | "staff" | "system";
  sender_id: string | null; message_type: ConversationMessage["messageType"];
  text_content: string | null; status: ConversationMessage["status"]; occurred_at: string;
};
type AttachmentRow = {
  id: string; message_id: string;
  attachment_type: ConversationMessage["attachments"][number]["type"];
  content_type: string | null; byte_size: number | null; filename: string | null;
  status: "stored" | "rejected"; failure_reason: string | null;
};

// El responsable se resuelve a través de la membresía de la misma
// organización. Unir `users` directamente por el identificador guardado
// cruzaría el límite de aislamiento: `users` es una tabla global.
const summarySelect = `SELECT c.id, c.organization_id, c.channel_id, c.contact_id,
  ct.display_name AS contact_display_name, ci.external_id AS contact_external_id,
  ch.display_name AS channel_display_name, c.status, c.attention_mode, c.version,
  c.last_message_at, am.id AS assignee_membership_id,
  am.user_id AS assignee_user_id, au.name AS assignee_name,
  ag.id AS agent_id, ag.name AS agent_name,
  (SELECT m.text_content FROM messages m WHERE m.organization_id = c.organization_id
    AND m.conversation_id = c.id ORDER BY m.occurred_at DESC, m.id DESC LIMIT 1)
    AS last_message_text
 FROM conversations c
 JOIN contacts ct ON ct.organization_id = c.organization_id AND ct.id = c.contact_id
 JOIN contact_identities ci ON ci.organization_id = ct.organization_id
  AND ci.contact_id = ct.id AND ci.provider = 'whatsapp'
 JOIN communication_channels ch ON ch.organization_id = c.organization_id
  AND ch.id = c.channel_id
 LEFT JOIN memberships am ON am.organization_id = c.organization_id
  AND am.id = c.assigned_membership_id
 LEFT JOIN users au ON au.id = am.user_id
 LEFT JOIN agents ag ON ag.organization_id = c.organization_id
  AND ag.id = c.agent_id`;

function summary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id, organizationId: row.organization_id, channelId: row.channel_id,
    contactId: row.contact_id, contactDisplayName: row.contact_display_name,
    contactExternalId: row.contact_external_id, channelDisplayName: row.channel_display_name,
    status: row.status, attentionMode: row.attention_mode,
    // La membresía se muestra aunque haya dejado de estar activa: la
    // conversación sigue apuntando a alguien y fingir que está libre ocultaría
    // que nadie la tomó.
    assignee: row.assignee_membership_id && row.assignee_user_id
      ? {
          membershipId: row.assignee_membership_id,
          userId: row.assignee_user_id,
          name: row.assignee_name ?? "",
        }
      : null,
    // El agente se muestra aunque el modo ya no sea automático: la conversación
    // conserva a quién eligieron para atenderla, y reactivarlo no obliga a
    // elegirlo otra vez.
    agent: row.agent_id
      ? { id: row.agent_id, name: row.agent_name ?? "" }
      : null,
    version: row.version,
    lastMessageAt: row.last_message_at, lastMessageText: row.last_message_text,
  };
}

export class ConversationRepository {
  constructor(private readonly db: D1Database) {}

  async list(organizationId: string, options: {
    status?: ConversationStatus; assignee?: AssigneeFilter;
    limit: number; cursor?: PageCursor;
  }): Promise<{ conversations: ConversationSummary[]; nextCursor: PageCursor | null }> {
    const scope = requireOrganizationScope(organizationId, "ConversationRepository.list");
    const clauses = ["c.organization_id = ?"];
    const bindings: unknown[] = [scope];
    if (options.status) { clauses.push("c.status = ?"); bindings.push(options.status); }
    if (options.assignee?.kind === "unassigned") {
      clauses.push("c.assigned_membership_id IS NULL");
    } else if (options.assignee) {
      clauses.push("c.assigned_membership_id = ?");
      bindings.push(options.assignee.membershipId);
    }
    if (options.cursor) {
      clauses.push("(c.last_message_at < ? OR (c.last_message_at = ? AND c.id < ?))");
      bindings.push(options.cursor.timestamp, options.cursor.timestamp, options.cursor.id);
    }
    // Una fila extra revela si queda página siguiente sin una consulta de conteo.
    bindings.push(options.limit + 1);
    const { results } = await this.db.prepare(`${summarySelect}
      WHERE ${clauses.join(" AND ")}
      ORDER BY c.last_message_at DESC, c.id DESC LIMIT ?`)
      .bind(...bindings).all<SummaryRow>();
    const page = results.slice(0, options.limit).map(summary);
    const last = results.length > options.limit ? page.at(-1) : undefined;
    return {
      conversations: page,
      nextCursor: last ? { timestamp: last.lastMessageAt, id: last.id } : null,
    };
  }

  async find(organizationId: string, conversationId: string): Promise<ConversationSummary | null> {
    const scope = requireOrganizationScope(organizationId, "ConversationRepository.find");
    const row = await this.db.prepare(`${summarySelect}
      WHERE c.organization_id = ? AND c.id = ?`).bind(scope, conversationId).first<SummaryRow>();
    return row ? summary(row) : null;
  }

  async listMessages(organizationId: string, conversationId: string, options: {
    limit: number; cursor?: PageCursor;
  }): Promise<{ messages: ConversationMessage[]; nextCursor: PageCursor | null }> {
    const scope = requireOrganizationScope(organizationId, "ConversationRepository.listMessages");
    // El cursor compara la tupla completa que ordena la consulta. Comparar solo
    // `occurred_at` dejaba inalcanzables las filas empatadas que el límite
    // cortaba, y el canal emite timestamps con precisión de segundos.
    const cursorSql = options.cursor
      ? "AND (occurred_at < ? OR (occurred_at = ? AND id < ?))"
      : "";
    const probe = options.limit + 1;
    const bindings = options.cursor
      ? [scope, conversationId, options.cursor.timestamp, options.cursor.timestamp, options.cursor.id, probe]
      : [scope, conversationId, probe];
    const { results: probed } = await this.db.prepare(`SELECT id, organization_id,
      conversation_id, direction, sender_type, sender_id, message_type, text_content,
      status, occurred_at FROM messages
      WHERE organization_id = ? AND conversation_id = ? ${cursorSql}
      ORDER BY occurred_at DESC, id DESC LIMIT ?`).bind(...bindings).all<MessageRow>();
    const hasMore = probed.length > options.limit;
    const results = probed.slice(0, options.limit);
    if (results.length === 0) return { messages: [], nextCursor: null };
    // La consulta baja de nuevo a viejo, así que la última fila de la página es
    // la más antigua y de ella sale el cursor hacia atrás.
    const oldest = results.at(-1)!;
    const placeholders = results.map(() => "?").join(",");
    const attachments = await this.db.prepare(`SELECT id, message_id, attachment_type,
      content_type, byte_size, filename, status, failure_reason FROM message_attachments
      WHERE organization_id = ? AND message_id IN (${placeholders})`)
      .bind(scope, ...results.map((row) => row.id)).all<AttachmentRow>();
    const messages = results.map((row) => ({
      id: row.id, organizationId: row.organization_id, conversationId: row.conversation_id,
      direction: row.direction, senderType: row.sender_type, senderId: row.sender_id,
      messageType: row.message_type, text: row.text_content, status: row.status,
      occurredAt: row.occurred_at,
      attachments: attachments.results.filter((item) => item.message_id === row.id)
        .map((item) => ({
          id: item.id, type: item.attachment_type,
          contentType: item.content_type, byteSize: item.byte_size,
          filename: item.filename,
          status: item.status, failureReason: item.failure_reason,
        })),
    })).reverse();
    return {
      messages,
      nextCursor: hasMore ? { timestamp: oldest.occurred_at, id: oldest.id } : null,
    };
  }

  /**
   * Un mensaje concreto del hilo. La corrida del agente lo necesita para saber
   * qué disparó el trabajo y con qué correlación, sin recorrer la página del
   * historial.
   */
  async findMessage(
    organizationId: string,
    conversationId: string,
    messageId: string,
  ): Promise<Pick<
    ConversationMessage,
    "id" | "direction" | "messageType" | "text"
  > & { correlationId: string } | null> {
    const scope = requireOrganizationScope(
      organizationId, "ConversationRepository.findMessage");
    const row = await this.db.prepare(`SELECT id, direction, message_type,
      text_content, correlation_id FROM messages
      WHERE organization_id = ? AND conversation_id = ? AND id = ?`)
      .bind(scope, conversationId, messageId).first<{
        id: string;
        direction: ConversationMessage["direction"];
        message_type: ConversationMessage["messageType"];
        text_content: string | null;
        correlation_id: string;
      }>();
    return row
      ? {
          id: row.id,
          direction: row.direction,
          messageType: row.message_type,
          text: row.text_content,
          correlationId: row.correlation_id,
        }
      : null;
  }

  async upsertInbound(input: {
    organizationId: string; channelId: string; externalConversationId: string;
    externalContactId: string; contactPhoneNumber?: string | null;
    externalMessageId: string; platformMessageId: string;
    text: string | null; messageType?: ConversationMessage["messageType"];
    occurredAt: string; correlationId: string;
  }): Promise<{ conversationId: string; messageId: string }> {
    const scope = requireOrganizationScope(input.organizationId, "ConversationRepository.upsertInbound");
    const phoneNumber = input.contactPhoneNumber?.trim() || null;
    let contact = await this.findContact(scope, input.externalContactId);
    if (!contact) {
      const now = new Date().toISOString();
      const candidateId = crypto.randomUUID();
      await this.db.batch([
        this.db.prepare(`INSERT INTO contacts
          (id, organization_id, display_name, phone_number, status, created_at, updated_at)
          VALUES (?, ?, NULL, ?, 'active', ?, ?)`)
          .bind(candidateId, scope, phoneNumber, now, now),
        this.db.prepare(`INSERT OR IGNORE INTO contact_identities
          (id, organization_id, contact_id, provider, external_id, created_at, updated_at)
          VALUES (?, ?, ?, 'whatsapp', ?, ?, ?)`)
          .bind(crypto.randomUUID(), scope, candidateId, input.externalContactId, now, now),
      ]);
      contact = await this.findContact(scope, input.externalContactId);
      if (!contact) throw new Error("CONTACT_RESOLUTION_FAILED");
      if (contact.id !== candidateId) {
        await this.db.prepare(`DELETE FROM contacts WHERE organization_id = ? AND id = ?
          AND NOT EXISTS (SELECT 1 FROM contact_identities
            WHERE organization_id = ? AND contact_id = ?)`)
          .bind(scope, candidateId, scope, candidateId).run();
      }
    }
    // El canal completa el hueco, no corrige lo que una persona escribió: la
    // condición `IS NULL` deja intacta cualquier edición de la ficha.
    if (phoneNumber) {
      await this.db.prepare(`UPDATE contacts SET phone_number = ?, updated_at = ?
        WHERE organization_id = ? AND id = ? AND phone_number IS NULL`)
        .bind(phoneNumber, new Date().toISOString(), scope, contact.id).run();
    }
    const now = new Date().toISOString();
    const conversation = await this.db.prepare(`INSERT INTO conversations
      (id, organization_id, channel_id, contact_id, external_conversation_id, status,
       attention_mode, version, last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'open', 'human', 1, ?, ?, ?)
      ON CONFLICT (organization_id, channel_id, external_conversation_id)
      DO UPDATE SET last_message_at = MAX(last_message_at, excluded.last_message_at),
        updated_at = excluded.updated_at, version = version + 1 RETURNING id`)
      .bind(crypto.randomUUID(), scope, input.channelId, contact.id,
        input.externalConversationId, input.occurredAt, now, now).first<{ id: string }>();
    if (!conversation) throw new Error("CONVERSATION_RESOLUTION_FAILED");
    const message = await this.db.prepare(`INSERT INTO messages
      (id, organization_id, conversation_id, external_message_id, platform_message_id,
       direction, sender_type, message_type, text_content, status, correlation_id,
       occurred_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, 'incoming', 'customer', ?, ?, 'received', ?, ?, ?, ?)
      ON CONFLICT DO UPDATE SET updated_at = excluded.updated_at RETURNING id`)
      .bind(crypto.randomUUID(), scope, conversation.id, input.externalMessageId,
        input.platformMessageId, input.messageType ?? "text", input.text,
        input.correlationId, input.occurredAt, now, now)
      .first<{ id: string }>();
    if (!message) throw new Error("MESSAGE_PERSISTENCE_FAILED");
    return { conversationId: conversation.id, messageId: message.id };
  }

  /**
   * Crea la respuesta saliente y su entrega idempotente. `senderType` distingue
   * quién responde: una persona del equipo o el agente de la organización, cuyo
   * identificador viaja en `actorId`. La ruta humana no lo envía y conserva su
   * comportamiento.
   */
  async createOutgoing(input: {
    organizationId: string; conversationId: string; actorId: string;
    senderType?: "staff" | "system";
    clientRequestId: string; text: string; correlationId: string;
  }): Promise<{
    messageId: string;
    idempotencyKey: string;
    correlationId: string;
    created: boolean;
    messageStatus: ConversationMessage["status"];
    deliveryStatus: "pending" | "sending" | "sent" | "failed" | "delivery_unknown";
    lastErrorCode: string | null;
  }> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "ConversationRepository.createOutgoing",
    );
    const conversation = await this.find(scope, input.conversationId);
    if (!conversation) throw new Error("CONVERSATION_NOT_FOUND");
    const existing = await this.db.prepare(`SELECT m.id, m.text_content,
      m.status AS message_status, m.correlation_id, d.idempotency_key,
      d.status AS delivery_status, d.last_error_code
      FROM messages m
      JOIN outbound_message_deliveries d ON d.organization_id = m.organization_id
       AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.client_request_id = ?`)
      .bind(scope, input.clientRequestId)
      .first<{
        id: string;
        text_content: string;
        message_status: ConversationMessage["status"];
        correlation_id: string;
        idempotency_key: string;
        delivery_status: "pending" | "sending" | "sent" | "failed" | "delivery_unknown";
        last_error_code: string | null;
      }>();
    if (existing) {
      if (existing.text_content !== input.text) {
        throw new Error("IDEMPOTENCY_KEY_REUSED");
      }
      return {
        messageId: existing.id,
        idempotencyKey: existing.idempotency_key,
        correlationId: existing.correlation_id,
        created: false,
        messageStatus: existing.message_status,
        deliveryStatus: existing.delivery_status,
        lastErrorCode: existing.last_error_code,
      };
    }
    const messageId = crypto.randomUUID();
    const idempotencyKey = `${scope}:${input.clientRequestId}`;
    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare(`INSERT INTO messages
        (id, organization_id, conversation_id, client_request_id, direction, sender_type,
         sender_id, message_type, text_content, status, correlation_id, occurred_at,
         created_at, updated_at)
        VALUES (?, ?, ?, ?, 'outgoing', ?, ?, 'text', ?, 'queued', ?, ?, ?, ?)`)
        .bind(messageId, scope, input.conversationId, input.clientRequestId,
          input.senderType ?? "staff", input.actorId, input.text,
          input.correlationId, now, now, now),
      this.db.prepare(`INSERT INTO outbound_message_deliveries
        (id, organization_id, message_id, idempotency_key, status, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'pending', ?, ?)`)
        .bind(crypto.randomUUID(), scope, messageId, idempotencyKey, now, now),
      this.db.prepare(`UPDATE conversations SET last_message_at = ?, updated_at = ?,
        version = version + 1 WHERE organization_id = ? AND id = ?`)
        .bind(now, now, scope, input.conversationId),
    ]);
    return {
      messageId,
      idempotencyKey,
      correlationId: input.correlationId,
      created: true,
      messageStatus: "queued",
      deliveryStatus: "pending",
      lastErrorCode: null,
    };
  }

  async prepareEnqueueRetry(
    organizationId: string,
    messageId: string,
  ): Promise<boolean> {
    const scope = requireOrganizationScope(
      organizationId,
      "ConversationRepository.prepareEnqueueRetry",
    );
    const now = new Date().toISOString();
    const delivery = await this.db.prepare(`UPDATE outbound_message_deliveries
      SET status = 'pending', last_error_code = NULL, updated_at = ?
      WHERE organization_id = ? AND message_id = ?
        AND status = 'failed' AND last_error_code = 'QUEUE_ENQUEUE_FAILED'`)
      .bind(now, scope, messageId).run();
    if (delivery.meta.changes !== 1) return false;
    await this.db.prepare(`UPDATE messages SET status = 'queued', updated_at = ?
      WHERE organization_id = ? AND id = ?`)
      .bind(now, scope, messageId).run();
    return true;
  }

  async markEnqueueFailed(
    organizationId: string,
    messageId: string,
  ): Promise<void> {
    const scope = requireOrganizationScope(
      organizationId,
      "ConversationRepository.markEnqueueFailed",
    );
    const now = new Date().toISOString();
    await this.db.batch([
      this.db.prepare(`UPDATE outbound_message_deliveries SET status = 'failed',
        last_error_code = 'QUEUE_ENQUEUE_FAILED', updated_at = ?
        WHERE organization_id = ? AND message_id = ?`)
        .bind(now, scope, messageId),
      this.db.prepare(`UPDATE messages SET status = 'failed', updated_at = ?
        WHERE organization_id = ? AND id = ?`)
        .bind(now, scope, messageId),
    ]);
  }

  async recordHumanSendAudit(input: {
    organizationId: string;
    actorId: string;
    messageId: string;
    result: "allowed" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "ConversationRepository.recordHumanSendAudit",
    );
    await this.db.prepare(`INSERT INTO audit_logs
      (id, organization_id, actor_type, actor_id, action, resource_type,
       resource_id, result, correlation_id, occurred_at)
      VALUES (?, ?, 'staff', ?, 'conversation.message.send', 'message', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.messageId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      ).run();
  }

  /**
   * Cambia estado, modo de atención, responsable o agente con control
   * optimista. Un campo ausente conserva su valor; en el responsable y en el
   * agente, `null` lo retira.
   *
   * La actualización y su historial viajan en un solo lote —que D1 ejecuta
   * como transacción— y cada inserción comprueba que la conversación quedó en
   * la versión y el instante que esta operación escribió. Así el historial no
   * puede sobrevivir a una actualización que no ocurrió, ni registrar un
   * cambio que hizo otra petición.
   */
  async updateState(input: {
    organizationId: string; conversationId: string; expectedVersion: number;
    status?: ConversationStatus; attentionMode?: "automatic" | "human" | "paused";
    assigneeMembershipId?: string | null;
    agentId?: string | null;
    actorId: string; correlationId: string;
  }): Promise<ConversationSummary | null> {
    const scope = requireOrganizationScope(
      input.organizationId, "ConversationRepository.updateState");
    const current = await this.find(scope, input.conversationId);
    if (!current || current.version !== input.expectedVersion) return null;
    const now = new Date().toISOString();
    const previousAssignee = current.assignee?.membershipId ?? null;
    const nextAssignee = input.assigneeMembershipId === undefined
      ? previousAssignee
      : input.assigneeMembershipId;
    const nextStatus = input.status ?? current.status;
    const nextAttentionMode = input.attentionMode ?? current.attentionMode;
    const previousAgentId = current.agent?.id ?? null;
    const nextAgentId = input.agentId === undefined
      ? previousAgentId
      : input.agentId;
    // Responder automáticamente sin agente no es un estado posible, así que se
    // rechaza antes de tocar SQL en vez de escribir una conversación que el
    // runtime tendría que devolver a una persona en el primer mensaje.
    if (nextAttentionMode === "automatic" && nextAgentId === null) {
      throw new AgentNotRunnableError(null);
    }
    const applied = this.#appliedProbe();
    const appliedBindings = [
      scope, input.conversationId, input.expectedVersion + 1, now,
    ];

    // La configuración viva del agente solo se exige cuando la conversación
    // queda respondiendo sola. Archivar un agente no debe impedir devolver a
    // control humano una conversación que lo tenía asignado.
    const runnableGuard = nextAttentionMode === "automatic" ? nextAgentId : null;

    const statements = [
      // El responsable solo se escribe si es una membresía activa de esta
      // organización, y el agente solo queda respondiendo si sigue activo y con
      // versión publicada. Comprobarlo en la misma sentencia no deja ventana
      // entre verificar y escribir.
      this.db.prepare(`UPDATE conversations SET status = ?, attention_mode = ?,
        assigned_membership_id = ?, agent_id = ?, version = version + 1, updated_at = ?
        WHERE organization_id = ? AND id = ? AND version = ?
          AND (? IS NULL OR EXISTS (SELECT 1 FROM memberships m
                WHERE m.organization_id = conversations.organization_id
                  AND m.id = ? AND m.status = 'active'))
          AND (? IS NULL OR EXISTS (SELECT 1 FROM agents a
                JOIN agent_versions v ON v.organization_id = a.organization_id
                  AND v.agent_id = a.id AND v.status = 'published'
                WHERE a.organization_id = conversations.organization_id
                  AND a.id = ? AND a.status = 'active'))`)
        .bind(nextStatus, nextAttentionMode, nextAssignee, nextAgentId, now,
          scope, input.conversationId, input.expectedVersion,
          nextAssignee, nextAssignee, runnableGuard, runnableGuard),
      this.db.prepare(`INSERT INTO conversation_status_history
        (id, organization_id, conversation_id, actor_type, actor_id, previous_status,
         next_status, previous_attention_mode, next_attention_mode, correlation_id, occurred_at)
        SELECT ?, ?, ?, 'staff', ?, ?, ?, ?, ?, ?, ? ${applied}`)
        .bind(crypto.randomUUID(), scope, input.conversationId, input.actorId,
          current.status, nextStatus, current.attentionMode, nextAttentionMode,
          input.correlationId, now, ...appliedBindings),
    ];

    if (nextAssignee !== previousAssignee) {
      statements.push(this.db.prepare(`INSERT INTO conversation_assignments
        (id, organization_id, conversation_id, previous_membership_id,
         next_membership_id, actor_type, actor_id, correlation_id, occurred_at)
        SELECT ?, ?, ?, ?, ?, 'staff', ?, ?, ? ${applied}`)
        .bind(crypto.randomUUID(), scope, input.conversationId, previousAssignee,
          nextAssignee, input.actorId, input.correlationId, now, ...appliedBindings));
    }

    const [update] = await this.db.batch(statements);
    if (update.meta.changes !== 1) {
      // El lote no cambió nada: o la versión quedó obsoleta, o la membresía no
      // está activa aquí, o el agente no puede responder. Distinguirlo permite
      // responder con precisión sin revelar a quién pertenece un identificador
      // ajeno.
      if (nextAssignee && !(await this.#isActiveMembership(scope, nextAssignee))) {
        throw new MembershipNotActiveInOrganizationError(nextAssignee);
      }
      if (runnableGuard && !(await this.#isRunnableAgent(scope, runnableGuard))) {
        throw new AgentNotRunnableError(runnableGuard);
      }
      return null;
    }
    return this.find(scope, input.conversationId);
  }

  /**
   * Devuelve la conversación a control humano después de una corrida que no
   * pudo responder. No la escribe una persona, así que no hay `expectedVersion`
   * que exigir: la condición es que siga respondiendo sola, y una conversación
   * que alguien ya movió no se toca.
   *
   * El motivo no vive aquí. La traza de la corrida conserva el código y la
   * auditoría el resultado; el historial de estado solo registra que el sistema
   * devolvió la conversación al equipo.
   */
  async escalateToHuman(input: {
    organizationId: string; conversationId: string; correlationId: string;
  }): Promise<boolean> {
    const scope = requireOrganizationScope(
      input.organizationId, "ConversationRepository.escalateToHuman");
    const current = await this.find(scope, input.conversationId);
    if (!current || current.attentionMode !== "automatic") return false;
    const now = new Date().toISOString();
    const [update] = await this.db.batch([
      this.db.prepare(`UPDATE conversations SET attention_mode = 'human',
        version = version + 1, updated_at = ?
        WHERE organization_id = ? AND id = ? AND attention_mode = 'automatic'`)
        .bind(now, scope, input.conversationId),
      this.db.prepare(`INSERT INTO conversation_status_history
        (id, organization_id, conversation_id, actor_type, actor_id, previous_status,
         next_status, previous_attention_mode, next_attention_mode, correlation_id,
         occurred_at)
        SELECT ?, ?, ?, 'system', NULL, ?, ?, 'automatic', 'human', ?, ?
        ${this.#appliedProbe()}`)
        .bind(crypto.randomUUID(), scope, input.conversationId,
          current.status, current.status, input.correlationId, now,
          scope, input.conversationId, current.version + 1, now),
    ]);
    return update.meta.changes === 1;
  }

  /**
   * Sonda que la fila quedó como la dejó esta operación. La versión sola no
   * basta: otra petición podría haber alcanzado el mismo número.
   */
  #appliedProbe(): string {
    return `WHERE EXISTS (SELECT 1 FROM conversations
      WHERE organization_id = ? AND id = ? AND version = ? AND updated_at = ?)`;
  }

  #isRunnableAgent(organizationId: string, agentId: string) {
    return this.db.prepare(`SELECT 1 AS present FROM agents a
      JOIN agent_versions v ON v.organization_id = a.organization_id
        AND v.agent_id = a.id AND v.status = 'published'
      WHERE a.organization_id = ? AND a.id = ? AND a.status = 'active'`)
      .bind(organizationId, agentId).first<{ present: number }>()
      .then((row) => row !== null);
  }

  #isActiveMembership(organizationId: string, membershipId: string) {
    return this.db.prepare(`SELECT 1 AS present FROM memberships
      WHERE organization_id = ? AND id = ? AND status = 'active'`)
      .bind(organizationId, membershipId).first<{ present: number }>()
      .then((row) => row !== null);
  }

  private findContact(organizationId: string, externalId: string) {
    return this.db.prepare(`SELECT contacts.id FROM contacts JOIN contact_identities
      ON contact_identities.organization_id = contacts.organization_id
       AND contact_identities.contact_id = contacts.id
      WHERE contacts.organization_id = ? AND contact_identities.provider = 'whatsapp'
       AND contact_identities.external_id = ?`)
      .bind(organizationId, externalId).first<{ id: string }>();
  }
}
