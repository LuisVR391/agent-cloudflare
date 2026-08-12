/**
 * Tipos del dominio en `camelCase`. La conversión desde las columnas
 * `snake_case` de D1 vive en la capa de repositorios (ADR-0006).
 */

export type OrganizationStatus = "active" | "suspended";

export type ContactStatus = "active" | "archived";

/** Proveedores de identidad soportados hoy. Crece con cada canal integrado. */
export type IdentityProvider = "whatsapp";

export type ChannelProvider = "whatsapp";

export type ChannelAdapter = "zernio";

export type ChannelStatus = "active" | "disconnected";

export type InboundWebhookEventType =
  | "message.received"
  | "message.sent"
  | "message.delivered"
  | "message.read"
  | "message.failed"
  | "account.disconnected";

export type InboundWebhookEventStatus =
  | "received"
  | "enqueued"
  | "processed"
  | "failed";

export type ConversationStatus = "open" | "resolved";
export type AttentionMode = "automatic" | "supervised" | "human" | "paused";
export type MessageStatus =
  | "received"
  | "queued"
  | "sent"
  | "delivered"
  | "read"
  | "failed"
  | "delivery_unknown";

export type Organization = {
  id: string;
  slug: string;
  displayName: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
};

export type Contact = {
  id: string;
  organizationId: string;
  displayName: string | null;
  status: ContactStatus;
  createdAt: string;
  updatedAt: string;
};

export type ContactIdentity = {
  id: string;
  organizationId: string;
  contactId: string;
  provider: IdentityProvider;
  externalId: string;
  createdAt: string;
  updatedAt: string;
};

export type CommunicationChannel = {
  id: string;
  organizationId: string;
  provider: ChannelProvider;
  adapter: ChannelAdapter;
  externalAccountId: string;
  externalProfileId: string | null;
  displayName: string | null;
  status: ChannelStatus;
  disconnectedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

export type InboundWebhookEvent = {
  id: string;
  organizationId: string;
  channelId: string;
  adapter: ChannelAdapter;
  externalEventId: string;
  eventType: InboundWebhookEventType;
  status: InboundWebhookEventStatus;
  correlationId: string;
  receivedAt: string;
  enqueuedAt: string | null;
  processedAt: string | null;
  failureCode: string | null;
};

export type ConversationSummary = {
  id: string;
  organizationId: string;
  channelId: string;
  contactId: string;
  contactDisplayName: string | null;
  contactExternalId: string;
  channelDisplayName: string | null;
  status: ConversationStatus;
  attentionMode: AttentionMode;
  version: number;
  lastMessageAt: string;
  lastMessageText: string | null;
};

// Tipos que el canal emite realmente; `unsupported` cubre lo que no
// reconocemos sin rechazar el mensaje que lo acompaña.
export type AttachmentContentType =
  | "image"
  | "video"
  | "audio"
  | "file"
  | "sticker"
  | "share"
  | "unsupported";
export type MessageContentType = "text" | AttachmentContentType;

export type ConversationMessage = {
  id: string;
  organizationId: string;
  conversationId: string;
  direction: "incoming" | "outgoing";
  senderType: "customer" | "staff" | "system";
  senderId: string | null;
  messageType: MessageContentType;
  text: string | null;
  status: MessageStatus;
  occurredAt: string;
  attachments: Array<{
    id: string;
    type: AttachmentContentType;
    // Nulos cuando el adjunto no pudo conservarse: `status` explica el motivo.
    contentType: string | null;
    byteSize: number | null;
    // Nombre declarado por el canal; nulo cuando no lo envía. Es texto no
    // confiable: se presenta, no se usa para construir rutas ni encabezados.
    filename: string | null;
    status: "stored" | "rejected";
    failureReason: string | null;
  }>;
};

export type CreateOrganizationInput = {
  slug: string;
  displayName: string;
  status?: OrganizationStatus;
};

export type CreateContactInput = {
  displayName?: string | null;
  status?: ContactStatus;
};

export type LinkContactIdentityInput = {
  contactId: string;
  provider: IdentityProvider;
  externalId: string;
};

export type CreateCommunicationChannelInput = {
  provider: ChannelProvider;
  adapter: ChannelAdapter;
  externalAccountId: string;
  externalProfileId?: string | null;
  displayName?: string | null;
};

export type RegisterInboundWebhookEventInput = {
  channelId: string;
  adapter: ChannelAdapter;
  externalEventId: string;
  eventType: InboundWebhookEventType;
  correlationId: string;
  receivedAt: string;
};
