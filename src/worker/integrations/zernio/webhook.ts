import { zernioWebhookEventSchema, type InboundQueueMessage } from "./contracts";
import { CommunicationChannelRepository } from "../../repositories/communication-channel-repository";
import { InboundWebhookEventRepository } from "../../repositories/inbound-webhook-event-repository";

const MAX_WEBHOOK_BYTES = 256 * 1_024;
const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export type ZernioWebhookEnv = {
  DB: D1Database;
  INBOUND_MESSAGES: Queue<InboundQueueMessage>;
  ZERNIO_WEBHOOK_SECRET?: string;
};

class BodyTooLargeError extends Error {}

function jsonError(
  status: number,
  code: string,
  message: string,
  correlationId: string,
): Response {
  return new Response(
    JSON.stringify({ error: { code, message, correlationId } }),
    { status, headers: jsonHeaders },
  );
}

function hexToBytes(value: string): Uint8Array<ArrayBuffer> | null {
  if (!/^[a-f0-9]{64}$/.test(value)) return null;
  const bytes = new Uint8Array(new ArrayBuffer(value.length / 2));
  for (let index = 0; index < value.length; index += 2) {
    bytes[index / 2] = Number.parseInt(value.slice(index, index + 2), 16);
  }
  return bytes;
}

async function verifySignature(
  body: Uint8Array,
  signature: string,
  secret: string,
): Promise<boolean> {
  const signatureBytes = hexToBytes(signature);
  if (signatureBytes === null) return false;
  const key = await crypto.subtle.importKey(
    "raw",
    new TextEncoder().encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["verify"],
  );
  return crypto.subtle.verify("HMAC", key, signatureBytes.buffer as ArrayBuffer, body.buffer as ArrayBuffer);
}

async function readBodyWithLimit(request: Request): Promise<Uint8Array<ArrayBuffer>> {
  const declaredLength = request.headers.get("content-length");
  if (declaredLength !== null && Number(declaredLength) > MAX_WEBHOOK_BYTES) {
    throw new BodyTooLargeError();
  }
  if (request.body === null) return new Uint8Array();

  const reader = request.body.getReader();
  const chunks: Uint8Array[] = [];
  let size = 0;
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    size += value.byteLength;
    if (size > MAX_WEBHOOK_BYTES) {
      await reader.cancel();
      throw new BodyTooLargeError();
    }
    chunks.push(value);
  }

  const body = new Uint8Array(new ArrayBuffer(size));
  let offset = 0;
  for (const chunk of chunks) {
    body.set(chunk, offset);
    offset += chunk.byteLength;
  }
  return body;
}

function externalAccountId(
  event: Exclude<
    ReturnType<typeof zernioWebhookEventSchema.parse>,
    { event: "webhook.test" }
  >,
): string {
  if (event.event === "account.disconnected") return event.account.accountId;
  return event.account.accountId ?? event.account.id;
}

function toQueueMessage(
  payload: Exclude<
    ReturnType<typeof zernioWebhookEventSchema.parse>,
    { event: "webhook.test" }
  >,
  organizationId: string,
  channelId: string,
  accountId: string,
  correlationId: string,
): InboundQueueMessage {
  const base = {
    eventId: payload.id,
    correlationId,
    organizationId,
    channelId,
    externalAccountId: accountId,
    occurredAt: payload.timestamp,
  };

  if (payload.event === "account.disconnected") {
    return { ...base, kind: "accountDisconnected" };
  }

  if (payload.event === "message.received") {
    return {
      ...base,
      kind: "messageReceived",
      externalConversationId: payload.conversation.id,
      externalMessageId: payload.message.id,
      platformMessageId: payload.message.platformMessageId,
      externalContactId:
        payload.message.sender.businessScopedUserId ??
        payload.message.sender.phoneNumber ??
        payload.message.sender.id,
      // El identificador externo puede ser el teléfono o un id opaco de la
      // cuenta; este campo conserva el número aunque no sea la identidad.
      contactPhoneNumber: payload.message.sender.phoneNumber ?? null,
      text: payload.message.text,
      attachments: payload.message.attachments,
    };
  }

  return {
    ...base,
    kind: "messageStatus",
    externalConversationId: payload.conversation.id,
    externalMessageId: payload.message.id,
    platformMessageId: payload.message.platformMessageId,
    status:
      payload.event === "message.sent"
        ? "sent"
        : payload.event === "message.delivered"
          ? "delivered"
        : payload.event === "message.read"
          ? "read"
          : "failed",
  };
}

