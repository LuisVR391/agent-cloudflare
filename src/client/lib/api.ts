export type OrganizationAccess = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  /**
   * Zona horaria IANA con la que se interpreta y se muestra un día de agenda
   * (ADR-0010). Viaja con el contexto porque la decide la empresa, no el
   * navegador de quien mira.
   */
  organizationTimeZone: string;
  membershipId: string;
  role: "owner" | "manager" | "operator";
  permissions: string[];
};

export type AppContext = {
  user: { id: string; name: string; email: string };
  organizations: OrganizationAccess[];
  activeOrganization: OrganizationAccess | null;
  requiresOrganizationSelection: boolean;
};

type ErrorEnvelope = {
  error?: { code?: string; message?: string; correlationId?: string };
  message?: string;
};

async function parseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
  return body.error?.message ?? body.message ?? fallback;
}

export async function getSetupStatus(): Promise<boolean> {
  const response = await fetch("/api/setup/status", { credentials: "same-origin" });
  if (!response.ok) throw new Error("No fue posible comprobar la instalación.");
  const body = (await response.json()) as { required: boolean };
  return body.required;
}

export async function completeSetup(input: {
  setupToken: string;
  organizationName: string;
  organizationSlug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}): Promise<void> {
  const response = await fetch("/api/setup", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      await parseError(response, "No fue posible completar la configuración."),
    );
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(
      await parseError(response, "Correo o contraseña incorrectos."),
    );
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
  });
}

export async function getAppContext(): Promise<AppContext> {
  const response = await fetch("/api/context", { credentials: "same-origin" });
  if (response.status === 401) throw new Error("UNAUTHENTICATED");
  if (!response.ok) {
    throw new Error(
      await parseError(response, "No fue posible cargar tu espacio de trabajo."),
    );
  }
  return response.json() as Promise<AppContext>;
}

export async function selectOrganization(organizationId: string): Promise<void> {
  const response = await fetch("/api/context/organization", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) {
    throw new Error(
      await parseError(response, "No fue posible cambiar de organización."),
    );
  }
}

export type ConversationAssignee = {
  membershipId: string;
  userId: string;
  name: string;
};

export type ConversationSummary = {
  id: string;
  contactId: string;
  contactDisplayName: string | null;
  contactExternalId: string;
  channelDisplayName: string | null;
  status: "open" | "resolved";
  attentionMode: "automatic" | "supervised" | "human" | "paused";
  assignee: ConversationAssignee | null;
  version: number;
  lastMessageAt: string;
  lastMessageText: string | null;
};

export type ConversationMessage = {
  id: string;
  direction: "incoming" | "outgoing";
  senderType: "customer" | "staff" | "system";
  // Identifica al colaborador que respondió. Es opaco: distingue a un autor de
  // otro, pero no resuelve su nombre.
  senderId: string | null;
  messageType:
    | "text"
    | "image"
    | "video"
    | "audio"
    | "file"
    | "sticker"
    | "share"
    | "unsupported";
  text: string | null;
  status: "received" | "queued" | "sent" | "delivered" | "read" | "failed" | "delivery_unknown";
  occurredAt: string;
  attachments: Array<{
    id: string;
    type: "image" | "video" | "audio" | "file" | "sticker" | "share" | "unsupported";
    contentType: string | null;
    byteSize: number | null;
    filename: string | null;
    status: "stored" | "rejected";
    failureReason: string | null;
  }>;
};

/**
 * Filtro por responsable. `me` lo resuelve el backend con la membresía de la
 * sesión, así que el cliente no necesita conocer su identificador.
 */
export type AssigneeFilter = "all" | "me" | "unassigned" | (string & {});

