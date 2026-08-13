import { describe, expect, it } from "vitest";

import {
  mergeConversations,
  mergeMessages,
} from "../../src/client/lib/conversation-pagination";
import type { ConversationMessage, ConversationSummary } from "../../src/client/lib/api";

function message(overrides: Partial<ConversationMessage>): ConversationMessage {
  return {
    id: "message-1",
    direction: "incoming",
    senderType: "customer",
    senderId: null,
    messageType: "text",
    text: "Hola",
    status: "received",
    occurredAt: "2026-08-12T08:00:00.000Z",
    attachments: [],
    ...overrides,
  };
}

function conversation(overrides: Partial<ConversationSummary>): ConversationSummary {
  return {
    id: "conversation-1",
    contactId: "contact-1",
    contactDisplayName: "María",
    contactExternalId: "wa-1",
    channelDisplayName: "WhatsApp",
    status: "open",
    attentionMode: "human",
    version: 1,
    lastMessageAt: "2026-08-12T08:00:00.000Z",
    lastMessageText: "Hola",
    ...overrides,
  };
}

describe("fusión de páginas del historial", () => {
  it("conserva lo ya cargado al fusionar la primera página", () => {
    // Es la garantía que evita que el refresco de cada diez segundos descarte el
    // historial que el usuario acaba de cargar al subir.
    const older = [
      message({ id: "a", occurredAt: "2026-08-12T07:00:00.000Z" }),
      message({ id: "b", occurredAt: "2026-08-12T07:30:00.000Z" }),
    ];
    const refreshed = [message({ id: "c", occurredAt: "2026-08-12T08:00:00.000Z" })];

    expect(mergeMessages(older, refreshed).map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("aplica el estado nuevo de un mensaje ya conocido", () => {
    const previous = [message({ id: "a", status: "queued" })];
    const refreshed = [message({ id: "a", status: "delivered" })];

    const merged = mergeMessages(previous, refreshed);
    expect(merged).toHaveLength(1);
    expect(merged[0].status).toBe("delivered");
  });

  it("desempata por identificador cuando el timestamp coincide", () => {
    // El servidor ordena por la tupla completa; el cliente reproduce el mismo
    // criterio para que prepender no reordene lo ya visible.
    const tied = "2026-08-12T08:00:00Z";
    const merged = mergeMessages(
      [message({ id: "c", occurredAt: tied })],
      [message({ id: "a", occurredAt: tied }), message({ id: "b", occurredAt: tied })],
    );

    expect(merged.map((item) => item.id)).toEqual(["a", "b", "c"]);
  });

  it("ordena la lista por actividad descendente y sin duplicados", () => {
    const merged = mergeConversations(
      [
        conversation({ id: "vieja", lastMessageAt: "2026-08-10T08:00:00.000Z" }),
        conversation({ id: "media", lastMessageAt: "2026-08-11T08:00:00.000Z" }),
      ],
      [
        conversation({ id: "nueva", lastMessageAt: "2026-08-12T08:00:00.000Z" }),
        conversation({ id: "media", lastMessageAt: "2026-08-12T09:00:00.000Z" }),
      ],
    );

    // `media` subió porque recibió actividad, y aparece una sola vez.
    expect(merged.map((item) => item.id)).toEqual(["media", "nueva", "vieja"]);
  });
});
