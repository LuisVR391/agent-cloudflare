import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationInbox } from "../../src/client/components/conversation-inbox";
import {
  getContact,
  getConversationMessages,
  listConversations,
  listTeamMembers,
  sendConversationMessage,
  simulateInboundMessage,
  updateConversation,
  type ConversationMessage,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  sendConversationMessage: vi.fn(),
  updateConversation: vi.fn(),
  listTeamMembers: vi.fn(),
  getContact: vi.fn(),
  updateContact: vi.fn(),
  addContactTag: vi.fn(),
  removeContactTag: vi.fn(),
  simulateInboundMessage: vi.fn(),
}));

const conversation = {
  id: "conversation-1",
  contactId: "contact-1",
  contactDisplayName: "María",
  contactExternalId: "wa-contact-1",
  channelDisplayName: "WhatsApp principal",
  status: "open" as const,
  attentionMode: "human" as const,
  assignee: null,
  version: 1,
  lastMessageAt: "2026-08-10T18:00:00.000Z",
  lastMessageText: "Quiero información",
};

const sessionUserId = "user-1";

const teammate = {
  membershipId: "membership-2",
  userId: "user-2",
  name: "Rosa Responsable",
  email: "rosa@example.com",
  role: "operator" as const,
  status: "active" as const,
  joinedAt: "2026-08-12T10:00:00.000Z",
};

const defaultPermissions = ["conversations.read", "conversations.manage"];

function panelContext(permissions = defaultPermissions) {
  return {
    user: { id: sessionUserId, name: "Ana Propietaria", email: "ana@example.com" },
    organizations: [],
    activeOrganization: {
      organizationId: "11111111-1111-4111-8111-111111111111",
      organizationName: "Salón Uno",
      organizationSlug: "salon-uno",
      organizationTimeZone: "America/Mexico_City",
      membershipId: "membership-1",
      role: "owner" as const,
      permissions,
    },
    requiresOrganizationSelection: false,
  };
}

