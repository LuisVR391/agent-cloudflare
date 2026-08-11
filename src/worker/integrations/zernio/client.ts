import { z } from "zod";

const sendInputSchema = z.object({
  conversationId: z.string().min(1).max(512),
  accountId: z.string().min(1).max(512),
  message: z.string().min(1).max(65_536),
  idempotencyKey: z.string().min(1).max(255),
});

const sendResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    messageId: z.string().min(1),
    conversationId: z.string().min(1),
    sentAt: z.iso.datetime({ offset: true }),
  }),
});

export type SendZernioTextMessageInput = z.infer<typeof sendInputSchema>;
export type SendZernioTextMessageResult = z.infer<typeof sendResponseSchema>["data"];
export type ZernioFetch = (
  input: RequestInfo | URL,
  init?: RequestInit,
) => Promise<Response>;

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

export class ZernioTransportError extends Error {
  constructor() {
    super("No fue posible confirmar la respuesta de Zernio.");
    this.name = "ZernioTransportError";
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
    this.#fetch = options.fetch ?? fetch;
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
    } catch {
      throw new ZernioTransportError();
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
}
