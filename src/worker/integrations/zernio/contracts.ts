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

// Los tipos reales del proveedor son `image`, `video`, `audio`, `file`,
// `sticker` y `share`. Un tipo desconocido se normaliza en vez de rechazar el
// evento: un `422` haría que el proveedor reintente indefinidamente un webhook
// que nunca será aceptado, y perdería además el mensaje que lo acompaña.
export const attachmentTypes = [
  "image",
  "video",
  "audio",
  "file",
  "sticker",
  "share",
] as const;

export type AttachmentType = (typeof attachmentTypes)[number] | "unsupported";

const attachmentTypeSchema = z.string().max(64).transform((value): AttachmentType => {
  const normalized = value.trim().toLowerCase();
  return (attachmentTypes as readonly string[]).includes(normalized)
    ? (normalized as AttachmentType)
    : "unsupported";
});

const attachmentSchema = z
  .object({
    // `id` es el `mediaId` con el que se descarga el binario de WhatsApp.
    id: z.string().min(1).max(512).nullish(),
    type: attachmentTypeSchema,
    url: z.url().max(8_192),
    filename: z.string().max(1_024).nullish(),
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
      event: z.literal("message.sent"),
      message: messageSchema.extend({ direction: z.literal("outgoing") }),
      account: webhookAccountSchema,
      conversation: conversationSchema,
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
    // Opcional a propósito: el campo es aditivo y los mensajes ya encolados
    // antes de este corte deben seguir validando al consumirse.
    contactPhoneNumber: z.string().min(1).max(32).nullish(),
    text: z.string().max(65_536).nullable(),
    attachments: z.array(attachmentSchema).max(32),
  }),
  queueBaseSchema.extend({
    kind: z.literal("messageStatus"),
    externalConversationId: z.string().min(1).max(512),
    externalMessageId: z.string().min(1).max(512),
    platformMessageId: z.string().min(1).max(1_024),
    status: z.enum(["sent", "delivered", "read", "failed"]),
  }),
  queueBaseSchema.extend({
    kind: z.literal("accountDisconnected"),
  }),
]);

export type ZernioWebhookEvent = z.infer<typeof zernioWebhookEventSchema>;
export type InboundQueueMessage = z.infer<typeof inboundQueueMessageSchema>;

export const outboundQueueMessageSchema = z.object({
  kind: z.literal("sendTextMessage"),
  organizationId: z.uuid(),
  conversationId: z.uuid(),
  messageId: z.uuid(),
  correlationId: z.uuid(),
});

export type OutboundQueueMessage = z.infer<typeof outboundQueueMessageSchema>;
