import {
  inboundQueueMessageSchema,
  type InboundQueueMessage,
} from "./contracts";
import { CommunicationChannelRepository } from "../../repositories/communication-channel-repository";
import { InboundWebhookEventRepository } from "../../repositories/inbound-webhook-event-repository";
import { ConversationRepository } from "../../repositories/conversation-repository";
import { getAgentByName } from "agents";
import { persistInboundAttachments } from "./media";

type InboundQueueEnv = {
  DB: D1Database;
  CustomerSupportAgent: DurableObjectNamespace<
    import("../../customer-support-agent").CustomerSupportAgent
  >;
  MEDIA_BUCKET: R2Bucket;
};

async function notifyMessageChanged(
  env: InboundQueueEnv,
  input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    occurredAt: string;
  },
): Promise<void> {
  const agent = await getAgentByName(
    env.CustomerSupportAgent,
    `${input.organizationId}:${input.conversationId}`,
  );
  await agent.notifyMessageChanged(input);
}

export async function processInboundQueueMessage(
  env: InboundQueueEnv,
  body: InboundQueueMessage,
): Promise<void> {
  const parsed = inboundQueueMessageSchema.parse(body);
  if (parsed.kind === "accountDisconnected") {
    await new CommunicationChannelRepository(env.DB).markDisconnected(
      parsed.organizationId,
      parsed.channelId,
      parsed.occurredAt,
    );
  } else if (parsed.kind === "messageReceived") {
    const persisted = await new ConversationRepository(env.DB).upsertInbound({
      organizationId: parsed.organizationId,
      channelId: parsed.channelId,
      externalConversationId: parsed.externalConversationId,
      externalContactId: parsed.externalContactId,
      externalMessageId: parsed.externalMessageId,
      platformMessageId: parsed.platformMessageId,
      text: parsed.text,
      messageType: parsed.text ? "text" : parsed.attachments[0]?.type ?? "text",
      occurredAt: parsed.occurredAt,
      correlationId: parsed.correlationId,
    });
    await persistInboundAttachments({
      db: env.DB,
      bucket: env.MEDIA_BUCKET,
      organizationId: parsed.organizationId,
      messageId: persisted.messageId,
      attachments: parsed.attachments,
    });
    const channel = await env.DB.prepare(
      "SELECT buffer_seconds FROM communication_channels WHERE organization_id = ? AND id = ?",
    ).bind(parsed.organizationId, parsed.channelId)
      .first<{ buffer_seconds: number }>();
    const agent = await getAgentByName(
      env.CustomerSupportAgent,
      `${parsed.organizationId}:${persisted.conversationId}`,
    );
    await agent.acceptInboundMessage({
      organizationId: parsed.organizationId,
      conversationId: persisted.conversationId,
      messageId: persisted.messageId,
      occurredAt: parsed.occurredAt,
      bufferSeconds: channel?.buffer_seconds ?? 8,
    });
  } else {
    const now = new Date().toISOString();
    await env.DB.prepare(`INSERT INTO message_status_events
      (id, organization_id, external_event_id, conversation_external_id,
       message_external_id, status, occurred_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT (organization_id, external_event_id) DO NOTHING`)
      .bind(
        crypto.randomUUID(),
        parsed.organizationId,
        parsed.eventId,
        parsed.externalConversationId,
        parsed.externalMessageId,
        parsed.status,
        parsed.occurredAt,
        now,
      ).run();

    const message = await env.DB.prepare(`UPDATE messages SET
      platform_message_id = COALESCE(platform_message_id, ?),
      status = CASE
        WHEN ? = 'read' THEN 'read'
        WHEN ? = 'delivered' AND status != 'read' THEN 'delivered'
        WHEN ? = 'sent' AND status NOT IN ('delivered', 'read') THEN 'sent'
        WHEN ? = 'failed' AND status NOT IN ('delivered', 'read') THEN 'failed'
        ELSE status
      END,
      updated_at = ?
      WHERE organization_id = ? AND external_message_id = ?
      RETURNING id, conversation_id`)
      .bind(
        parsed.platformMessageId,
        parsed.status,
        parsed.status,
        parsed.status,
        parsed.status,
        now,
        parsed.organizationId,
        parsed.externalMessageId,
      )
      .first<{ id: string; conversation_id: string }>();

    if (parsed.status === "sent") {
      await env.DB.prepare(`UPDATE outbound_message_deliveries SET
        status = 'sent', external_message_id = ?, last_error_code = NULL,
        sent_at = COALESCE(sent_at, ?), updated_at = ?
        WHERE organization_id = ? AND external_message_id = ?`)
        .bind(
          parsed.externalMessageId,
          parsed.occurredAt,
          now,
          parsed.organizationId,
          parsed.externalMessageId,
        ).run();
    } else if (parsed.status === "failed") {
      await env.DB.prepare(`UPDATE outbound_message_deliveries SET
        status = 'failed', last_error_code = 'ZERNIO_DELIVERY_FAILED',
        updated_at = ?
        WHERE organization_id = ? AND external_message_id = ?`)
        .bind(now, parsed.organizationId, parsed.externalMessageId).run();
    }

    if (message) {
      await env.DB.prepare(`UPDATE message_status_events SET reconciled_at = ?
        WHERE organization_id = ? AND external_event_id = ?`)
        .bind(now, parsed.organizationId, parsed.eventId).run();
      await notifyMessageChanged(env, {
        organizationId: parsed.organizationId,
        conversationId: message.conversation_id,
        messageId: message.id,
        occurredAt: parsed.occurredAt,
      });
    }
  }
  await new InboundWebhookEventRepository(env.DB).markProcessed(
    parsed.organizationId,
    parsed.eventId,
    new Date().toISOString(),
  );
}

export async function handleInboundQueue(
  batch: MessageBatch<InboundQueueMessage>,
  env: InboundQueueEnv,
): Promise<void> {
  for (const message of batch.messages) {
    const parsed = inboundQueueMessageSchema.safeParse(message.body);
    if (!parsed.success) {
      console.error(
        JSON.stringify({
          event: "queue.inbound.invalid",
          result: "rejected",
          queueMessageId: message.id,
        }),
      );
      message.ack();
      continue;
    }

    try {
      await processInboundQueueMessage(env, parsed.data);
      message.ack();
    } catch {
      await new InboundWebhookEventRepository(env.DB).markFailed(
        parsed.data.organizationId,
        parsed.data.eventId,
        "QUEUE_PROCESSING_FAILED",
      );
      console.error(
        JSON.stringify({
          event: "queue.inbound.processing",
          result: "failed",
          correlationId: parsed.data.correlationId,
          eventId: parsed.data.eventId,
        }),
      );
      message.retry();
    }
  }
}