// El cursor es opaco: se reenvía tal como lo devolvió el servidor. El tamaño de
// página lo decide el Worker, así que el cliente no envía `limit`.
export async function listConversations(
  status: "open" | "resolved" = "open",
  cursor?: string,
  assignee: AssigneeFilter = "all",
) {
  const query = [
    cursor ? `&cursor=${encodeURIComponent(cursor)}` : "",
    assignee === "all" ? "" : `&assignee=${encodeURIComponent(assignee)}`,
  ].join("");
  const response = await fetch(`/api/conversations?status=${status}${query}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las conversaciones."));
  return response.json() as Promise<{ conversations: ConversationSummary[]; nextCursor: string | null }>;
}

export async function getConversationMessages(conversationId: string, cursor?: string) {
  const query = cursor ? `?cursor=${encodeURIComponent(cursor)}` : "";
  const response = await fetch(
    `/api/conversations/${encodeURIComponent(conversationId)}/messages${query}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar la conversación."));
  return response.json() as Promise<{
    conversation: ConversationSummary;
    messages: ConversationMessage[];
    nextCursor: string | null;
  }>;
}

export async function sendConversationMessage(
  conversationId: string,
  text: string,
  clientRequestId: string,
) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}/messages`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ clientRequestId, text }),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible enviar el mensaje."));
}

export async function updateConversation(
  conversationId: string,
  input: {
    expectedVersion: number;
    status?: "open" | "resolved";
    attentionMode?: "human" | "paused";
    // Ausente conserva el responsable; `null` lo retira.
    assigneeMembershipId?: string | null;
  },
) {
  const response = await fetch(`/api/conversations/${encodeURIComponent(conversationId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible actualizar la conversación."));
}

/**
 * Simula un mensaje entrante. Solo existe en desarrollo: el Worker no incluye
 * la ruta en el artefacto construido, y quien la llama la monta dentro de
 * `import.meta.env.DEV`.
 */
export async function simulateInboundMessage(conversationId?: string) {
  const response = await fetch("/api/dev/inbound-messages", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(conversationId ? { conversationId } : {}),
  });
  if (!response.ok) {
    throw new Error(await parseError(response, "No fue posible simular el mensaje."));
  }
  return response.json() as Promise<{
    conversationId: string;
    phoneNumber: string;
    text: string;
  }>;
}

export type ContactTag = {
  id: string;
  name: string;
  // Token semántico, no un color literal: la variante visual la decide el tema.
  color: "neutral" | "info" | "success" | "warning" | "danger";
};

export type ContactProfile = {
  id: string;
  displayName: string | null;
  phoneNumber: string | null;
  email: string | null;
  status: "active" | "archived";
  version: number;
  createdAt: string;
  identities: Array<{ id: string; provider: "whatsapp"; externalId: string }>;
  tags: ContactTag[];
};

export async function listContacts(query?: string, cursor?: string) {
  const params = new URLSearchParams();
  if (query) params.set("query", query);
  if (cursor) params.set("cursor", cursor);
  const suffix = params.size > 0 ? `?${params}` : "";
  const response = await fetch(`/api/contacts${suffix}`, { credentials: "same-origin" });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar los contactos."));
  return response.json() as Promise<{ contacts: ContactProfile[]; nextCursor: string | null }>;
}

export async function getContact(contactId: string) {
  const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar el contacto."));
  const body = (await response.json()) as { contact: ContactProfile };
  return body.contact;
}

// Un campo ausente se conserva y `null` lo borra, igual que en el Worker.
export async function updateContact(
  contactId: string,
  input: {
    expectedVersion: number;
    displayName?: string | null;
    phoneNumber?: string | null;
    email?: string | null;
    status?: "active" | "archived";
  },
) {
  const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible actualizar el contacto."));
  const body = (await response.json()) as { contact: ContactProfile };
  return body.contact;
}

export async function addContactTag(contactId: string, name: string) {
  const response = await fetch(`/api/contacts/${encodeURIComponent(contactId)}/tags`, {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name }),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible etiquetar el contacto."));
  const body = (await response.json()) as { contact: ContactProfile };
  return body.contact;
}

