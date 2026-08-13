import { requireOrganizationScope } from "../domain/errors";
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
  last_message_text: string | null;
};
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

const summarySelect = `SELECT c.id, c.organization_id, c.channel_id, c.contact_id,
  ct.display_name AS contact_display_name, ci.external_id AS contact_external_id,
  ch.display_name AS channel_display_name, c.status, c.attention_mode, c.version,
  c.last_message_at,
  (SELECT m.text_content FROM messages m WHERE m.organization_id = c.organization_id
    AND m.conversation_id = c.id ORDER BY m.occurred_at DESC, m.id DESC LIMIT 1)
    AS last_message_text
 FROM conversations c
 JOIN contacts ct ON ct.organization_id = c.organization_id AND ct.id = c.contact_id
 JOIN contact_identities ci ON ci.organization_id = ct.organization_id
  AND ci.contact_id = ct.id AND ci.provider = 'whatsapp'
 JOIN communication_channels ch ON ch.organization_id = c.organization_id
  AND ch.id = c.channel_id`;

function summary(row: SummaryRow): ConversationSummary {
  return {
    id: row.id, organizationId: row.organization_id, channelId: row.channel_id,
    contactId: row.contact_id, contactDisplayName: row.contact_display_name,
    contactExternalId: row.contact_external_id, channelDisplayName: row.channel_display_name,
    status: row.status, attentionMode: row.attention_mode, version: row.version,
    lastMessageAt: row.last_message_at, lastMessageText: row.last_message_text,
  };
}

export class ConversationRepository {
  constructor(private readonly db: D1Database) {}

  async list(organizationId: string, options: {
    status?: ConversationStatus; limit: number; cursor?: PageCursor;
  }): Promise<{ conversations: ConversationSummary[]; nextCursor: PageCursor | null }> {
    const scope = requireOrganizationScope(organizationId, "ConversationRepository.list");
    const clauses = ["c.organization_id = ?"];
    const bindings: unknown[] = [scope];
    if (options.status) { clauses.push("c.status = ?"); bindings.push(options.status); }
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

  async upsertInbound(input: {
    organizationId: string; channelId: string; externalConversationId: string;
    externalContactId: string; externalMessageId: string; platformMessageId: string;
    text: string | null; messageType?: ConversationMessage["messageType"];
    occurredAt: string; correlationId: string;
  }): Promise<{ conversationId: string; messageId: string }> {
    const scope = requireOrganizationScope(input.organizationId, "ConversationRepository.upsertInbound");
    let contact = await this.findContact(scope, input.externalContactId);
    if (!contact) {
      const now = new Date().toISOString();
      const candidateId = crypto.randomUUID();
      await this.db.batch([
        this.db.prepare(`INSERT INTO contacts
          (id, organization_id, display_name, status, created_at, updated_at)
          VALUES (?, ?, NULL, 'active', ?, ?)`).bind(candidateId, scope, now, now),
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

  async createOutgoing(input: {
    organizationId: string; conversationId: string; actorId: string;
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
        VALUES (?, ?, ?, ?, 'outgoing', 'staff', ?, 'text', ?, 'queued', ?, ?, ?, ?)`)
        .bind(messageId, scope, input.conversationId, input.clientRequestId,
          input.actorId, input.text, input.correlationId, now, now, now),
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

  async updateState(input: {
    organizationId: string; conversationId: string; expectedVersion: number;
    status?: ConversationStatus; attentionMode?: "human" | "paused";
    actorId: string; correlationId: string;
  }): Promise<ConversationSummary | null> {
    const current = await this.find(input.organizationId, input.conversationId);
    if (!current || current.version !== input.expectedVersion) return null;
    const now = new Date().toISOString();
    const result = await this.db.prepare(`UPDATE conversations SET status = ?,
      attention_mode = ?, version = version + 1, updated_at = ?
      WHERE organization_id = ? AND id = ? AND version = ?`)
      .bind(input.status ?? current.status, input.attentionMode ?? current.attentionMode,
        now, input.organizationId, input.conversationId, input.expectedVersion).run();
    if (result.meta.changes !== 1) return null;
    await this.db.prepare(`INSERT INTO conversation_status_history
      (id, organization_id, conversation_id, actor_type, actor_id, previous_status,
       next_status, previous_attention_mode, next_attention_mode, correlation_id, occurred_at)
      VALUES (?, ?, ?, 'staff', ?, ?, ?, ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), input.organizationId, input.conversationId, input.actorId,
        current.status, input.status ?? current.status, current.attentionMode,
        input.attentionMode ?? current.attentionMode, input.correlationId, now).run();
    return this.find(input.organizationId, input.conversationId);
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
