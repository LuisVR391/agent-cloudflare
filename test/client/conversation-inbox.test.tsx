import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationInbox } from "../../src/client/components/conversation-inbox";
import {
  getConversationMessages,
  listConversations,
  sendConversationMessage,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  sendConversationMessage: vi.fn(),
  updateConversation: vi.fn(),
}));

const conversation = {
  id: "conversation-1",
  contactDisplayName: "María",
  contactExternalId: "wa-contact-1",
  channelDisplayName: "WhatsApp principal",
  status: "open" as const,
  attentionMode: "human" as const,
  version: 1,
  lastMessageAt: "2026-08-10T18:00:00.000Z",
  lastMessageText: "Quiero información",
};

describe("inbox de conversaciones", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [conversation],
      nextCursor: null,
    });
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [{
        id: "message-1",
        direction: "incoming",
        senderType: "customer",
        messageType: "text",
        text: "Quiero información",
        status: "received",
        occurredAt: conversation.lastMessageAt,
        attachments: [],
      }],
    });
    vi.mocked(sendConversationMessage).mockResolvedValue(undefined);
  });

  it("abre el hilo y envía una respuesta humana", async () => {
    const user = userEvent.setup();
    render(<ConversationInbox />);
    expect(await screen.findByText("María")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /María/i }));
    expect((await screen.findAllByText("Quiero información")).length).toBeGreaterThanOrEqual(2);
    await user.type(screen.getByLabelText("Mensaje"), "Hola, con gusto.");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await waitFor(() => expect(sendConversationMessage)
      .toHaveBeenCalledWith("conversation-1", "Hola, con gusto.", expect.any(String)));
  });
  it("conserva la misma idempotencia al reintentar un fallo de encolado", async () => {
    const user = userEvent.setup();
    vi.mocked(sendConversationMessage)
      .mockRejectedValueOnce(new Error("Queue no disponible"))
      .mockResolvedValueOnce(undefined);
    render(<ConversationInbox />);
    await user.click(await screen.findByRole("button", { name: /María/i }));
    await user.type(screen.getByLabelText("Mensaje"), "Respuesta estable");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    expect(await screen.findByText("Queue no disponible")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));

    await waitFor(() => expect(sendConversationMessage).toHaveBeenCalledTimes(2));
    const firstRequestId = vi.mocked(sendConversationMessage).mock.calls[0][2];
    const secondRequestId = vi.mocked(sendConversationMessage).mock.calls[1][2];
    expect(secondRequestId).toBe(firstRequestId);
  });

  it("anuncia el inbox vacío según el filtro activo", async () => {
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [],
      nextCursor: null,
    });
    const user = userEvent.setup();
    render(<ConversationInbox />);

    expect(await screen.findByText("Sin conversaciones abiertas")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Resueltas" }));
    expect(await screen.findByText("Sin conversaciones resueltas")).toBeInTheDocument();
  });

  it("identifica un adjunto conservado por su nombre y ofrece abrirlo", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [{
        id: "message-media",
        direction: "incoming",
        senderType: "customer",
        messageType: "image",
        text: null,
        status: "received",
        occurredAt: conversation.lastMessageAt,
        attachments: [
          {
            id: "message-media:0",
            type: "image",
            contentType: "image/png",
            byteSize: 110_592,
            filename: "recibo-agosto.png",
            status: "stored",
            failureReason: null,
          },
          {
            id: "message-media:1",
            type: "audio",
            contentType: "audio/ogg",
            byteSize: 6_144,
            filename: null,
            status: "stored",
            failureReason: null,
          },
        ],
      }],
    });
    const user = userEvent.setup();
    render(<ConversationInbox />);
    await user.click(await screen.findByRole("button", { name: /María/i }));

    expect(await screen.findByText("recibo-agosto.png")).toBeInTheDocument();
    expect(screen.getByText("Imagen · 108 KiB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir recibo-agosto.png" })).toHaveAttribute(
      "href",
      "/api/conversations/conversation-1/attachments/message-media%3A0",
    );
    // Sin nombre declarado, la etiqueta del tipo identifica el adjunto.
    expect(screen.getByText("Audio · 6 KiB")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "Abrir Audio" })).toBeInTheDocument();
  });

  it("no ofrece enlace cuando el adjunto no pudo conservarse", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [{
        id: "message-rejected",
        direction: "incoming",
        senderType: "customer",
        messageType: "image",
        text: null,
        status: "received",
        occurredAt: conversation.lastMessageAt,
        attachments: [{
          id: "message-rejected:0",
          type: "image",
          contentType: null,
          byteSize: null,
          filename: "vencido.jpg",
          status: "rejected",
          failureReason: "ATTACHMENT_UNAVAILABLE_400",
        }],
      }],
    });
    const user = userEvent.setup();
    render(<ConversationInbox />);
    await user.click(await screen.findByRole("button", { name: /María/i }));

    expect(await screen.findByText("Imagen no disponible")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Abrir/ })).not.toBeInTheDocument();
  });

  it("anuncia un medio que no dejó adjunto en vez de una fila vacía", async () => {
    // Ocurre con los medios recibidos antes de que el canal los conservara: el
    // mensaje llega sin texto y sin adjuntos, y `messageType` es lo único que
    // dice qué era.
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [{
        id: "message-sin-medio",
        direction: "incoming",
        senderType: "customer",
        messageType: "audio",
        text: null,
        status: "received",
        occurredAt: conversation.lastMessageAt,
        attachments: [],
      }],
    });
    const user = userEvent.setup();
    render(<ConversationInbox />);
    await user.click(await screen.findByRole("button", { name: /María/i }));

    expect(await screen.findByText("Audio")).toBeInTheDocument();
    expect(screen.getByText("No se conservó desde el canal")).toBeInTheDocument();
  });

  it("muestra un fallo saliente con una etiqueta comprensible", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [{
        id: "message-failed",
        direction: "outgoing",
        senderType: "staff",
        messageType: "text",
        text: "No llegó",
        status: "failed",
        occurredAt: conversation.lastMessageAt,
        attachments: [],
      }],
    });
    const user = userEvent.setup();
    render(<ConversationInbox />);
    await user.click(await screen.findByRole("button", { name: /María/i }));
    expect(await screen.findByText(/No enviado/)).toBeInTheDocument();
  });
});
