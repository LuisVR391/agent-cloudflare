import { getAgentByName } from "agents";
import type { CustomerSupportAgent } from "../../customer-support-agent";
import { outboundQueueMessageSchema, type OutboundQueueMessage } from "./contracts";
import {
  ZernioApiError,
  ZernioClient,
  ZernioResponseError,
  ZernioTransportError,
} from "./client";
import { MessageStatusReconciliationRepository } from "../../repositories/message-status-reconciliation-repository";

type OutboundEnv = {
  DB: D1Database;
  ZERNIO_API_KEY?: string;
  CustomerSupportAgent: DurableObjectNamespace<CustomerSupportAgent>;
};
type DeliveryRow = {
  organization_id: string;
  conversation_id: string;
  channel_id: string;
  message_id: string;
  text_content: string;
  idempotency_key: string;
  external_account_id: string;
  external_conversation_id: string;
  attempt_count: number;
  delivery_status: "pending" | "sending" | "sent" | "failed" | "delivery_unknown";
  external_message_id: string | null;
  channel_status: "active" | "disconnected";
};
type ProcessingResult = {
  action: "ack" | "retry";
  result: "sent" | "failed" | "delivery_unknown";
  errorCode?: string;
};

function classifyFailure(caught: unknown): {
  errorCode: string;
  status: "failed" | "delivery_unknown";
  retry: boolean;
} {
  if (caught instanceof ZernioApiError) {
    const retry =
      caught.status === 408 ||
      caught.status === 409 ||
      caught.status === 425 ||
      caught.status === 429 ||
      caught.status >= 500;
    return {
      errorCode: `ZERNIO_HTTP_${caught.status}`,
      status: retry ? "delivery_unknown" : "failed",
      retry,
    };
  }
  if (caught instanceof ZernioResponseError) {
    return {
      errorCode: "ZERNIO_RESPONSE_INVALID",
      status: "delivery_unknown",
      retry: true,
    };
  }
  if (caught instanceof ZernioTransportError) {
    return {
      errorCode: caught.category === "unknown"
        ? "ZERNIO_TRANSPORT_FAILED"
        : `ZERNIO_TRANSPORT_${caught.category.toUpperCase()}`,
      status: "delivery_unknown",
      retry: true,
    };
  }
  return {
    errorCode: "ZERNIO_SEND_FAILED",
    status: "delivery_unknown",
    retry: true,
  };
}

async function notifyMessageChanged(
  env: OutboundEnv,
  delivery: Pick<DeliveryRow, "organization_id" | "conversation_id" | "message_id">,
  occurredAt: string,
): Promise<void> {
  try {
    const agent = await getAgentByName(
      env.CustomerSupportAgent,
      `${delivery.organization_id}:${delivery.conversation_id}`,
    );
    await agent.notifyMessageChanged({
      organizationId: delivery.organization_id,
      conversationId: delivery.conversation_id,
      messageId: delivery.message_id,
      occurredAt,
    });
  } catch {
    console.error(JSON.stringify({
      event: "queue.outbound.live_notification",
      result: "failed",
      messageId: delivery.message_id,
    }));
  }
}

async function persistFailure(
  env: OutboundEnv,
  delivery: DeliveryRow,
  status: "failed" | "delivery_unknown",
  errorCode: string,
  now: string,
  externalMessageId: string | null = null,
): Promise<void> {
  await env.DB.batch([
    env.DB.prepare(`UPDATE outbound_message_deliveries SET status = ?,
      external_message_id = COALESCE(external_message_id, ?),
      last_error_code = ?, updated_at = ?
      WHERE organization_id = ? AND message_id = ? AND status != 'sent'`)
      .bind(
        status,
        externalMessageId,
        errorCode,
        now,
        delivery.organization_id,
        delivery.message_id,
      ),
    env.DB.prepare(`UPDATE messages SET status = ?, updated_at = ?
      WHERE organization_id = ? AND id = ?
        AND status NOT IN ('sent', 'delivered', 'read')`)
      .bind(status, now, delivery.organization_id, delivery.message_id),
  ]);
  await notifyMessageChanged(env, delivery, now);
}

