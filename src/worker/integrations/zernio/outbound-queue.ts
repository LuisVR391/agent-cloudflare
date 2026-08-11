import { outboundQueueMessageSchema, type OutboundQueueMessage } from "./contracts";
import { ZernioApiError, ZernioClient } from "./client";

type OutboundEnv = { DB: D1Database; ZERNIO_API_KEY?: string };
type DeliveryRow = {
  organization_id: string; message_id: string; text_content: string;
  idempotency_key: string; external_account_id: string;
  external_conversation_id: string; attempt_count: number;
};

export async function processOutboundQueueMessage(
  env: OutboundEnv,
  body: OutboundQueueMessage,
): Promise<void> {
  const parsed = outboundQueueMessageSchema.parse(body);
  if (!env.ZERNIO_API_KEY) throw new Error("ZERNIO_API_KEY_MISSING");
  const delivery = await env.DB.prepare(`SELECT d.organization_id, d.message_id,
    d.idempotency_key, d.attempt_count, m.text_content, ch.external_account_id,
    c.external_conversation_id
    FROM outbound_message_deliveries d
    JOIN messages m ON m.organization_id = d.organization_id AND m.id = d.message_id
    JOIN conversations c ON c.organization_id = m.organization_id AND c.id = m.conversation_id
    JOIN communication_channels ch ON ch.organization_id = c.organization_id
      AND ch.id = c.channel_id
    WHERE d.organization_id = ? AND d.message_id = ? AND ch.status = 'active'`)
    .bind(parsed.organizationId, parsed.messageId).first<DeliveryRow>();
  if (!delivery?.text_content) throw new Error("OUTBOUND_MESSAGE_NOT_SENDABLE");
  const now = new Date().toISOString();
  await env.DB.prepare(`UPDATE outbound_message_deliveries SET status = 'sending',
    attempt_count = attempt_count + 1, last_attempt_at = ?, updated_at = ?
    WHERE organization_id = ? AND message_id = ?`)
    .bind(now, now, parsed.organizationId, parsed.messageId).run();
  try {
    const sent = await new ZernioClient(env.ZERNIO_API_KEY).sendTextMessage({
      conversationId: delivery.external_conversation_id,
      accountId: delivery.external_account_id,
      message: delivery.text_content,
      idempotencyKey: delivery.idempotency_key,
    });
    await env.DB.batch([
      env.DB.prepare(`UPDATE outbound_message_deliveries SET status = 'sent',
        external_message_id = ?, sent_at = ?, updated_at = ?
        WHERE organization_id = ? AND message_id = ?`)
        .bind(sent.messageId, sent.sentAt, now, parsed.organizationId, parsed.messageId),
      env.DB.prepare(`UPDATE messages SET external_message_id = ?, status = 'sent',
        updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(sent.messageId, now, parsed.organizationId, parsed.messageId),
    ]);
  } catch (caught) {
    const code = caught instanceof ZernioApiError ? `ZERNIO_HTTP_${caught.status}` : "ZERNIO_SEND_FAILED";
    await env.DB.prepare(`UPDATE outbound_message_deliveries SET status = 'failed',
      last_error_code = ?, updated_at = ? WHERE organization_id = ? AND message_id = ?`)
      .bind(code, now, parsed.organizationId, parsed.messageId).run();
    throw caught;
  }
}

export async function handleOutboundQueue(
  batch: MessageBatch<OutboundQueueMessage>,
  env: OutboundEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = outboundQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      console.error(JSON.stringify({ event: "queue.outbound.invalid", result: "rejected", queueMessageId: message.id }));
      message.ack();
      continue;
    }
    try {
      await processOutboundQueueMessage(env, parsed.data);
      message.ack();
    } catch {
      console.error(JSON.stringify({
        event: "queue.outbound.processing", result: "failed",
        correlationId: parsed.data.correlationId, messageId: parsed.data.messageId,
      }));
      message.retry();
    }
  }
}
