import { describe, expect, it, vi } from "vitest";

import {
  ZernioApiError,
  ZernioClient,
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
        data: { messageId: "incomplete" },
      }),
    });
    const input = {
      conversationId: "conversation-123",
      accountId: "account-123",
      message: "Hola",
      idempotencyKey: "outbound-message-1",
    };

    await expect(transportClient.sendTextMessage(input))
      .rejects.toMatchObject({ name: "ZernioTransportError" });
    await expect(responseClient.sendTextMessage(input))
      .rejects.toMatchObject({ name: "ZernioResponseError" });
  });
});
