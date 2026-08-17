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
  /**
   * Zona horaria IANA con la que se interpreta un día de agenda (ADR-0010). No
   * cambia cómo se almacena un instante: todo sigue en ISO 8601 UTC.
   */
  timeZone: string;
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

/** Token semántico; el cliente lo traduce a una variante de componente. */
export type SemanticColor =
  | "neutral"
  | "info"
  | "success"
  | "warning"
  | "danger";

export type ContactTagColor = SemanticColor;

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

/**
 * Etapa comercial de un pipeline. El orden es explícito y editable: ADR-0010
 * decide que el pipeline es configuración de la organización, no un enumerado
 * del código.
 */
export type PipelineStage = {
  id: string;
  organizationId: string;
  pipelineId: string;
  name: string;
  position: number;
  color: SemanticColor;
  createdAt: string;
  updatedAt: string;
};

/**
 * `templateKey` identifica la plantilla que originó el pipeline y hace
 * idempotente su siembra; es `null` en uno creado a mano.
 *
 * `version` cubre la configuración completa: crear, renombrar, recolorear,
 * reordenar o borrar una etapa exige la versión vigente y la incrementa.
 */
export type Pipeline = {
  id: string;
  organizationId: string;
  name: string;
  templateKey: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type PipelineWithStages = Pipeline & { stages: PipelineStage[] };

/**
 * Oportunidad comercial: lo que recorre el pipeline (ADR-0010). Pertenece a un
 * contacto y referencia opcionalmente la conversación que la originó; una
 * conversación puede producir ninguna, una o varias a lo largo del tiempo.
 *
 * Los campos derivados —nombre del contacto, de la etapa y del servicio— viajan
 * resueltos porque el tablero los necesita y resolverlos por separado exigiría
 * una consulta por tarjeta.
 */
export type Opportunity = {
  id: string;
  organizationId: string;
  contactId: string;
  contactDisplayName: string | null;
  conversationId: string | null;
  pipelineId: string;
  stageId: string;
  stageName: string;
  stagePosition: number;
  serviceId: string | null;
  serviceName: string | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/** Un movimiento de etapa, tal como lo conserva el historial. */
export type OpportunityStageTransition = {
  id: string;
  previousStageId: string | null;
  previousStageName: string | null;
  nextStageId: string;
  nextStageName: string;
  actorType: "staff" | "system";
  actorId: string | null;
  correlationId: string;
  occurredAt: string;
};

export type OpportunityDetail = Opportunity & {
  transitions: OpportunityStageTransition[];
};

export type CreateOpportunityInput = {
  contactId: string;
  conversationId?: string | null;
  pipelineId?: string;
  stageId?: string;
  serviceId?: string | null;
  actorId: string;
  correlationId: string;
};

/**
 * Campos ausentes se conservan; `serviceId: null` lo desvincula. Mover la
 * etapa registra una transición, cambiar el servicio no: son hechos distintos y
 * el historial solo explica el recorrido comercial.
 */
export type UpdateOpportunityInput = {
  expectedVersion: number;
  stageId?: string;
  serviceId?: string | null;
  actorId: string;
  correlationId: string;
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

/**
 * Nota del contacto: lo que el equipo entendió, en contraste con el mensaje,
 * que es lo que el contacto dijo. Pertenece al contacto y conserva la
 * conversación de origen cuando se escribió desde una.
 *
 * El nombre del autor viaja resuelto porque la ficha lo muestra en cada nota y
 * resolverlo aparte exigiría una consulta por fila.
 */
export type ContactNote = {
  id: string;
  organizationId: string;
  contactId: string;
  conversationId: string | null;
  authorMembershipId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

/**
 * El autor no viaja en la entrada: lo pone el handler con la membresía de la
 * sesión. Un identificador de autor enviado por el frontend no demostraría
 * quién escribe.
 */
export type CreateContactNoteInput = {
  contactId: string;
  conversationId?: string | null;
  body: string;
  authorMembershipId: string;
};

export type TaskStatus = "open" | "done" | "cancelled";

/** El sujeto de una tarea: a lo sumo uno, y ninguno también es válido. */
export type TaskSubject =
  | { type: "contact"; id: string }
  | { type: "conversation"; id: string }
  | { type: "opportunity"; id: string }
  | null;

/**
 * Tarea con responsable y vencimiento. Una nota conserva lo que se entendió;
 * la tarea conserva lo que quedó pendiente, y por eso tiene a quién le toca.
 *
 * El nombre del responsable y la etiqueta del sujeto viajan resueltos porque la
 * lista los muestra en cada fila.
 */
export type Task = {
  id: string;
  organizationId: string;
  title: string;
  details: string | null;
  assigneeMembershipId: string;
  assigneeName: string | null;
  createdByMembershipId: string;
  dueAt: string | null;
  status: TaskStatus;
  subject: TaskSubject;
  subjectLabel: string | null;
  version: number;
  completedAt: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Quien crea la tarea es la membresía de la sesión, igual que el autor de una
 * nota. El responsable sí se elige, y debe tener membresía activa.
 */
export type CreateTaskInput = {
  title: string;
  details?: string | null;
  assigneeMembershipId?: string;
  dueAt?: string | null;
  subject?: TaskSubject;
  createdByMembershipId: string;
};

/**
 * Campos ausentes se conservan; `dueAt: null` retira el vencimiento. Cerrar es
 * un cambio de estado: `done` sella `completedAt` y reabrir lo borra.
 */
export type UpdateTaskInput = {
  expectedVersion: number;
  title?: string;
  details?: string | null;
  assigneeMembershipId?: string;
  dueAt?: string | null;
  status?: TaskStatus;
};

/**
 * Ciclo de vida de una reserva. `rescheduled` es un estado y no solo un hecho
 * del historial: una cita movida y todavía sin reconfirmar no está en la misma
 * situación que una confirmada, y la agenda necesita distinguirlas de un
 * vistazo. Las transiciones permitidas viven en `appointment-status.ts`.
 */
export type AppointmentStatus =
  | "requested"
  | "pending"
  | "confirmed"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "no_show";

/**
 * Cita: el compromiso al que llega una conversación. Pertenece a un contacto y
 * reserva un servicio durante un intervalo, siempre en ISO 8601 UTC; la zona
 * horaria de la organización solo decide cómo se agrupa y se muestra.
 *
 * Los campos derivados viajan resueltos porque la agenda los muestra en cada
 * fila y resolverlos aparte exigiría una consulta por cita.
 */
export type Appointment = {
  id: string;
  organizationId: string;
  contactId: string;
  contactDisplayName: string | null;
  serviceId: string;
  serviceName: string | null;
  assigneeMembershipId: string | null;
  assigneeName: string | null;
  conversationId: string | null;
  opportunityId: string | null;
  startsAt: string;
  endsAt: string;
  status: AppointmentStatus;
  createdByMembershipId: string;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Un cambio de la cita, tal como lo conserva el historial. Guarda los horarios
 * además del estado porque una reprogramación es precisamente un cambio de
 * horario: sin ellos, dos filas `rescheduled` seguidas no dirían qué se movió.
 */
export type AppointmentTransition = {
  id: string;
  previousStatus: AppointmentStatus | null;
  nextStatus: AppointmentStatus;
  previousStartsAt: string | null;
  previousEndsAt: string | null;
  nextStartsAt: string;
  nextEndsAt: string;
  actorType: "staff" | "system";
  actorId: string | null;
  correlationId: string;
  occurredAt: string;
};

export type AppointmentDetail = Appointment & {
  transitions: AppointmentTransition[];
};

/**
 * Quien agenda es la membresía de la sesión. `endsAt` es opcional: sin él, el
 * fin se deriva de la duración del servicio dentro de la misma sentencia que
 * inserta, para que no quede ventana entre leer el catálogo y escribir.
 */
export type CreateAppointmentInput = {
  contactId: string;
  serviceId: string;
  startsAt: string;
  endsAt?: string | null;
  assigneeMembershipId?: string | null;
  conversationId?: string | null;
  opportunityId?: string | null;
  status?: AppointmentStatus;
  createdByMembershipId: string;
  actorId: string;
  correlationId: string;
};

/**
 * Campos ausentes se conservan; `assigneeMembershipId: null` retira al
 * responsable. Cambiar el horario es reprogramar y el estado lo refleja, salvo
 * cuando la cita solo estaba solicitada: ahí todavía no había nada acordado que
 * mover.
 */
export type UpdateAppointmentInput = {
  expectedVersion: number;
  startsAt?: string;
  endsAt?: string;
  assigneeMembershipId?: string | null;
  status?: AppointmentStatus;
  actorId: string;
  correlationId: string;
};

/** Periodo de métricas ya resuelto a instantes UTC, semiabierto `[from, to)`. */
export type MetricsWindow = {
  from: string;
  to: string;
};

/**
 * Tiempo de primera respuesta del periodo.
 *
 * Un «turno» es un mensaje entrante que abre una espera: el anterior de esa
 * conversación fue saliente, o no había ninguno. Dos mensajes seguidos del
 * contacto son un solo turno, porque quien atiende solo debe una respuesta.
 *
 * `pending` cuenta los turnos que al consultar seguían sin respuesta; no entran
 * en la mediana ni en el promedio, porque su espera todavía no terminó y
 * contarla como si hubiera terminado mejoraría la cifra cuanto peor fuera el
 * servicio.
 */
export type FirstResponseMetrics = {
  answered: number;
  pending: number;
  medianMinutes: number | null;
  averageMinutes: number | null;
};

/**
 * Métricas operativas: qué llegó, qué se atendió y en cuánto tiempo.
 *
 * `humanInterventions` cuenta las respuestas que envió una persona del equipo.
 * Hoy toda respuesta lo es; cuando Fase 3 conteste sola, la misma definición
 * pasa a medir exactamente lo que una persona tuvo que atender.
 */
export type OperationsMetrics = {
  messagesReceived: number;
  activeConversations: number;
  firstResponse: FirstResponseMetrics;
  humanInterventions: { replies: number; conversations: number };
};

/** Distribución de las oportunidades abiertas en el periodo por su etapa actual. */
export type OpportunityStageCount = {
  stageId: string;
  stageName: string;
  position: number;
  pipelineId: string;
  pipelineName: string;
  count: number;
};

export type AppointmentStatusCount = {
  status: AppointmentStatus;
  count: number;
};

/**
 * Métricas comerciales: a cuánta gente nueva se atendió, qué se abrió y qué
 * terminó en una cita.
 *
 * La conversión son dos conteos, `created` y `withAppointment`, y no una tasa:
 * el porcentaje lo calcula quien lo muestra, y devolverlo además duplicaría la
 * definición en dos sitios que podrían divergir.
 */
export type CommercialMetrics = {
  newContacts: number;
  opportunities: {
    created: number;
    withAppointment: number;
    byStage: OpportunityStageCount[];
  };
  appointmentsByStatus: AppointmentStatusCount[];
};

export type MetricsSummary = {
  operations: OperationsMetrics;
  commercial: CommercialMetrics;
};

/**
 * Estado del agente. No se borra: se archiva, porque sus versiones y su
 * historial deben seguir explicando con qué configuración se respondió.
 */
export type AgentStatus = "active" | "archived";

/**
 * Estado de una revisión. `draft` es editable; `published` y `archived` no
 * vuelven a serlo nunca, así que `status !== "draft"` significa exactamente
 * «contenido congelado» (ADR-0014).
 */
export type AgentVersionStatus = "draft" | "published" | "archived";

/**
 * Qué ocurrió con la publicación. La deriva el servidor comparando ordinales:
 * quien llama no puede registrar un descenso de versión como una publicación.
 */
export type AgentPublicationAction =
  | "published"
  | "unpublished"
  | "rolled_back";

/**
 * Configuración reutilizable de la organización. El nombre, el propósito y el
 * estado se editan sin crear una versión: no describen comportamiento.
 *
 * `version` es concurrencia optimista de la configuración completa —agente,
 * versiones y declaraciones—, como en `pipelines`. No confundir con el ordinal
 * de una revisión.
 */
export type Agent = {
  id: string;
  organizationId: string;
  name: string;
  purpose: string | null;
  status: AgentStatus;
  publishedVersionId: string | null;
  publishedVersionNumber: number | null;
  version: number;
  createdAt: string;
  updatedAt: string;
};

/**
 * Revisión inmutable del comportamiento. `versionNumber` es el `agentVersion`
 * que los contratos transversales fijan en `AgentExecutionContext`.
 *
 * `tools` y `knowledgeScopes` son declaraciones sin catálogo: no autorizan
 * nada y nada las ejecuta todavía.
 */
export type AgentVersion = {
  id: string;
  organizationId: string;
  agentId: string;
  versionNumber: number;
  status: AgentVersionStatus;
  instructions: string;
  model: string;
  playbook: string | null;
  changeReason: string | null;
  tools: string[];
  knowledgeScopes: string[];
  createdByMembershipId: string;
  createdByName: string | null;
  createdAt: string;
  updatedAt: string;
};

/**
 * Entrada del historial de publicación. Es append-only y es el único dueño de
 * cuándo se publicó cada versión, con motivo obligatorio.
 */
export type AgentPublicationTransition = {
  id: string;
  organizationId: string;
  agentId: string;
  previousVersionId: string | null;
  previousVersionNumber: number | null;
  nextVersionId: string | null;
  nextVersionNumber: number | null;
  action: AgentPublicationAction;
  reason: string;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
};

export type AgentDetail = Agent & {
  versions: AgentVersion[];
  publications: AgentPublicationTransition[];
};

export type CreateAgentInput = {
  name: string;
  purpose?: string | null;
  createdByMembershipId: string;
};

export type UpdateAgentInput = {
  expectedVersion: number;
  name?: string;
  // `null` deja el agente sin propósito; omitirlo lo conserva.
  purpose?: string | null;
  status?: AgentStatus;
};

/** Lo que define el comportamiento y queda congelado al publicar. */
export type AgentVersionContent = {
  instructions: string;
  model: string;
  playbook?: string | null;
  tools?: string[];
  knowledgeScopes?: string[];
};

/**
 * Un borrador nace escrito o derivado de otra revisión. `content` y
 * `fromVersionId` son excluyentes: el router los resuelve antes de llamar.
 */
export type CreateAgentVersionInput = {
  expectedVersion: number;
  content: AgentVersionContent | null;
  fromVersionId: string | null;
  changeReason?: string | null;
  createdByMembershipId: string;
};

export type UpdateAgentVersionInput = AgentVersionContent & {
  expectedVersion: number;
  changeReason?: string | null;
};

/**
 * Publica, revierte o desactiva. `versionId` nulo deja al agente sin versión
 * publicada sin borrar ninguna.
 */
export type SetAgentPublicationInput = {
  expectedVersion: number;
  versionId: string | null;
  reason: string;
  actorId: string;
  correlationId: string;
};
