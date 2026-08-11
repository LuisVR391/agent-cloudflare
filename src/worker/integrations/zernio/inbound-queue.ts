import {
  inboundQueueMessageSchema,
  type InboundQueueMessage,
} from "./contracts";
import { CommunicationChannelRepository } from "../../repositories/communication-channel-repository";
import { InboundWebhookEventRepository } from "../../repositories/inbound-webhook-event-repository";

export async function processInboundQueueMessage(
  db: D1Database,
  body: InboundQueueMessage,
): Promise<void> {
  const parsed = inboundQueueMessageSchema.parse(body);
  if (parsed.kind === "accountDisconnected") {
    await new CommunicationChannelRepository(db).markDisconnected(
      parsed.organizationId,
      parsed.channelId,
      parsed.occurredAt,
    );
  }
  await new InboundWebhookEventRepository(db).markProcessed(
    parsed.organizationId,
    parsed.eventId,
    new Date().toISOString(),
  );
}

export async function handleInboundQueue(
  batch: MessageBatch<InboundQueueMessage>,
  db: D1Database,
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
      await processInboundQueueMessage(db, parsed.data);
      message.ack();
    } catch {
      await new InboundWebhookEventRepository(db).markFailed(
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
