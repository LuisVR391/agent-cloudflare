import { describe, expect, it } from "vitest";

import { zernioWebhookEventSchema } from "../src/worker/integrations/zernio/contracts";

const account = {
  id: "account-123",
  accountId: "account-123",
  profileId: "profile-123",
  platform: "whatsapp",
  username: "+5215550001111",
};

const message = {
  id: "message-123",
  conversationId: "conversation-123",
  platform: "whatsapp",
  platformMessageId: "wamid.123",
  direction: "outgoing",
  text: "Hola",
  attachments: [],
  sender: { id: "business-123" },
  sentAt: "2026-08-10T18:00:00Z",
  isRead: false,
};

describe("contratos de webhook de Zernio", () => {
  it.each(["message.delivered", "message.read", "message.failed"] as const)(
    "acepta el estado %s de WhatsApp",
    (event) => {
      expect(
        zernioWebhookEventSchema.safeParse({
          id: crypto.randomUUID(),
          event,
          message,
          statusAt: "2026-08-10T18:01:00Z",
          conversation: {
            id: "conversation-123",
            platformConversationId: "platform-conversation-123",
            status: "active",
          },
          account,
          timestamp: "2026-08-10T18:01:01Z",
        }).success,
      ).toBe(true);
    },
  );

  it("acepta una desconexión con identificadores opacos", () => {
    expect(
      zernioWebhookEventSchema.safeParse({
        id: crypto.randomUUID(),
        event: "account.disconnected",
        account: {
          accountId: "account-123",
          profileId: "profile-123",
          platform: "whatsapp",
          username: "+5215550001111",
          disconnectionType: "unintentional",
          reason: "Token expired",
        },
        timestamp: "2026-08-10T18:01:01Z",
      }).success,
    ).toBe(true);
  });

  it("rechaza message.sent porque no está suscrito", () => {
    expect(
      zernioWebhookEventSchema.safeParse({
        id: crypto.randomUUID(),
        event: "message.sent",
        message,
        account,
        timestamp: "2026-08-10T18:01:01Z",
      }).success,
    ).toBe(false);
  });
});
