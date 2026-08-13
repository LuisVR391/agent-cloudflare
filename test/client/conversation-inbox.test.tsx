import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationInbox } from "../../src/client/components/conversation-inbox";
import {
  getConversationMessages,
  listConversations,
  sendConversationMessage,
  type ConversationMessage,
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

const panelContext = {
  user: { id: "user-1", name: "Ana Propietaria", email: "ana@example.com" },
  organizations: [],
  activeOrganization: {
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Salón Uno",
    organizationSlug: "salon-uno",
    membershipId: "membership-1",
    role: "owner" as const,
    permissions: ["conversations.read", "conversations.manage"],
  },
  requiresOrganizationSelection: false,
};

// El inbox toma la identidad de la sesión del contexto del shell, así que la
// prueba lo monta dentro de una ruta que lo provee.
function renderInbox() {
  return render(
    <MemoryRouter initialEntries={["/app/conversaciones"]}>
      <Routes>
        <Route element={<Outlet context={panelContext} />} path="/app">
          <Route element={<ConversationInbox />} path="conversaciones" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

function message(overrides: Partial<ConversationMessage> = {}): ConversationMessage {
  return {
    id: "message-1",
    direction: "incoming",
    senderType: "customer",
    senderId: null,
    messageType: "text",
    text: "Quiero información",
    status: "received",
    occurredAt: conversation.lastMessageAt,
    attachments: [],
    ...overrides,
  };
}

async function openThread() {
  const user = userEvent.setup();
  renderInbox();
  await user.click(await screen.findByRole("button", { name: /María/i }));
  return user;
}

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
      messages: [message()],
    });
    vi.mocked(sendConversationMessage).mockResolvedValue(undefined);
  });

  it("abre el hilo y envía una respuesta humana", async () => {
    const user = userEvent.setup();
    renderInbox();
    expect(await screen.findByText("María")).toBeInTheDocument();
    await user.click(screen.getByRole("button", { name: /María/i }));
    expect((await screen.findAllByText("Quiero información")).length).toBeGreaterThanOrEqual(2);
    await user.type(screen.getByLabelText("Mensaje"), "Hola, con gusto.");
    await user.click(screen.getByRole("button", { name: "Enviar mensaje" }));
    await waitFor(() => expect(sendConversationMessage)
      .toHaveBeenCalledWith("conversation-1", "Hola, con gusto.", expect.any(String)));
  });

  it("conserva la misma idempotencia al reintentar un fallo de encolado", async () => {
    vi.mocked(sendConversationMessage)
      .mockRejectedValueOnce(new Error("Queue no disponible"))
      .mockResolvedValueOnce(undefined);
    const user = await openThread();
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
    renderInbox();

    expect(await screen.findByText("Sin conversaciones abiertas")).toBeInTheDocument();
    await user.click(screen.getByRole("tab", { name: "Resueltas" }));
    expect(await screen.findByText("Sin conversaciones resueltas")).toBeInTheDocument();
  });

  it("enfrenta el mensaje entrante y el saliente en lados opuestos", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [
        message({ id: "in-1", text: "¿Tienen espacio hoy?" }),
        message({
          id: "out-1",
          direction: "outgoing",
          senderType: "staff",
          senderId: panelContext.user.id,
          text: "Claro que sí",
          status: "sent",
        }),
      ],
    });
    await openThread();

    await screen.findByText("¿Tienen espacio hoy?");
    const rows = document.querySelectorAll('[data-slot="message"]');
    expect([...rows].map((row) => row.getAttribute("data-align"))).toEqual(["start", "end"]);
  });

  it("identifica al contacto y a quien responde", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [
        message({ id: "in-1" }),
        message({
          id: "out-1",
          direction: "outgoing",
          senderType: "staff",
          senderId: panelContext.user.id,
          text: "Con gusto",
          status: "sent",
        }),
        message({
          id: "out-2",
          direction: "outgoing",
          senderType: "staff",
          senderId: "otro-colaborador",
          text: "Yo le doy seguimiento",
          status: "sent",
        }),
      ],
    });
    await openThread();

    // El contacto se identifica por su nombre y sus iniciales.
    expect(await screen.findByText("Ana Propietaria")).toBeInTheDocument();
    expect(screen.getByText("MA")).toBeInTheDocument();
    expect(screen.getByText("AP")).toBeInTheDocument();
    // Sin directorio de miembros, el mensaje de otro colaborador no se atribuye
    // a la cuenta de la sesión.
    expect(screen.getByText("Equipo")).toBeInTheDocument();
  });

  it("usa el identificador del canal cuando el contacto no tiene nombre", async () => {
    const anonymous = { ...conversation, contactDisplayName: null };
    vi.mocked(listConversations).mockResolvedValue({
      conversations: [anonymous],
      nextCursor: null,
    });
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation: anonymous,
      messages: [message()],
    });
    const user = userEvent.setup();
    renderInbox();
    await user.click(await screen.findByRole("button", { name: /wa-contact-1/i }));

    // Un identificador sin espacios debe rendir dos caracteres, no uno.
    expect(await screen.findByText("WA")).toBeInTheDocument();
  });

  it("agrupa los mensajes consecutivos del mismo autor", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: ["uno", "dos", "tres"].map((text, index) =>
        message({
          id: `out-${index}`,
          direction: "outgoing",
          senderType: "staff",
          senderId: panelContext.user.id,
          text,
          status: "sent",
        }),
      ),
    });
    await openThread();

    await screen.findByText("tres");
    expect(document.querySelectorAll('[data-slot="avatar"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-slot="message-footer"]')).toHaveLength(1);
  });

  it("conserva la etiqueta de un fallo dentro de un bloque agrupado", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [
        message({
          id: "out-failed",
          direction: "outgoing",
          senderType: "staff",
          senderId: panelContext.user.id,
          text: "No llegó",
          status: "failed",
        }),
        message({
          id: "out-ok",
          direction: "outgoing",
          senderType: "staff",
          senderId: panelContext.user.id,
          text: "Este sí llegó",
          status: "delivered",
        }),
      ],
    });
    await openThread();

    // El pie del bloque muestra el último estado, así que el fallo intermedio
    // necesita su propia etiqueta para no desaparecer.
    expect(await screen.findByText(/No enviado/)).toBeInTheDocument();
    expect(screen.getByText("Entregado")).toBeInTheDocument();
  });

  it("identifica un adjunto conservado por su nombre y ofrece abrirlo", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [message({
        id: "message-media",
        messageType: "image",
        text: null,
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
      })],
    });
    await openThread();

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
      messages: [message({
        id: "message-rejected",
        messageType: "image",
        text: null,
        attachments: [{
          id: "message-rejected:0",
          type: "image",
          contentType: null,
          byteSize: null,
          filename: "vencido.jpg",
          status: "rejected",
          failureReason: "ATTACHMENT_UNAVAILABLE_400",
        }],
      })],
    });
    await openThread();

    expect(await screen.findByText("Imagen no disponible")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: /^Abrir/ })).not.toBeInTheDocument();
  });

  it("anuncia un medio que no dejó adjunto en vez de una fila vacía", async () => {
    // Ocurre con los medios recibidos antes de que el canal los conservara: el
    // mensaje llega sin texto y sin adjuntos, y `messageType` es lo único que
    // dice qué era.
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [message({ id: "message-sin-medio", messageType: "audio", text: null })],
    });
    await openThread();

    expect(await screen.findByText("Audio")).toBeInTheDocument();
    expect(screen.getByText("No se conservó desde el canal")).toBeInTheDocument();
  });

  it("muestra un fallo saliente con una etiqueta comprensible", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [message({
        id: "message-failed",
        direction: "outgoing",
        senderType: "staff",
        senderId: panelContext.user.id,
        text: "No llegó",
        status: "failed",
      })],
    });
    await openThread();
    expect(await screen.findByText(/No enviado/)).toBeInTheDocument();
  });
});
