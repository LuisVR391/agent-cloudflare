import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { beforeEach, describe, expect, it, vi } from "vitest";
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
  beforeEach(() => {
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
      .toHaveBeenCalledWith("conversation-1", "Hola, con gusto."));
  });
});