export async function processOutboundQueueMessage(
  env: OutboundEnv,
  body: OutboundQueueMessage,
): Promise<ProcessingResult> {
  const parsed = outboundQueueMessageSchema.parse(body);
  const delivery = await env.DB.prepare(`SELECT d.organization_id,
    m.conversation_id, c.channel_id, d.message_id, d.idempotency_key,
    d.attempt_count, d.status AS delivery_status, d.external_message_id,
    m.text_content, ch.external_account_id, ch.status AS channel_status,
    c.external_conversation_id
    FROM outbound_message_deliveries d
    JOIN messages m ON m.organization_id = d.organization_id AND m.id = d.message_id
    JOIN conversations c ON c.organization_id = m.organization_id AND c.id = m.conversation_id
    JOIN communication_channels ch ON ch.organization_id = c.organization_id
      AND ch.id = c.channel_id
    WHERE d.organization_id = ? AND d.message_id = ? AND m.conversation_id = ?`)
    .bind(parsed.organizationId, parsed.messageId, parsed.conversationId)
    .first<DeliveryRow>();

  if (!delivery?.text_content) {
    return {
      action: "ack",
      result: "failed",
      errorCode: "OUTBOUND_MESSAGE_NOT_SENDABLE",
    };
  }
  if (delivery.delivery_status === "sent" && delivery.external_message_id) {
    return { action: "ack", result: "sent" };
  }

  const now = new Date().toISOString();
  if (delivery.channel_status !== "active") {
    await persistFailure(env, delivery, "failed", "CHANNEL_NOT_ACTIVE", now);
    return {
      action: "ack",
      result: "failed",
      errorCode: "CHANNEL_NOT_ACTIVE",
    };
  }
  if (!env.ZERNIO_API_KEY) {
    await persistFailure(env, delivery, "failed", "ZERNIO_API_KEY_MISSING", now);
    return {
      action: "retry",
      result: "failed",
      errorCode: "ZERNIO_API_KEY_MISSING",
    };
  }

  await env.DB.prepare(`UPDATE outbound_message_deliveries SET status = 'sending',
    attempt_count = attempt_count + 1, last_attempt_at = ?,
    last_error_code = NULL, updated_at = ?
    WHERE organization_id = ? AND message_id = ? AND status != 'sent'`)
    .bind(now, now, parsed.organizationId, parsed.messageId).run();

  let sent: Awaited<ReturnType<ZernioClient["sendTextMessage"]>>;
  try {
    sent = await new ZernioClient(env.ZERNIO_API_KEY).sendTextMessage({
      conversationId: delivery.external_conversation_id,
      accountId: delivery.external_account_id,
      message: delivery.text_content,
      idempotencyKey: delivery.idempotency_key,
    });
  } catch (caught) {
    const failure = classifyFailure(caught);
    await persistFailure(
      env,
      delivery,
      failure.status,
      failure.errorCode,
      now,
    );
    return {
      action: failure.retry ? "retry" : "ack",
      result: failure.status,
      errorCode: failure.errorCode,
    };
  }

  if (sent.conversationId !== delivery.external_conversation_id) {
    await persistFailure(
      env,
      delivery,
      "delivery_unknown",
      "ZERNIO_CONVERSATION_MISMATCH",
      now,
      sent.messageId,
    );
    return {
      action: "ack",
      result: "delivery_unknown",
      errorCode: "ZERNIO_CONVERSATION_MISMATCH",
    };
  }

  try {
    await env.DB.batch([
      env.DB.prepare(`UPDATE outbound_message_deliveries SET status = 'sent',
        external_message_id = ?, last_error_code = NULL, sent_at = ?, updated_at = ?
        WHERE organization_id = ? AND message_id = ?`)
        .bind(
          sent.messageId,
          sent.sentAt,
          now,
          parsed.organizationId,
          parsed.messageId,
        ),
      env.DB.prepare(`UPDATE messages SET external_message_id = ?,
        status = CASE WHEN status IN ('delivered', 'read') THEN status ELSE 'sent' END,
        updated_at = ? WHERE organization_id = ? AND id = ?`)
        .bind(sent.messageId, now, parsed.organizationId, parsed.messageId),
    ]);
    await new MessageStatusReconciliationRepository(
      env.DB,
    ).reconcileLinkedMessage({
      organizationId: parsed.organizationId,
      channelId: delivery.channel_id,
      externalConversationId: delivery.external_conversation_id,
      messageId: parsed.messageId,
      reconciledAt: now,
    });
  } catch {
    await persistFailure(
      env,
      delivery,
      "delivery_unknown",
      "OUTBOUND_PERSISTENCE_FAILED",
      now,
    );
    return {
      action: "retry",
      result: "delivery_unknown",
      errorCode: "OUTBOUND_PERSISTENCE_FAILED",
    };
  }

  await notifyMessageChanged(env, delivery, now);
  return { action: "ack", result: "sent" };
}

function retryDelay(attempts: number): number {
  return Math.min(300, 2 ** Math.max(1, attempts));
}

export async function handleOutboundQueue(
  batch: MessageBatch<OutboundQueueMessage>,
  env: OutboundEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = outboundQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      console.error(JSON.stringify({
        event: "queue.outbound.invalid",
        result: "rejected",
        queueMessageId: message.id,
      }));
      message.ack();
      continue;
    }
    try {
      const processing = await processOutboundQueueMessage(env, parsed.data);
      if (processing.action === "ack") {
        message.ack();
      } else {
        message.retry({ delaySeconds: retryDelay(message.attempts) });
      }
      if (processing.result !== "sent") {
        console.error(JSON.stringify({
          event: "queue.outbound.processing",
          result: processing.result,
          errorCode: processing.errorCode,
          correlationId: parsed.data.correlationId,
          messageId: parsed.data.messageId,
          attempts: message.attempts,
        }));
      }
    } catch {
      console.error(JSON.stringify({
        event: "queue.outbound.processing",
        result: "failed",
        errorCode: "OUTBOUND_PROCESSING_FAILED",
        correlationId: parsed.data.correlationId,
        messageId: parsed.data.messageId,
        attempts: message.attempts,
      }));
      message.retry({ delaySeconds: retryDelay(message.attempts) });
    }
  }
}
