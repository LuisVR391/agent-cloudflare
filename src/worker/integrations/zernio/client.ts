import { z } from "zod";

const sendInputSchema = z.object({
  conversationId: z.string().min(1).max(512),
  accountId: z.string().min(1).max(512),
  message: z.string().min(1).max(65_536),
  idempotencyKey: z.string().min(1).max(255),
});

// Zernio solo puebla `conversationId` para Twitter y `sentAt` para Bluesky; en
// WhatsApp ambos llegan nulos y `messageId` es el único identificador devuelto.
// Exigirlos convertía cada envío correcto en `ZERNIO_RESPONSE_INVALID` y dejaba
// el mensaje sin ID externo con el que reconciliar sus estados.
const sendResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    messageId: z.string().min(1).max(512),
    conversationId: z.string().min(1).max(512).nullish(),
    sentAt: z.iso.datetime({ offset: true }).nullish(),
  }),
});

export type SendZernioTextMessageInput = z.infer<typeof sendInputSchema>;
export type SendZernioTextMessageResult = z.infer<typeof sendResponseSchema>["data"];
export type ZernioFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;
export type ZernioTransportFailureCategory =
  | "illegal_invocation"
  | "request_context"
  | "unknown";

function classifyTransportFailure(
  caught: unknown,
): ZernioTransportFailureCategory {
  if (!(caught instanceof Error)) return "unknown";
  const description = `${caught.name} ${caught.message}`.toLowerCase();
  if (description.includes("illegal invocation")) {
    return "illegal_invocation";
  }
  if (
    description.includes("request context") ||
    description.includes("different request")
  ) {
    return "request_context";
  }
  return "unknown";
}

export class ZernioApiError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`Zernio API respondió con estado ${status}.`);
    this.name = "ZernioApiError";
    this.status = status;
  }
}

export class ZernioResponseError extends Error {
  constructor() {
    super("Zernio API devolvió una respuesta inválida.");
    this.name = "ZernioResponseError";
  }
}

// Un medio que el proveedor ya no puede servir no se recupera reintentando: la
// ventana de retención de WhatsApp expiró o la credencial no autoriza la
// descarga. Separarlo del fallo transitorio evita consumir reintentos en vano.
export class ZernioMediaUnavailableError extends Error {
  readonly status: number;

  constructor(status: number) {
    super(`El medio no está disponible en el proveedor (estado ${status}).`);
    this.name = "ZernioMediaUnavailableError";
    this.status = status;
  }
}

export class ZernioTransportError extends Error {
  readonly category: ZernioTransportFailureCategory;

  constructor(category: ZernioTransportFailureCategory) {
    super("No fue posible confirmar la respuesta de Zernio.");
    this.name = "ZernioTransportError";
    this.category = category;
  }
}

export class ZernioClient {
  readonly #apiKey: string;
  readonly #baseUrl: string;
  readonly #fetch: ZernioFetch;

  constructor(
    apiKey: string,
    options: { baseUrl?: string; fetch?: ZernioFetch } = {},
  ) {
    if (apiKey.trim().length === 0) {
      throw new Error("La API key de Zernio es obligatoria.");
    }
    this.#apiKey = apiKey;
    this.#baseUrl = (options.baseUrl ?? "https://zernio.com/api/v1").replace(
      /\/$/,
      "",
    );
    const fetchImplementation = options.fetch ?? globalThis.fetch;
    this.#fetch = (input, init) => fetchImplementation(input, init);
  }

  async sendTextMessage(
    input: SendZernioTextMessageInput,
  ): Promise<SendZernioTextMessageResult> {
    const validated = sendInputSchema.parse(input);
    let response: Response;
    try {
      response = await this.#fetch(
        `${this.#baseUrl}/inbox/conversations/${encodeURIComponent(validated.conversationId)}/messages`,
        {
          method: "POST",
          headers: {
            Authorization: `Bearer ${this.#apiKey}`,
            "Content-Type": "application/json",
            "Idempotency-Key": validated.idempotencyKey,
          },
          body: JSON.stringify({
            accountId: validated.accountId,
            message: validated.message,
          }),
        },
      );
    } catch (caught) {
      throw new ZernioTransportError(classifyTransportFailure(caught));
    }
    if (!response.ok) {
      throw new ZernioApiError(response.status);
    }
    const parsed = sendResponseSchema.safeParse(
      await response.json().catch(() => null),
    );
    if (!parsed.success) throw new ZernioResponseError();
    return parsed.data.data;
  }

  // La URL llega dentro del payload del webhook, que es entrada no confiable: la
  // firma HMAC prueba el origen del evento, no su contenido. Por eso la
  // credencial solo se adjunta cuando el destino es exactamente el origen de la
  // API; cualquier otro host se rechaza antes de enviarla.
  async downloadWhatsAppMedia(input: {
    url: string;
    accountId: string;
  }): Promise<{ bytes: ArrayBuffer; contentType: string }> {
    const target = new URL(input.url);
    if (target.origin !== new URL(this.#baseUrl).origin) {
      throw new ZernioMediaUnavailableError(0);
    }
    // El endpoint exige la cuenta que recibió el medio; se añade si el proveedor
    // no la incluyó en la URL.
    if (!target.searchParams.has("accountId")) {
      target.searchParams.set("accountId", input.accountId);
    }

    let response: Response;
    try {
      // El endpoint sirve el binario desde el almacenamiento de medios, así que
      // puede responder con una redirección. Rechazarla dejaba toda descarga en
      // un fallo de transporte perpetuo. Seguirla es seguro aquí: la URL de
      // partida ya se validó contra el origen del proveedor y `fetch` descarta
      // la credencial al cambiar de origen.
      response = await this.#fetch(target, {
        headers: { Authorization: `Bearer ${this.#apiKey}` },
        redirect: "follow",
      });
    } catch (caught) {
      throw new ZernioTransportError(classifyTransportFailure(caught));
    }
    if (!response.ok) {
      // `400` significa que Meta descartó el medio y no volverá: reintentarlo
      // nunca tendrá éxito. `401`, `403` y `404` son permanentes por
      // configuración. El resto sí merece reintento.
      if (response.status < 500 && response.status !== 429) {
        throw new ZernioMediaUnavailableError(response.status);
      }
      throw new ZernioApiError(response.status);
    }
    return {
      bytes: await response.arrayBuffer(),
      contentType:
        response.headers.get("content-type")?.split(";", 1)[0]?.toLowerCase() ?? "",
    };
  }
}