export async function handleZernioWebhook(
  request: Request,
  env: ZernioWebhookEnv,
): Promise<Response> {
  const correlationId = crypto.randomUUID();
  if (request.method !== "POST") {
    return jsonError(405, "METHOD_NOT_ALLOWED", "Método no permitido.", correlationId);
  }
  if (!env.ZERNIO_WEBHOOK_SECRET) {
    return jsonError(
      503,
      "WEBHOOK_NOT_CONFIGURED",
      "El webhook no está configurado en este entorno.",
      correlationId,
    );
  }
  const signature = request.headers.get("x-zernio-signature");
  if (signature === null) {
    return jsonError(401, "SIGNATURE_REQUIRED", "Firma requerida.", correlationId);
  }

  let rawBody: Uint8Array;
  try {
    rawBody = await readBodyWithLimit(request);
  } catch (error) {
    if (error instanceof BodyTooLargeError) {
      return jsonError(413, "PAYLOAD_TOO_LARGE", "Payload demasiado grande.", correlationId);
    }
    throw error;
  }
  if (!(await verifySignature(rawBody, signature, env.ZERNIO_WEBHOOK_SECRET))) {
    return jsonError(401, "INVALID_SIGNATURE", "Firma inválida.", correlationId);
  }

  let json: unknown;
  try {
    json = JSON.parse(new TextDecoder().decode(rawBody));
  } catch {
    return jsonError(400, "INVALID_JSON", "JSON inválido.", correlationId);
  }
  const parsed = zernioWebhookEventSchema.safeParse(json);
  if (!parsed.success) {
    return jsonError(422, "INVALID_EVENT", "Evento no soportado o inválido.", correlationId);
  }
  const payload = parsed.data;
  const eventHeader = request.headers.get("x-zernio-event-id");
  if (eventHeader !== null && eventHeader !== payload.id) {
    return jsonError(400, "EVENT_ID_MISMATCH", "Identificador de evento inválido.", correlationId);
  }
  if (payload.event === "webhook.test") {
    return new Response(null, { status: 204 });
  }
  if (payload.account.platform !== "whatsapp") {
    return jsonError(422, "UNSUPPORTED_PLATFORM", "Plataforma no soportada.", correlationId);
  }

  const accountId = externalAccountId(payload);
  const channels = new CommunicationChannelRepository(env.DB);
  const channel = await channels.findActiveZernioAccount(accountId);
  if (
    channel === null ||
    (channel.externalProfileId !== null &&
      payload.account.profileId !== channel.externalProfileId)
  ) {
    return jsonError(422, "UNKNOWN_CHANNEL", "Canal no configurado.", correlationId);
  }

  const events = new InboundWebhookEventRepository(env.DB);
  const receipt = await events.register(channel.organizationId, {
    channelId: channel.id,
    adapter: "zernio",
    externalEventId: payload.id,
    eventType: payload.event,
    correlationId,
    receivedAt: payload.timestamp,
  });
  if (receipt.event.status === "enqueued" || receipt.event.status === "processed") {
    return new Response(null, { status: 200 });
  }

  try {
    await env.INBOUND_MESSAGES.send(
      toQueueMessage(
        payload,
        channel.organizationId,
        channel.id,
        accountId,
        correlationId,
      ),
      { contentType: "json" },
    );
    await events.markEnqueued(
      channel.organizationId,
      payload.id,
      new Date().toISOString(),
    );
  } catch {
    await events.markFailed(channel.organizationId, payload.id, "QUEUE_UNAVAILABLE");
    return jsonError(
      503,
      "QUEUE_UNAVAILABLE",
      "No se pudo aceptar el evento.",
      correlationId,
    );
  }

  return new Response(null, { status: receipt.created ? 202 : 200 });
}
