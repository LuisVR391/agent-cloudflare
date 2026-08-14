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
  /**
   * Tal como lo reporta el canal o lo escribe una persona. No se presume E.164
   * ni se normaliza: el proveedor no garantiza un formato y reescribirlo
   * perdería el valor observado.
   */
  phoneNumber: string | null;
  email: string | null;
  status: ContactStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Token semántico; el cliente lo traduce a una variante de `Badge`. */
export type ContactTagColor =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type ContactTag = {
  id: string;
  organizationId: string;
  name: string;
  color: ContactTagColor;
  createdAt: string;
  updatedAt: string;
};

/** Ficha completa: el contacto, cómo lo alcanza cada canal y sus etiquetas. */
export type ContactProfile = Contact & {
  identities: ContactIdentity[];
  tags: ContactTag[];
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
  assignee: ConversationAssignee | null;
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

/**
 * Cursor de paginación por clave. Reproduce la tupla que ordena la consulta
 * —timestamp e identificador— porque comparar solo el timestamp deja
 * inalcanzables las filas empatadas que el límite corta.
 */
export type PageCursor = {
  timestamp: string;
  id: string;
};

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
  phoneNumber?: string | null;
  email?: string | null;
  status?: ContactStatus;
};

/**
 * Campos ausentes se conservan; `null` los borra. La distinción importa: una
 * ficha que solo edita el correo no debe vaciar el teléfono.
 */
export type UpdateContactInput = {
  expectedVersion: number;
  displayName?: string | null;
  phoneNumber?: string | null;
  email?: string | null;
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

export type RoleKey = "owner" | "manager" | "operator";

export type MembershipStatus = "active" | "suspended" | "revoked";

/**
 * Persona del equipo tal como la ve el panel. `membershipId` es lo que
 * identifica al responsable de una conversación: pertenece a la organización,
 * mientras que `userId` es global y solo sirve para atribuir un mensaje ya
 * enviado a quien lo escribió.
 */
export type TeamMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: RoleKey;
  status: MembershipStatus;
  joinedAt: string;
};

export type InvitationStatus =
  | "pending"
  | "accepting"
  | "accepted"
  | "revoked"
  | "expired";

/** Nunca transporta el token ni su hash. */
export type TeamInvitation = {
  id: string;
  email: string;
  role: RoleKey;
  status: InvitationStatus;
  expiresAt: string;
  invitedBy: string;
  createdAt: string;
};

/**
 * Lo que la aceptación necesita saber antes de decidir. Se obtiene por hash
 * del token, sin sesión ni organización activa, porque el token es lo único
 * que puede resolverlas.
 */
export type InvitationLookup = {
  id: string;
  organizationId: string;
  organizationName: string;
  email: string;
  role: RoleKey;
  status: InvitationStatus;
  expiresAt: string;
};

/**
 * Responsable vigente de una conversación. Es una membresía, no un usuario
 * suelto: `membershipId` pertenece a la organización y `userId` solo sirve
 * para reconocer a quien ya escribió en el hilo.
 */
export type ConversationAssignee = {
  membershipId: string;
  userId: string;
  name: string;
};

export type ServiceStatus = "active" | "archived";

/**
 * Servicio del catálogo empresarial. El precio es opcional y, cuando existe,
 * viaja con su moneda: un importe sin moneda no significa nada y
 * `organizations` todavía no declara configuración regional (ADR-0010).
 *
 * `priceAmountCents` es la unidad menor de la moneda en entero, para que un
 * dato que se cobra no dependa de la representación de un flotante.
 */
export type Service = {
  id: string;
  organizationId: string;
  name: string;
  durationMinutes: number;
  priceAmountCents: number | null;
  priceCurrency: string | null;
  status: ServiceStatus;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type CreateServiceInput = {
  name: string;
  durationMinutes: number;
  priceAmountCents?: number | null;
  priceCurrency?: string | null;
  status?: ServiceStatus;
};

/**
 * Campos ausentes se conservan. El precio es la excepción: importe y moneda se
 * escriben juntos, así que `price: null` borra ambos y omitirlo no toca
 * ninguno. Separarlos permitiría dejar una moneda sin importe.
 */
export type UpdateServiceInput = {
  expectedVersion: number;
  name?: string;
  durationMinutes?: number;
  price?: { amountCents: number; currency: string } | null;
  status?: ServiceStatus;
};