export async function removeContactTag(contactId: string, tagId: string) {
  const response = await fetch(
    `/api/contacts/${encodeURIComponent(contactId)}/tags/${encodeURIComponent(tagId)}`,
    { method: "DELETE", credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible quitar la etiqueta."));
  const body = (await response.json()) as { contact: ContactProfile };
  return body.contact;
}

/**
 * Nota del contacto. `authorName` viaja resuelto porque la ficha lo muestra en
 * cada nota; es `null` si quien la escribió ya no está en el equipo.
 */
export type ContactNote = {
  id: string;
  contactId: string;
  conversationId: string | null;
  authorMembershipId: string;
  authorName: string | null;
  body: string;
  createdAt: string;
  updatedAt: string;
};

/** Las notas del contacto incluyen las escritas desde cualquier conversación. */
export async function listContactNotes(contactId: string) {
  const response = await fetch(
    `/api/notes?contactId=${encodeURIComponent(contactId)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las notas."));
  const body = (await response.json()) as { notes: ContactNote[] };
  return body.notes;
}

/**
 * El autor no viaja: lo resuelve el Worker con la membresía de la sesión.
 * `conversationId` ancla la nota al hilo desde el que se escribió.
 */
export async function createContactNote(input: {
  contactId: string;
  conversationId?: string | null;
  body: string;
}) {
  const response = await fetch("/api/notes", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible guardar la nota."));
  const body = (await response.json()) as { note: ContactNote };
  return body.note;
}

/**
 * Servicio del catálogo. El precio viaja como importe entero en la unidad
 * menor de su moneda, tal como lo persiste el Worker: convertirlo a decimal
 * aquí solo sirve para presentarlo.
 */
export type Service = {
  id: string;
  name: string;
  durationMinutes: number;
  priceAmountCents: number | null;
  priceCurrency: string | null;
  status: "active" | "archived";
  version: number;
  createdAt: string;
  updatedAt: string;
};

export type ServiceInput = {
  name: string;
  durationMinutes: number;
  price?: { amountCents: number; currency: string } | null;
  status?: Service["status"];
};

export async function listServices(status: "active" | "archived" | "all" = "active") {
  const response = await fetch(`/api/services?status=${status}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar los servicios."));
  const body = (await response.json()) as { services: Service[] };
  return body.services;
}

export async function createService(input: ServiceInput) {
  const response = await fetch("/api/services", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible crear el servicio."));
  const body = (await response.json()) as { service: Service };
  return body.service;
}

/**
 * Un campo ausente se conserva, igual que en el Worker. `price: null` borra
 * importe y moneda a la vez, porque uno sin el otro no significa nada.
 */
export async function updateService(
  serviceId: string,
  input: Partial<ServiceInput> & { expectedVersion: number },
) {
  const response = await fetch(`/api/services/${encodeURIComponent(serviceId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible actualizar el servicio."));
  const body = (await response.json()) as { service: Service };
  return body.service;
}

/** Token semántico; la interfaz lo traduce a una variante de componente. */
export type StageColor = "neutral" | "info" | "success" | "warning" | "danger";

export type PipelineStage = {
  id: string;
  pipelineId: string;
  name: string;
  position: number;
  color: StageColor;
};

/**
 * `version` cubre la configuración completa del pipeline: cualquier cambio en
 * sus etapas la incrementa, así que toda mutación debe enviar la vigente.
 */
export type Pipeline = {
  id: string;
  name: string;
  templateKey: string | null;
  version: number;
  stages: PipelineStage[];
};

export async function listPipelines() {
  const response = await fetch("/api/pipelines", { credentials: "same-origin" });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar el pipeline."));
  const body = (await response.json()) as { pipelines: Pipeline[] };
  return body.pipelines;
}

export async function createPipelineStage(
  pipelineId: string,
  input: { expectedVersion: number; name: string; color?: StageColor },
) {
  const response = await fetch(
    `/api/pipelines/${encodeURIComponent(pipelineId)}/stages`,
    {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible crear la etapa."));
  const body = (await response.json()) as { pipeline: Pipeline };
  return body.pipeline;
}

export async function updatePipelineStage(
  pipelineId: string,
  stageId: string,
  input: { expectedVersion: number; name?: string; color?: StageColor },
) {
  const response = await fetch(
    `/api/pipelines/${encodeURIComponent(pipelineId)}/stages/${encodeURIComponent(stageId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible actualizar la etapa."));
  const body = (await response.json()) as { pipeline: Pipeline };
  return body.pipeline;
}

/** El orden enumera todas las etapas del pipeline, no solo las que se mueven. */
export async function reorderPipelineStages(
  pipelineId: string,
  input: { expectedVersion: number; stageIds: string[] },
) {
  const response = await fetch(
    `/api/pipelines/${encodeURIComponent(pipelineId)}/stages/order`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible reordenar las etapas."));
  const body = (await response.json()) as { pipeline: Pipeline };
  return body.pipeline;
}

/**
 * Oportunidad comercial. Los nombres de contacto, etapa y servicio viajan
 * resueltos porque el tablero los necesita en cada tarjeta.
 */
export type Opportunity = {
  id: string;
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

/** `truncated` avisa de que el tablero llegó al límite pedido. */
export async function listPipelineOpportunities(pipelineId: string, limit = 100) {
  const response = await fetch(
    `/api/opportunities?pipelineId=${encodeURIComponent(pipelineId)}&limit=${limit}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las oportunidades."));
  return response.json() as Promise<{
    opportunities: Opportunity[];
    limit: number;
    truncated: boolean;
  }>;
}

export async function listContactOpportunities(contactId: string) {
  const response = await fetch(
    `/api/opportunities?contactId=${encodeURIComponent(contactId)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las oportunidades."));
  const body = (await response.json()) as { opportunities: Opportunity[] };
  return body.opportunities;
}

export async function createOpportunity(input: {
  contactId: string;
  conversationId?: string | null;
  pipelineId?: string;
  stageId?: string;
  serviceId?: string | null;
}) {
  const response = await fetch("/api/opportunities", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible crear la oportunidad."));
  const body = (await response.json()) as { opportunity: OpportunityDetail };
  return body.opportunity;
}

/** Mover de etapa registra una transición; cambiar el servicio no. */
export async function updateOpportunity(
  opportunityId: string,
  input: {
    expectedVersion: number;
    stageId?: string;
    serviceId?: string | null;
  },
) {
  const response = await fetch(
    `/api/opportunities/${encodeURIComponent(opportunityId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible mover la oportunidad."));
  const body = (await response.json()) as { opportunity: OpportunityDetail };
  return body.opportunity;
}

export type TaskStatus = "open" | "done" | "cancelled";

/** El sujeto de una tarea: a lo sumo uno, y ninguno también es válido. */
export type TaskSubject =
  | { type: "contact"; id: string }
  | { type: "conversation"; id: string }
  | { type: "opportunity"; id: string }
  | null;

/**
 * Tarea con responsable y vencimiento. El nombre del responsable y la etiqueta
 * del sujeto viajan resueltos porque la lista los muestra en cada fila.
 */
export type Task = {
  id: string;
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
 * `me` lo resuelve el backend con la membresía de la sesión, igual que el
 * filtro de conversaciones: el cliente no necesita conocer su identificador.
 */
export type TaskAssigneeFilter = "all" | "me" | (string & {});

/** `truncated` avisa de que la lista llegó al límite pedido. */
export async function listTasks(
  filters: {
    assignee?: TaskAssigneeFilter;
    status?: TaskStatus;
    dueBefore?: string;
  } = {},
) {
  const params = new URLSearchParams();
  if (filters.assignee && filters.assignee !== "all") {
    params.set("assignee", filters.assignee);
  }
  if (filters.status) params.set("status", filters.status);
  if (filters.dueBefore) params.set("dueBefore", filters.dueBefore);
  const suffix = params.size > 0 ? `?${params}` : "";
  const response = await fetch(`/api/tasks${suffix}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las tareas."));
  return response.json() as Promise<{
    tasks: Task[];
    limit: number;
    truncated: boolean;
  }>;
}

/** Tareas colgadas de un contacto, una conversación o una oportunidad. */
export async function listSubjectTasks(subject: NonNullable<TaskSubject>) {
  const response = await fetch(
    `/api/tasks?subjectType=${subject.type}&subjectId=${encodeURIComponent(subject.id)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las tareas."));
  const body = (await response.json()) as { tasks: Task[] };
  return body.tasks;
}

/**
 * Sin `assigneeMembershipId` la tarea queda a nombre de quien la crea, que es
 * la membresía de la sesión. `dueAt` viaja en ISO 8601 UTC.
 */
export async function createTask(input: {
  title: string;
  details?: string | null;
  assigneeMembershipId?: string;
  dueAt?: string | null;
  subject?: TaskSubject;
}) {
  const response = await fetch("/api/tasks", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible crear la tarea."));
  const body = (await response.json()) as { task: Task };
  return body.task;
}

/** Campos ausentes se conservan; `dueAt: null` retira el vencimiento. */
export async function updateTask(
  taskId: string,
  input: {
    expectedVersion: number;
    title?: string;
    details?: string | null;
    assigneeMembershipId?: string;
    dueAt?: string | null;
    status?: TaskStatus;
  },
) {
  const response = await fetch(`/api/tasks/${encodeURIComponent(taskId)}`, {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible actualizar la tarea."));
  const body = (await response.json()) as { task: Task };
  return body.task;
}

/**
 * Ciclo de vida de una cita. `rescheduled` es un estado y no solo un hecho del
 * historial: una cita movida y sin reconfirmar no está en la misma situación
 * que una confirmada.
 */
export type AppointmentStatus =
  | "requested"
  | "pending"
  | "confirmed"
  | "rescheduled"
  | "cancelled"
  | "completed"
  | "no_show";

/** Cada cambio de estado o de horario, tal como lo conserva el historial. */
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

/**
 * Cita con su intervalo en ISO 8601 UTC. El contacto, el servicio y el
 * responsable viajan resueltos porque la agenda los muestra en cada fila.
 */
export type Appointment = {
  id: string;
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

export type AppointmentDetail = Appointment & {
  transitions: AppointmentTransition[];
};

export type AgendaRange = "day" | "week";

/**
 * Agenda de un día o una semana. La fecha viaja como día civil —`YYYY-MM-DD`— y
 * el backend la interpreta con la zona horaria de la organización: si el
 * navegador resolviera el rango, dos personas verían agendas distintas de la
 * misma empresa. `window` devuelve el rango UTC que se consultó.
 */
export async function listAppointments(
  filters: {
    date?: string;
    range?: AgendaRange;
    assignee?: TaskAssigneeFilter;
    status?: AppointmentStatus;
  } = {},
) {
  const params = new URLSearchParams();
  if (filters.date) params.set("date", filters.date);
  if (filters.range) params.set("range", filters.range);
  if (filters.assignee && filters.assignee !== "all") {
    params.set("assignee", filters.assignee);
  }
  if (filters.status) params.set("status", filters.status);
  const suffix = params.size > 0 ? `?${params}` : "";
  const response = await fetch(`/api/appointments${suffix}`, {
    credentials: "same-origin",
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar la agenda."));
  return response.json() as Promise<{
    appointments: Appointment[];
    timeZone: string;
    date: string;
    range: AgendaRange;
    window: { from: string; to: string };
    limit: number;
    truncated: boolean;
  }>;
}

/** Citas de un contacto, una conversación o una oportunidad. */
export async function listSubjectAppointments(subject: {
  type: "contact" | "conversation" | "opportunity";
  id: string;
}) {
  const response = await fetch(
    `/api/appointments?subjectType=${subject.type}&subjectId=${encodeURIComponent(subject.id)}`,
    { credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las citas."));
  const body = (await response.json()) as { appointments: Appointment[] };
  return body.appointments;
}

/**
 * Sin `endsAt`, el fin se deriva de la duración del servicio en el backend. El
 * origen no es excluyente: una cita puede nacer en una conversación y
 * pertenecer a la oportunidad que esa conversación abrió.
 */
export async function createAppointment(input: {
  contactId: string;
  serviceId: string;
  startsAt: string;
  endsAt?: string;
  assigneeMembershipId?: string | null;
  conversationId?: string | null;
  opportunityId?: string | null;
  status?: Extract<AppointmentStatus, "requested" | "pending" | "confirmed">;
}) {
  const response = await fetch("/api/appointments", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible agendar la cita."));
  const body = (await response.json()) as { appointment: AppointmentDetail };
  return body.appointment;
}

/**
 * Campos ausentes se conservan. Cambiar el horario deja la cita en
 * `rescheduled` sin pedirlo, salvo cuando solo estaba solicitada; una
 * transición que el ciclo no declara la rechaza el backend.
 */
export async function updateAppointment(
  appointmentId: string,
  input: {
    expectedVersion: number;
    startsAt?: string;
    endsAt?: string;
    assigneeMembershipId?: string | null;
    status?: AppointmentStatus;
  },
) {
  const response = await fetch(
    `/api/appointments/${encodeURIComponent(appointmentId)}`,
    {
      method: "PATCH",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(input),
    },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible actualizar la cita."));
  const body = (await response.json()) as { appointment: AppointmentDetail };
  return body.appointment;
}

/**
 * Zona horaria con la que se interpreta la agenda. La decide la empresa, no el
 * navegador de quien mira, y solo la cambia quien administra la organización.
 */
export async function updateOrganizationTimeZone(timeZone: string) {
  const response = await fetch("/api/organization", {
    method: "PATCH",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ timeZone }),
  });
  if (!response.ok) {
    throw new Error(
      await parseError(response, "No fue posible cambiar la zona horaria."),
    );
  }
  const body = (await response.json()) as {
    organization: { id: string; displayName: string; timeZone: string };
  };
  return body.organization;
}

export type TeamRole = "owner" | "manager" | "operator";

export type TeamMember = {
  membershipId: string;
  userId: string;
  name: string;
  email: string;
  role: TeamRole;
  status: "active" | "suspended" | "revoked";
  joinedAt: string;
};

export type TeamInvitation = {
  id: string;
  email: string;
  role: TeamRole;
  status: "pending" | "accepting" | "accepted" | "revoked" | "expired";
  expiresAt: string;
  invitedBy: string;
  createdAt: string;
};

export async function listTeamMembers() {
  const response = await fetch("/api/team/members", { credentials: "same-origin" });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar el equipo."));
  const body = (await response.json()) as { members: TeamMember[] };
  return body.members;
}

export async function listTeamInvitations() {
  const response = await fetch("/api/team/invitations", { credentials: "same-origin" });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible cargar las invitaciones."));
  const body = (await response.json()) as { invitations: TeamInvitation[] };
  return body.invitations;
}

/**
 * El enlace vuelve una sola vez, en esta respuesta. Ninguna lectura posterior
 * puede recuperarlo: el servidor solo conserva el hash del token.
 */
export async function createTeamInvitation(input: {
  email: string;
  role: TeamRole;
  expiresInHours?: number;
}) {
  const response = await fetch("/api/team/invitations", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible crear la invitación."));
  return response.json() as Promise<{
    invitation: TeamInvitation;
    acceptUrl: string;
  }>;
}

export async function revokeTeamInvitation(invitationId: string) {
  const response = await fetch(
    `/api/team/invitations/${encodeURIComponent(invitationId)}/revoke`,
    { method: "POST", credentials: "same-origin" },
  );
  if (!response.ok) throw new Error(await parseError(response, "No fue posible revocar la invitación."));
  const body = (await response.json()) as { invitation: TeamInvitation };
  return body.invitation;
}

/**
 * El token viaja en el cuerpo y nunca en la URL: una query llegaría al servidor
 * en la navegación y quedaría en el historial del navegador.
 */
export async function previewInvitation(token: string) {
  const response = await fetch("/api/invitations/preview", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ token }),
  });
  if (!response.ok) throw new Error(await parseError(response, "La invitación no está disponible."));
  const body = (await response.json()) as {
    invitation: { organizationName: string; role: TeamRole; expiresAt: string };
  };
  return body.invitation;
}

export async function acceptInvitation(input: {
  token: string;
  email: string;
  name: string;
  password: string;
}) {
  const response = await fetch("/api/invitations/accept", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) throw new Error(await parseError(response, "No fue posible aceptar la invitación."));
  const body = (await response.json()) as { organization: { name: string } };
  return body.organization;
}
