import { z } from "zod";

const timestampSchema = z.iso.datetime({ offset: true });

const webhookAccountSchema = z
  .object({
    id: z.string().min(1).max(512),
    accountId: z.string().min(1).max(512).optional(),
    profileId: z.string().min(1).max(512).optional(),
    platform: z.string().min(1).max(64),
    username: z.string().max(512),
    displayName: z.string().max(512).optional(),
  })
  .passthrough();

const disconnectedAccountSchema = z
  .object({
    accountId: z.string().min(1).max(512),
    profileId: z.string().min(1).max(512),
    platform: z.string().min(1).max(64),
    username: z.string().max(512),
    displayName: z.string().max(512).optional(),
    disconnectionType: z.enum(["intentional", "unintentional"]),
    reason: z.string().max(2_048),
  })
  .passthrough();

const attachmentSchema = z
  .object({
    type: z.string().min(1).max(64),
    url: z.url().max(8_192),
  })
  .passthrough();

const senderSchema = z
  .object({
    id: z.string().min(1).max(512),
    phoneNumber: z.string().min(1).max(32).nullable().optional(),
    businessScopedUserId: z.string().min(1).max(512).optional(),
  })
  .passthrough();

const messageSchema = z
  .object({
    id: z.string().min(1).max(512),
    conversationId: z.string().min(1).max(512),
    platform: z.literal("whatsapp"),
    platformMessageId: z.string().min(1).max(1_024),
    direction: z.enum(["incoming", "outgoing"]),
    text: z.string().max(65_536).nullable(),
    attachments: z.array(attachmentSchema).max(32),
    sender: senderSchema,
    sentAt: timestampSchema,
    isRead: z.boolean(),
  })
  .passthrough();

const conversationSchema = z
  .object({
    id: z.string().min(1).max(512),
    platformConversationId: z.string().min(1).max(1_024),
    status: z.enum(["active", "archived"]),
  })
  .passthrough();

export const zernioWebhookEventSchema = z.discriminatedUnion("event", [
  z
    .object({
      id: z.string().min(1).max(512),
      event: z.literal("webhook.test"),
      message: z.string().max(2_048),
      timestamp: timestampSchema,
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1).max(512),
      event: z.literal("message.received"),
      message: messageSchema.extend({ direction: z.literal("incoming") }),
      conversation: conversationSchema,
      account: webhookAccountSchema,
      timestamp: timestampSchema,
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1).max(512),
      event: z.enum(["message.delivered", "message.read", "message.failed"]),
      message: messageSchema,
      statusAt: timestampSchema,
      account: webhookAccountSchema,
      conversation: conversationSchema,
      timestamp: timestampSchema,
    })
    .passthrough(),
  z
    .object({
      id: z.string().min(1).max(512),
      event: z.literal("account.disconnected"),
      account: disconnectedAccountSchema,
      timestamp: timestampSchema,
    })
    .passthrough(),
]);

const queueBaseSchema = z.object({
  eventId: z.string().min(1).max(512),
  correlationId: z.uuid(),
  organizationId: z.uuid(),
  channelId: z.uuid(),
  externalAccountId: z.string().min(1).max(512),
  occurredAt: timestampSchema,
});

export const inboundQueueMessageSchema = z.discriminatedUnion("kind", [
  queueBaseSchema.extend({
    kind: z.literal("messageReceived"),
    externalConversationId: z.string().min(1).max(512),
    externalMessageId: z.string().min(1).max(512),
    platformMessageId: z.string().min(1).max(1_024),
    externalContactId: z.string().min(1).max(512),
    text: z.string().max(65_536).nullable(),
    attachments: z.array(attachmentSchema).max(32),
  }),
  queueBaseSchema.extend({
    kind: z.literal("messageStatus"),
    externalConversationId: z.string().min(1).max(512),
    externalMessageId: z.string().min(1).max(512),
    platformMessageId: z.string().min(1).max(1_024),
    status: z.enum(["delivered", "read", "failed"]),
  }),
  queueBaseSchema.extend({
    kind: z.literal("accountDisconnected"),
  }),
]);

export type ZernioWebhookEvent = z.infer<typeof zernioWebhookEventSchema>;
export type InboundQueueMessage = z.infer<typeof inboundQueueMessageSchema>;
