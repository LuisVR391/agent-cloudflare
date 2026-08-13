export type OrganizationAccess = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
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

export type ConversationSummary = {
  id: string;
  contactId: string;
  contactDisplayName: string | null;
  contactExternalId: string;
  channelDisplayName: string | null;
  status: "open" | "resolved";
  attentionMode: "automatic" | "supervised" | "human" | "paused";
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

// El cursor es opaco: se reenvía tal como lo devolvió el servidor. El tamaño de
// página lo decide el Worker, así que el cliente no envía `limit`.
export async function listConversations(
  status: "open" | "resolved" = "open",
  cursor?: string,
) {
  const query = cursor ? `&cursor=${encodeURIComponent(cursor)}` : "";
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
  input: { expectedVersion: number; status?: "open" | "resolved"; attentionMode?: "human" | "paused" },
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
