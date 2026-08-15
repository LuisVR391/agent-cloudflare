import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactNotes, NoteSheet } from "../../src/client/components/contact-notes";
import {
  createContactNote,
  listContactNotes,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listContactNotes: vi.fn(),
  createContactNote: vi.fn(),
}));

const note = {
  id: "note-1",
  contactId: "contact-1",
  conversationId: "conversation-1",
  authorMembershipId: "membership-1",
  authorName: "Paula Peluquera",
  body: "Prefiere cita por la tarde.",
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listContactNotes).mockResolvedValue([note]);
  vi.mocked(createContactNote).mockResolvedValue(note);
});

describe("notas del contacto", () => {
  it("lista las notas con su autor y el momento en que se escribieron", async () => {
    render(<ContactNotes canManage contactId="contact-1" />);

    expect(await screen.findByText("Prefiere cita por la tarde.")).toBeInTheDocument();
    expect(screen.getByText(/Paula Peluquera/)).toBeInTheDocument();
    expect(listContactNotes).toHaveBeenCalledWith("contact-1");
  });

  it("guarda la nota con la conversación de origen y relee la lista", async () => {
    const user = userEvent.setup();
    render(
      <ContactNotes
        canManage
        contactId="contact-1"
        conversationId="conversation-1"
      />,
    );

    await screen.findByText("Prefiere cita por la tarde.");
    await user.type(
      screen.getByLabelText("Nueva nota"),
      "Viene con su hija.",
    );
    await user.click(screen.getByRole("button", { name: "Guardar nota" }));

    await waitFor(() =>
      expect(createContactNote).toHaveBeenCalledWith({
        contactId: "contact-1",
        conversationId: "conversation-1",
        body: "Viene con su hija.",
      }),
    );
    // La lista se relee: el orden y el autor los decide el servidor.
    await waitFor(() => expect(listContactNotes).toHaveBeenCalledTimes(2));
  });

  it("explica el vacío sin culpar a quien mira", async () => {
    vi.mocked(listContactNotes).mockResolvedValue([]);
    render(<ContactNotes canManage contactId="contact-1" />);

    expect(
      await screen.findByText("Todavía no hay notas de este contacto."),
    ).toBeInTheDocument();
  });

  it("muestra el mensaje del servidor cuando la nota no se guarda", async () => {
    const user = userEvent.setup();
    vi.mocked(createContactNote).mockRejectedValue(
      new Error("No tienes permiso para anotar sobre contactos."),
    );
    render(<ContactNotes canManage contactId="contact-1" />);

    await screen.findByText("Prefiere cita por la tarde.");
    await user.type(screen.getByLabelText("Nueva nota"), "Intento.");
    await user.click(screen.getByRole("button", { name: "Guardar nota" }));

    expect(
      await screen.findByText("No tienes permiso para anotar sobre contactos."),
    ).toBeInTheDocument();
  });

  it("sin permiso de gestión consulta las notas pero no ofrece escribirlas", async () => {
    render(<ContactNotes canManage={false} contactId="contact-1" />);

    await screen.findByText("Prefiere cita por la tarde.");
    expect(screen.queryByLabelText("Nueva nota")).toBeNull();
    expect(screen.queryByRole("button", { name: "Guardar nota" })).toBeNull();
  });

  it("desde la conversación no pide las notas hasta abrir el panel", async () => {
    const user = userEvent.setup();
    render(
      <NoteSheet
        canManage
        contactId="contact-1"
        conversationId="conversation-1"
      />,
    );

    expect(listContactNotes).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Notas" }));

    expect(await screen.findByText("Notas del contacto")).toBeInTheDocument();
    await waitFor(() =>
      expect(listContactNotes).toHaveBeenCalledWith("contact-1"),
    );
  });
});
