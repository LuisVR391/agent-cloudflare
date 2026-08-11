import { requireOrganizationScope } from "../domain/errors";

type ProviderStatus = "sent" | "delivered" | "read" | "failed";
type MessageStatus =
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "delivery_unknown";

type CandidateRow = {
  id: string;
  conversation_id: string;
  external_message_id: string | null;
  platform_message_id: string | null;
  status: MessageStatus;
  delivery_external_message_id: string | null;
};

type StatusEventRow = {
  status: ProviderStatus;
  occurred_at: string;
  platform_message_id: string | null;
};

export type StatusReconciliationResult =
  | {
      result: "reconciled";
      messageId: string;
      conversationId: string;
      status: MessageStatus;
    }
  | { result: "unmatched" | "ambiguous" };

function applyProviderStatus(
  current: MessageStatus,
  next: ProviderStatus,
): MessageStatus {
  if (next === "read") return "read";
  if (next === "delivered") return current === "read" ? current : "delivered";
  if (next === "sent") {
    return current === "delivered" || current === "read" ? current : "sent";
  }
  return current === "delivered" || current === "read" ? current : "failed";
}

export class MessageStatusReconciliationRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async recordAndReconcile(input: {
    organizationId: string;
    channelId: string;
    eventId: string;
    externalConversationId: string;
    externalMessageId: string;
    platformMessageId: string;
    status: ProviderStatus;
    occurredAt: string;
    recordedAt: string;
  }): Promise<StatusReconciliationResult> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "MessageStatusReconciliationRepository.recordAndReconcile",
    );
    await this.#db.prepare(`INSERT INTO message_status_events
      (id, organization_id, channel_id, external_event_id,
       conversation_external_id, message_external_id, platform_message_id,
       status, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (organization_id, external_event_id) DO NOTHING`)
      .bind(
        crypto.randomUUID(),
        scope,
        input.channelId,
        input.eventId,
        input.externalConversationId,
        input.externalMessageId,
        input.platformMessageId,
        input.status,
        input.occurredAt,
        input.recordedAt,
      ).run();

    const candidates = await this.#findCandidates({
      organizationId: scope,
      channelId: input.channelId,
      externalConversationId: input.externalConversationId,
      externalMessageId: input.externalMessageId,
      platformMessageId: input.platformMessageId,
    });
    if (candidates.length === 0) return { result: "unmatched" };
    if (candidates.length !== 1) return { result: "ambiguous" };

    return this.#reconcileCandidate({
      organizationId: scope,
      channelId: input.channelId,
      externalConversationId: input.externalConversationId,
      candidate: candidates[0],
      externalMessageId: input.externalMessageId,
      platformMessageId: input.platformMessageId,
      reconciledAt: input.recordedAt,
    });
  }

  async reconcileLinkedMessage(input: {
    organizationId: string;
    channelId: string;
    externalConversationId: string;
    messageId: string;
    reconciledAt: string;
  }): Promise<StatusReconciliationResult> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "MessageStatusReconciliationRepository.reconcileLinkedMessage",
    );
    const candidate = await this.#db.prepare(`SELECT m.id, m.conversation_id,
      m.external_message_id, m.platform_message_id, m.status,
      d.external_message_id AS delivery_external_message_id
      FROM messages m
      JOIN conversations c ON c.organization_id = m.organization_id
        AND c.id = m.conversation_id
      LEFT JOIN outbound_message_deliveries d ON d.organization_id = m.organization_id
        AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.id = ? AND m.direction = 'outgoing'
        AND c.channel_id = ? AND c.external_conversation_id = ?`)
      .bind(
        scope,
        input.messageId,
        input.channelId,
        input.externalConversationId,
      ).first<CandidateRow>();
    if (!candidate) return { result: "unmatched" };
    const externalMessageId =
      candidate.external_message_id ?? candidate.delivery_external_message_id;
    if (!externalMessageId) return { result: "unmatched" };

    return this.#reconcileCandidate({
      organizationId: scope,
      channelId: input.channelId,
      externalConversationId: input.externalConversationId,
      candidate,
      externalMessageId,
      platformMessageId: candidate.platform_message_id,
      reconciledAt: input.reconciledAt,
    });
  }

  async #findCandidates(input: {
    organizationId: string;
    channelId: string;
    externalConversationId: string;
    externalMessageId: string;
    platformMessageId: string;
  }): Promise<CandidateRow[]> {
    const result = await this.#db.prepare(`SELECT m.id, m.conversation_id,
      m.external_message_id, m.platform_message_id, m.status,
      d.external_message_id AS delivery_external_message_id
      FROM messages m
      JOIN conversations c ON c.organization_id = m.organization_id
        AND c.id = m.conversation_id
      LEFT JOIN outbound_message_deliveries d ON d.organization_id = m.organization_id
        AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.direction = 'outgoing'
        AND c.channel_id = ? AND c.external_conversation_id = ?
        AND (m.external_message_id = ? OR m.platform_message_id = ?
          OR d.external_message_id = ?)
      LIMIT 2`)
      .bind(
        input.organizationId,
        input.channelId,
        input.externalConversationId,
        input.externalMessageId,
        input.platformMessageId,
        input.externalMessageId,
      ).all<CandidateRow>();
    return result.results;
  }

  async #reconcileCandidate(input: {
    organizationId: string;
    channelId: string;
    externalConversationId: string;
    candidate: CandidateRow;
    externalMessageId: string;
    platformMessageId: string | null;
    reconciledAt: string;
  }): Promise<StatusReconciliationResult> {
    const events = await this.#db.prepare(`SELECT status, occurred_at,
      platform_message_id
      FROM message_status_events
      WHERE organization_id = ? AND channel_id = ?
        AND conversation_external_id = ?
        AND (message_external_id = ?
          OR (? IS NOT NULL AND platform_message_id = ?))
      ORDER BY occurred_at ASC,
        CASE status
          WHEN 'failed' THEN 0 WHEN 'sent' THEN 1
          WHEN 'delivered' THEN 2 WHEN 'read' THEN 3
        END ASC,
        external_event_id ASC`)
      .bind(
        input.organizationId,
        input.channelId,
        input.externalConversationId,
        input.externalMessageId,
        input.platformMessageId,
        input.platformMessageId,
      ).all<StatusEventRow>();

    const platformMessageId = input.platformMessageId
      ?? events.results.find((event) => event.platform_message_id)
        ?.platform_message_id
      ?? null;
    let status = input.candidate.status;
    for (const event of events.results) {
      status = applyProviderStatus(status, event.status);
    }
    const deliveryStatus = status === "failed" ? "failed" : "sent";
    const deliveryError = status === "failed" ? "ZERNIO_DELIVERY_FAILED" : null;

    await this.#db.batch([
      this.#db.prepare(`UPDATE messages SET
        external_message_id = COALESCE(external_message_id, ?),
        platform_message_id = COALESCE(platform_message_id, ?),
        status = ?, updated_at = ?
        WHERE organization_id = ? AND id = ?`)
        .bind(
          input.externalMessageId,
          platformMessageId,
          status,
          input.reconciledAt,
          input.organizationId,
          input.candidate.id,
        ),
      this.#db.prepare(`UPDATE outbound_message_deliveries SET
        external_message_id = COALESCE(external_message_id, ?),
        status = ?, last_error_code = ?,
        sent_at = CASE WHEN ? = 'sent' THEN COALESCE(sent_at, ?) ELSE sent_at END,
        updated_at = ?
        WHERE organization_id = ? AND message_id = ?`)
        .bind(
          input.externalMessageId,
          deliveryStatus,
          deliveryError,
          deliveryStatus,
          input.reconciledAt,
          input.reconciledAt,
          input.organizationId,
          input.candidate.id,
        ),
      this.#db.prepare(`UPDATE message_status_events SET reconciled_at = ?
        WHERE organization_id = ? AND channel_id = ?
          AND conversation_external_id = ?
          AND (message_external_id = ?
            OR (? IS NOT NULL AND platform_message_id = ?))`)
        .bind(
          input.reconciledAt,
          input.organizationId,
          input.channelId,
          input.externalConversationId,
          input.externalMessageId,
          platformMessageId,
          platformMessageId,
        ),
    ]);

    return {
      result: "reconciled",
      messageId: input.candidate.id,
      conversationId: input.candidate.conversation_id,
      status,
    };
  }
}
