import { describe, expect, it, vi } from "vitest";

import {
  ZernioApiError,
  ZernioClient,
  ZernioTransportError,
  type ZernioFetch,
} from "../src/worker/integrations/zernio/client";

describe("ZernioClient", () => {
  it("envía texto con bearer e idempotencia estable", async () => {
    const fetchMock = vi.fn<ZernioFetch>(async () =>
      Response.json({
        success: true,
        data: {
          messageId: "message-123",
          conversationId: "conversation/123",
          sentAt: "2026-08-10T18:00:00Z",
        },
      }),
    );
    const client = new ZernioClient("test-api-key", {
      fetch: fetchMock,
    });

    await expect(
      client.sendTextMessage({
        conversationId: "conversation/123",
        accountId: "account-123",
        message: "Hola",
        idempotencyKey: "organization-1:outbound-message-1",
      }),
    ).resolves.toMatchObject({ messageId: "message-123" });

    expect(fetchMock).toHaveBeenCalledOnce();
    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://zernio.com/api/v1/inbox/conversations/conversation%2F123/messages",
    );
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-api-key",
      "Idempotency-Key": "organization-1:outbound-message-1",
    });
    expect(JSON.parse(String(init?.body))).toEqual({
      accountId: "account-123",
      message: "Hola",
    });
  });

  it.each([
    { case: "nulos", conversationId: null, sentAt: null },
    { case: "ausentes", conversationId: undefined, sentAt: undefined },
  ])(
    "acepta la respuesta de WhatsApp con conversationId y sentAt $case",
    async ({ conversationId, sentAt }) => {
      const client = new ZernioClient("test-api-key", {
        fetch: async () =>
          Response.json({
            success: true,
            data: { messageId: "6a7c02f342e22321dc12dbd0", conversationId, sentAt },
          }),
      });

      await expect(
        client.sendTextMessage({
          conversationId: "6a7a42c2b3233b234cd4723b",
          accountId: "account-123",
          message: "Hola",
          idempotencyKey: "organization-1:outbound-message-1",
        }),
      ).resolves.toMatchObject({ messageId: "6a7c02f342e22321dc12dbd0" });
    },
  );

  it("marca la conversación como leída con bearer y accountId", async () => {
    const fetchMock = vi.fn<ZernioFetch>(async () =>
      Response.json({ success: true, markedCount: 2 }),
    );
    const client = new ZernioClient("test-api-key", { fetch: fetchMock });

    await expect(
      client.markConversationRead({
        conversationId: "conversation/123",
        accountId: "account-123",
      }),
    ).resolves.toEqual({ markedCount: 2 });

    const [url, init] = fetchMock.mock.calls[0];
    expect(url).toBe(
      "https://zernio.com/api/v1/inbox/conversations/conversation%2F123/read",
    );
    expect(init?.method).toBe("POST");
    expect(init?.headers).toMatchObject({ Authorization: "Bearer test-api-key" });
    expect(JSON.parse(String(init?.body))).toEqual({ accountId: "account-123" });
  });

  // `0` significa que el canal no tenía nada que marcar y debe distinguirse de
  // un `markedCount` ausente: es el dato que separa un acuse vacío de una cuenta
  // de coexistencia, donde el canal acepta pero no emite el acuse al contacto.
  it.each([
    { case: "ausente", body: { success: true }, expected: null },
    { case: "en cero", body: { success: true, markedCount: 0 }, expected: 0 },
  ])("acepta el acuse de lectura con markedCount $case", async ({ body, expected }) => {
    const client = new ZernioClient("test-api-key", {
      fetch: async () => Response.json(body),
    });

    await expect(
      client.markConversationRead({
        conversationId: "conversation-123",
        accountId: "account-123",
      }),
    ).resolves.toEqual({ markedCount: expected });
  });

  it("no expone el cuerpo de error del proveedor", async () => {
    const client = new ZernioClient("test-api-key", {
      fetch: async () =>
        Response.json(
          { error: "provider detail containing personal data" },
          { status: 422 },
        ),
    });

    const error = await client
      .sendTextMessage({
        conversationId: "conversation-123",
        accountId: "account-123",
        message: "Hola",
        idempotencyKey: "outbound-message-1",
      })
      .catch((reason: unknown) => reason);

    expect(error).toBeInstanceOf(ZernioApiError);
    expect((error as Error).message).not.toContain("personal data");
  });
  it("clasifica transporte y respuesta inválida sin exponer contenido", async () => {
    const transportClient = new ZernioClient("test-api-key", {
      fetch: async () => {
        throw new TypeError("network detail");
      },
    });
    const responseClient = new ZernioClient("test-api-key", {
      fetch: async () => Response.json({
        success: true,
        data: { conversationId: "conversation-123" },
      }),
    });
    const input = {
      conversationId: "conversation-123",
      accountId: "account-123",
      message: "Hola",
      idempotencyKey: "outbound-message-1",
    };

    await expect(transportClient.sendTextMessage(input))
      .rejects.toMatchObject({
        name: "ZernioTransportError",
        category: "unknown",
      });
    await expect(responseClient.sendTextMessage(input))
      .rejects.toMatchObject({ name: "ZernioResponseError" });
  });

  it.each([
    {
      failure: new TypeError("Illegal invocation: sensitive runtime detail"),
      category: "illegal_invocation",
    },
    {
      failure: new Error("Cannot perform I/O on behalf of a different request"),
      category: "request_context",
    },
  ] as const)(
    "clasifica $category sin exponer detalles del runtime",
    async ({ failure, category }) => {
      const client = new ZernioClient("test-api-key", {
        fetch: async () => {
          throw failure;
        },
      });

      const error = await client.sendTextMessage({
        conversationId: "conversation-123",
        accountId: "account-123",
        message: "Hola",
        idempotencyKey: "outbound-message-1",
      }).catch((reason: unknown) => reason);

      expect(error).toBeInstanceOf(ZernioTransportError);
      expect(error).toMatchObject({ category });
      expect((error as Error).message).not.toContain(failure.message);
    },
  );

  it.each(["global", "injected"] as const)(
    "invoca el fetch $case sin usar ZernioClient como contexto",
    async (fetchSource) => {
      let receivedThis: unknown = "not-called";
      const contextSensitiveFetch = async function (
        this: unknown,
      ): Promise<Response> {
        receivedThis = this;
        if (this !== undefined) throw new TypeError("Illegal invocation");
        return Response.json({
          success: true,
          data: {
            messageId: "message-123",
            conversationId: "conversation-123",
            sentAt: "2026-08-11T18:00:00Z",
          },
        });
      } satisfies ZernioFetch;
      if (fetchSource === "global") {
        vi.stubGlobal("fetch", contextSensitiveFetch);
      }
      const client = new ZernioClient("test-api-key", fetchSource === "global"
        ? {}
        : { fetch: contextSensitiveFetch });

      await expect(client.sendTextMessage({
        conversationId: "conversation-123",
        accountId: "account-123",
        message: "Hola",
        idempotencyKey: "outbound-message-1",
      })).resolves.toMatchObject({ messageId: "message-123" });
      expect(receivedThis).toBeUndefined();
      vi.unstubAllGlobals();
    },
  );
});
