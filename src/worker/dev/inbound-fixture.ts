import { z } from "zod";

import { getConfiguredAuthOrigin } from "../auth/auth";
import { error, resolveAuthorizationContext } from "../auth/http";
import type { WorkerEnv } from "../auth/types";
import { json } from "../http/api-helpers";
import type { InboundQueueMessage } from "../integrations/zernio/contracts";
import { handleZernioWebhook } from "../integrations/zernio/webhook";
import { CommunicationChannelRepository } from "../repositories/communication-channel-repository";

/**
 * Simulación de un mensaje entrante para desarrollo local.
 *
 * Una base recién migrada abre el panel vacío, y sembrarla desde una terminal
 * obliga a salir del navegador en mitad de una validación. Esta ruta existe
 * solo para eso.
 *
 * Inyectar mensajes falsos es exactamente lo que nunca debe llegar a un
 * entorno real, así que el módulo se protege por capas y ninguna basta sola:
 *
 * 1. `src/worker/index.ts` solo lo importa dentro de `import.meta.env.DEV`, de
 *    modo que el bundle construido no lo contiene. `scripts/validate-staging-build.mjs`
 *    comprueba esa ausencia en cada `npm run check`.
 * 2. Aquí mismo, una petición cuyo host no sea local se trata como ruta
 *    inexistente.
 * 3. La petición exige sesión válida y `conversations.manage`, como cualquier
 *    otra escritura del panel.
 *
 * La simulación no escribe en D1: firma un evento y lo entrega al webhook
 * real, de modo que el mensaje recorre firma, deduplicación, cola, Durable
 * Object y D1 igual que uno del proveedor. Insertar filas se saltaría justo lo
 * que conviene ejercitar.
 */

export type DevFixtureEnv = WorkerEnv & {
  INBOUND_MESSAGES: Queue<InboundQueueMessage>;
  ZERNIO_WEBHOOK_SECRET?: string;
};

const DEV_ACCOUNT_ID = "local-account-1";
const PATHNAME = "/api/dev/inbound-messages";

const requestSchema = z
  .object({
    // Presente cuando se simula un mensaje dentro de un hilo ya abierto. Es el
    // identificador interno, que es lo único que el panel conoce.
    conversationId: z.uuid().optional(),
  })
  .default({});

/**
 * El nombre viaja en el texto, nunca en la ficha: el webhook real no entrega
 * el nombre del contacto, y escribirlo aquí daría por buena una capacidad que
 * el canal no tiene.
 */
const firstNames = [
  "Lucía",
  "Marisol",
  "Diana",
  "Fernanda",
  "Alejandra",
  "Renata",
  "Ximena",
  "Paulina",
];

const openings = [
  "quiero información de precios",
  "¿tienen espacio hoy?",
  "me gustaría agendar un corte",
  "¿cuánto cuesta el balayage?",
  "vi su perfil y quiero cita",
];

const followUps = [
  "¿y para el sábado por la mañana?",
  "perfecto, ¿cuánto tardaría?",
  "gracias, lo consulto y les digo",
  "¿aceptan tarjeta?",
  "¿me pueden mandar fotos de trabajos?",
];

function pick<T>(values: readonly T[]): T {
  return values[Math.floor(Math.random() * values.length)];
}

/** Diez dígitos con el prefijo internacional que entrega el canal real. */
function randomPhoneNumber(): string {
  const digits = Array.from({ length: 10 }, () =>
    Math.floor(Math.random() * 10),
  ).join("");
  return `+52${digits}`;
}

function isLocalHost(hostname: string): boolean {
  return hostname === "localhost" || hostname === "127.0.0.1";
}

/**
 * El entorno es local cuando su origen de autenticación lo es. Se comprueba
 * eso, y no solo el `Host` de la petición, porque el encabezado lo fija quien
 * llama y un proxy podría escribir cualquier cosa; `BETTER_AUTH_URL` es
 * configuración del entorno y en staging apunta a `workers.dev`.
 */
function isLocalEnvironment(request: Request, env: DevFixtureEnv): boolean {
  const authOrigin = getConfiguredAuthOrigin(env);
  if (authOrigin === null) return false;
  return (
    isLocalHost(new URL(authOrigin).hostname) &&
    isLocalHost(new URL(request.url).hostname)
  );
}

/**
 * El canal es lo que permite al webhook resolver organización y conversación.
 * Se crea a través del repositorio, no con SQL suelto.
 *
 * No hace falta tocar `buffer_seconds`: el mensaje se persiste antes de
 * entregarse al runtime, así que la ventana de agrupación retrasa el
 * procesamiento del agente, no su aparición en el inbox.
 */
async function ensureDevChannel(
  env: DevFixtureEnv,
  organizationId: string,
): Promise<{ ok: true } | { ok: false; reason: string }> {
  const channels = new CommunicationChannelRepository(env.DB);
  const existing = await channels.findActiveZernioAccount(DEV_ACCOUNT_ID);
  if (existing) {
    // La cuenta es única globalmente: si pertenece a otra organización,
    // reutilizarla cruzaría el límite de aislamiento.
    return existing.organizationId === organizationId
      ? { ok: true }
      : { ok: false, reason: "El canal local pertenece a otra organización." };
  }

  await channels.create(organizationId, {
    provider: "whatsapp",
    adapter: "zernio",
    externalAccountId: DEV_ACCOUNT_ID,
    displayName: "WhatsApp local",
  });
  return { ok: true };
}