// El inbox toma la identidad de la sesión del contexto del shell, así que la
// prueba lo monta dentro de una ruta que lo provee.
function renderInbox(permissions?: string[]) {
  return render(
    <MemoryRouter initialEntries={["/app/conversaciones"]}>
      <Routes>
        <Route element={<Outlet context={panelContext(permissions)} />} path="/app">
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
      nextCursor: null,
    });
    vi.mocked(sendConversationMessage).mockResolvedValue(undefined);
    vi.mocked(listTeamMembers).mockResolvedValue([]);
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
          senderId: sessionUserId,
          text: "Claro que sí",
          status: "sent",
        }),
      ],
      nextCursor: null,
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
          senderId: sessionUserId,
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
      nextCursor: null,
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
      nextCursor: null,
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
          senderId: sessionUserId,
          text,
          status: "sent",
        }),
      ),
      nextCursor: null,
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
          senderId: sessionUserId,
          text: "No llegó",
          status: "failed",
        }),
        message({
          id: "out-ok",
          direction: "outgoing",
          senderType: "staff",
          senderId: sessionUserId,
          text: "Este sí llegó",
          status: "delivered",
        }),
      ],
      nextCursor: null,
    });
    await openThread();

    // El pie del bloque muestra el último estado, así que el fallo intermedio
    // necesita su propia etiqueta para no desaparecer.
    expect(await screen.findByText(/No enviado/)).toBeInTheDocument();
    expect(screen.getByText("Entregado")).toBeInTheDocument();
  });

  it("carga el historial más antiguo cuando el borde del hilo queda a la vista", async () => {
    vi.mocked(getConversationMessages).mockImplementation(async (_id, cursor) =>
      cursor === undefined
        ? {
            conversation,
            messages: [message({ id: "reciente", text: "Reciente" })],
            nextCursor: "2026-08-10T18:00:00.000Z|reciente",
          }
        : {
            conversation,
            messages: [message({
              id: "antiguo",
              text: "Antiguo",
              occurredAt: "2026-08-09T18:00:00.000Z",
            })],
            nextCursor: null,
          },
    );
    await openThread();

    expect(await screen.findByText("Antiguo")).toBeInTheDocument();
    // El historial se suma al hilo, no lo sustituye.
    expect(screen.getByText("Reciente")).toBeInTheDocument();
    expect(vi.mocked(getConversationMessages)).toHaveBeenCalledWith(
      "conversation-1",
      "2026-08-10T18:00:00.000Z|reciente",
    );
  });

  it("no pide historial cuando el cursor ya está agotado", async () => {
    await openThread();
    // El texto aparece en la fila de la lista y en la burbuja del hilo.
    await screen.findAllByText("Quiero información");

    // La primera página llegó con `nextCursor: null`: no hay nada que pedir, y
    // ninguna llamada debe llevar cursor.
    for (const call of vi.mocked(getConversationMessages).mock.calls) {
      expect(call[1]).toBeUndefined();
    }
  });

  it("pide más conversaciones cuando el final de la lista queda a la vista", async () => {
    vi.mocked(listConversations).mockImplementation(async (_status, cursor) =>
      cursor === undefined
        ? { conversations: [conversation], nextCursor: "2026-08-10T18:00:00.000Z|conversation-1" }
        : {
            conversations: [{
              ...conversation,
              id: "conversation-2",
              contactDisplayName: "Ana",
              lastMessageAt: "2026-08-09T18:00:00.000Z",
            }],
            nextCursor: null,
          },
    );
    renderInbox();

    expect(await screen.findByText("Ana")).toBeInTheDocument();
    expect(screen.getByText("María")).toBeInTheDocument();
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
      nextCursor: null,
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
      nextCursor: null,
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
      nextCursor: null,
    });
    await openThread();

    expect(await screen.findByText("Audio")).toBeInTheDocument();
    expect(screen.getByText("No se conservó desde el canal")).toBeInTheDocument();
  });

  it("simula un contacto desde la lista y una respuesta dentro del hilo", async () => {
    vi.mocked(simulateInboundMessage).mockResolvedValue({
      conversationId: "local-1",
      phoneNumber: "+525512345678",
      text: "Hola, soy Lucía, quiero información de precios",
    });
    const user = await openThread();

    // Sin hilo: siembra un contacto nuevo.
    await user.click(screen.getByRole("button", { name: /Simular contacto/ }));
    await waitFor(() =>
      expect(simulateInboundMessage).toHaveBeenCalledWith(undefined),
    );

    // Dentro del hilo: continúa esa conversación.
    await user.click(screen.getByRole("button", { name: /Simular respuesta/ }));
    await waitFor(() =>
      expect(simulateInboundMessage).toHaveBeenCalledWith("conversation-1"),
    );
  });

  it("abre la ficha del contacto desde el hilo solo con permiso de lectura", async () => {
    const user = userEvent.setup();
    vi.mocked(getContact).mockResolvedValue({
      id: "contact-1",
      displayName: "María",
      phoneNumber: "+52 55 1234 5678",
      email: null,
      status: "active",
      version: 1,
      createdAt: conversation.lastMessageAt,
      identities: [{ id: "identity-1", provider: "whatsapp", externalId: "wa-contact-1" }],
      tags: [],
    });

    renderInbox(["conversations.read", "conversations.manage", "contacts.read"]);
    await user.click(await screen.findByRole("button", { name: /María/i }));
    await user.click(screen.getByRole("button", { name: "Ficha" }));

    expect(await screen.findByText("Ficha del contacto")).toBeInTheDocument();
    await waitFor(() => expect(getContact).toHaveBeenCalledWith("contact-1"));
    // Sin `contacts.manage` la ficha se consulta, no se edita.
    expect(screen.queryByRole("button", { name: /Guardar ficha/ })).toBeNull();
  });

  it("no anuncia la ficha a quien no puede consultar contactos", async () => {
    await openThread();
    expect(screen.queryByRole("button", { name: "Ficha" })).toBeNull();
  });

  it("muestra un fallo saliente con una etiqueta comprensible", async () => {
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [message({
        id: "message-failed",
        direction: "outgoing",
        senderType: "staff",
        senderId: sessionUserId,
        text: "No llegó",
        status: "failed",
      })],
      nextCursor: null,
    });
    await openThread();
    expect(await screen.findByText(/No enviado/)).toBeInTheDocument();
  });

  it("filtra la lista por responsable", async () => {
    vi.mocked(listTeamMembers).mockResolvedValue([teammate]);
    const user = userEvent.setup();
    renderInbox([...defaultPermissions, "users.read"]);

    await user.click(
      await screen.findByRole("button", { name: "Todas las conversaciones" }),
    );
    await user.click(await screen.findByRole("menuitemradio", { name: "Mías" }));

    await waitFor(() =>
      expect(listConversations).toHaveBeenCalledWith("open", undefined, "me"),
    );
  });

  it("asigna la conversación desde la cabecera del hilo", async () => {
    vi.mocked(listTeamMembers).mockResolvedValue([teammate]);
    vi.mocked(updateConversation).mockResolvedValue(undefined);
    const user = userEvent.setup();
    renderInbox([...defaultPermissions, "users.read"]);
    await user.click(await screen.findByRole("button", { name: /María/i }));

    await user.click(await screen.findByRole("button", { name: "Sin responsable" }));
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Rosa Responsable" }),
    );

    await waitFor(() =>
      expect(updateConversation).toHaveBeenCalledWith("conversation-1", {
        expectedVersion: 1,
        assigneeMembershipId: "membership-2",
      }),
    );
  });

  it("no ofrece responsable a quien no puede leer el equipo", async () => {
    await openThread();

    expect(screen.queryByRole("button", { name: "Sin responsable" })).toBeNull();
    expect(listTeamMembers).not.toHaveBeenCalled();
  });

  it("atribuye a su nombre el mensaje que envió otra persona", async () => {
    vi.mocked(listTeamMembers).mockResolvedValue([teammate]);
    vi.mocked(getConversationMessages).mockResolvedValue({
      conversation,
      messages: [message({
        id: "out-teammate",
        direction: "outgoing",
        senderType: "staff",
        senderId: "user-2",
        text: "Yo la atiendo",
        status: "sent",
      })],
      nextCursor: null,
    });
    const user = userEvent.setup();
    renderInbox([...defaultPermissions, "users.read"]);
    await user.click(await screen.findByRole("button", { name: /María/i }));

    expect(await screen.findByText("Rosa Responsable")).toBeInTheDocument();
    expect(screen.queryByText("Equipo")).toBeNull();
  });
});