/**
 * Traduce el identificador interno de la conversación a los valores que el
 * canal usaría: el hilo externo y la identidad del contacto. Sin esto, un
 * segundo mensaje abriría una conversación nueva en vez de continuar la que
 * está abierta.
 *
 * La consulta vive aquí y no en un repositorio porque solo la necesita este
 * utillaje, y añadirla a `ConversationRepository` metería en el código
 * desplegado una lectura que el producto no usa. Va filtrada por organización,
 * como cualquier otra.
 */
async function resolveExistingThread(
  env: DevFixtureEnv,
  organizationId: string,
  conversationId: string,
): Promise<{ externalConversationId: string; phoneNumber: string } | null> {
  const row = await env.DB.prepare(
    `SELECT c.external_conversation_id, i.external_id
       FROM conversations c
       JOIN contact_identities i ON i.organization_id = c.organization_id
        AND i.contact_id = c.contact_id AND i.provider = 'whatsapp'
      WHERE c.organization_id = ? AND c.id = ?`,
  )
    .bind(organizationId, conversationId)
    .first<{ external_conversation_id: string; external_id: string }>();

  return row === null
    ? null
    : {
        externalConversationId: row.external_conversation_id,
        phoneNumber: row.external_id,
      };
}

async function sign(body: string, secret: string): Promise<string> {
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const signature = await crypto.subtle.sign(
    "HMAC",
    key,
    new TextEncoder().encode(body),
  );
  return [...new Uint8Array(signature)]
    .map((byte) => byte.toString(16).padStart(2, "0"))
    .join("");
}

export async function routeDevFixtureApi(
  request: Request,
  env: DevFixtureEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== PATHNAME) return null;
  // Fuera de un entorno local la ruta no recibe una negativa explicativa:
  // simplemente no existe.
  if (!isLocalEnvironment(request, env)) return null;

  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  if (request.method !== "POST") {
    return error(
      405,
      "METHOD_NOT_ALLOWED",
      "El método solicitado no está permitido.",
      correlationId,
    );
  }

  const authorization = await resolveAuthorizationContext(request, env);
  if (!authorization.authorized) {
    return error(
      authorization.status,
      authorization.code,
      authorization.message,
      correlationId,
    );
  }
  const { context } = authorization;
  if (!context.activeOrganization.permissions.includes("conversations.manage")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para simular mensajes.",
      correlationId,
    );
  }
  if (!env.ZERNIO_WEBHOOK_SECRET) {
    return error(
      503,
      "WEBHOOK_NOT_CONFIGURED",
      "Define ZERNIO_WEBHOOK_SECRET en .dev.vars para simular mensajes.",
      correlationId,
    );
  }

  const parsed = requestSchema.safeParse(await request.json().catch(() => ({})));
  if (!parsed.success) {
    return error(
      400,
      "INVALID_FIXTURE",
      "La simulación solicitada no es válida.",
      correlationId,
    );
  }

  const organizationId = context.activeOrganization.organizationId;
  const channel = await ensureDevChannel(env, organizationId);
  if (!channel.ok) {
    return error(409, "DEV_CHANNEL_CONFLICT", channel.reason, correlationId);
  }

  const existing = parsed.data.conversationId
    ? await resolveExistingThread(
        env,
        organizationId,
        parsed.data.conversationId,
      )
    : null;
  if (parsed.data.conversationId && existing === null) {
    return error(
      404,
      "NOT_FOUND",
      "La conversación solicitada no existe.",
      correlationId,
    );
  }

  const phoneNumber = existing?.phoneNumber ?? randomPhoneNumber();
  const conversationId =
    existing?.externalConversationId ?? `local-${crypto.randomUUID()}`;
  const eventId = `local-event-${crypto.randomUUID()}`;
  const now = new Date().toISOString();
  const text = existing
    ? pick(followUps)
    : `Hola, soy ${pick(firstNames)}, ${pick(openings)}`;

  const body = JSON.stringify({
    id: eventId,
    event: "message.received",
    timestamp: now,
    account: {
      id: DEV_ACCOUNT_ID,
      accountId: DEV_ACCOUNT_ID,
      platform: "whatsapp",
      username: "salon-local",
      displayName: "WhatsApp local",
    },
    conversation: {
      id: conversationId,
      platformConversationId: `wa-${conversationId}`,
      status: "active",
    },
    message: {
      id: `${eventId}-message`,
      conversationId,
      platform: "whatsapp",
      platformMessageId: `wamid-${eventId}`,
      direction: "incoming",
      text,
      attachments: [],
      sender: { id: `wa-sender-${phoneNumber}`, phoneNumber },
      sentAt: now,
      isRead: false,
    },
  });

  const webhookResponse = await handleZernioWebhook(
    new Request(`${url.origin}/webhooks/zernio`, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "x-zernio-signature": await sign(body, env.ZERNIO_WEBHOOK_SECRET),
        "x-zernio-event-id": eventId,
      },
      body,
    }),
    env,
  );
  if (!webhookResponse.ok) {
    // El motivo del webhook viaja al panel: sin él, un fallo local se
    // diagnostica a ciegas.
    const detail = await webhookResponse.text().catch(() => "");
    return error(
      502,
      "FIXTURE_REJECTED",
      `El webhook rechazó el mensaje simulado (${webhookResponse.status}). ${detail}`.trim(),
      correlationId,
    );
  }

  return json({ conversationId, phoneNumber, text }, 202);
}
