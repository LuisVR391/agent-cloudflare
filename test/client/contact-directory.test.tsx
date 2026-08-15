import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ContactDirectory } from "../../src/client/components/contact-directory";
import {
  addContactTag,
  getContact,
  listContactNotes,
  listContacts,
  removeContactTag,
  updateContact,
  type ContactProfile,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listContacts: vi.fn(),
  getContact: vi.fn(),
  updateContact: vi.fn(),
  addContactTag: vi.fn(),
  removeContactTag: vi.fn(),
  // La ficha del directorio monta las notas del contacto debajo del perfil.
  listContactNotes: vi.fn(),
  createContactNote: vi.fn(),
}));

function contact(overrides: Partial<ContactProfile> = {}): ContactProfile {
  return {
    id: "contact-1",
    displayName: "María Gómez",
    phoneNumber: "+52 55 1234 5678",
    email: null,
    status: "active",
    version: 1,
    createdAt: "2026-08-10T18:00:00.000Z",
    identities: [{ id: "identity-1", provider: "whatsapp", externalId: "wa-contact-1" }],
    tags: [],
    ...overrides,
  };
}

function panelContext(permissions: string[]) {
  return {
    user: { id: "user-1", name: "Ana Propietaria", email: "ana@example.com" },
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

function renderDirectory(permissions = ["contacts.read", "contacts.manage"]) {
  return render(
    <MemoryRouter initialEntries={["/app/contactos"]}>
      <Routes>
        <Route element={<Outlet context={panelContext(permissions)} />} path="/app">
          <Route element={<ContactDirectory />} path="contactos" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("directorio de contactos", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listContacts).mockResolvedValue({
      contacts: [contact()],
      nextCursor: null,
    });
    vi.mocked(getContact).mockResolvedValue(contact());
    vi.mocked(listContactNotes).mockResolvedValue([]);
  });

  it("abre la ficha y guarda solo los campos que cambiaron", async () => {
    const user = userEvent.setup();
    vi.mocked(updateContact).mockResolvedValue(
      contact({ email: "maria@example.com", version: 2 }),
    );
    renderDirectory();

    await user.click(await screen.findByRole("button", { name: /María Gómez/ }));
    const email = await screen.findByLabelText("Correo");
    await user.type(email, "maria@example.com");
    await user.click(screen.getByRole("button", { name: /Guardar ficha/ }));

    await waitFor(() =>
      expect(updateContact).toHaveBeenCalledWith("contact-1", {
        expectedVersion: 1,
        email: "maria@example.com",
      }),
    );
  });

  it("busca por texto sin lanzar una consulta por pulsación", async () => {
    const user = userEvent.setup();
    renderDirectory();
    await screen.findByRole("button", { name: /María Gómez/ });
    vi.mocked(listContacts).mockClear();

    await user.type(screen.getByLabelText("Buscar contactos"), "ana");

    await waitFor(() => expect(listContacts).toHaveBeenCalledWith("ana"));
    expect(vi.mocked(listContacts).mock.calls).toHaveLength(1);
  });

  it("añade y quita etiquetas", async () => {
    const user = userEvent.setup();
    const tagged = contact({
      tags: [{ id: "tag-1", name: "VIP", color: "neutral" }],
      version: 1,
    });
    vi.mocked(addContactTag).mockResolvedValue(tagged);
    vi.mocked(removeContactTag).mockResolvedValue(contact());
    renderDirectory();

    await user.click(await screen.findByRole("button", { name: /María Gómez/ }));
    await user.type(await screen.findByLabelText("Nueva etiqueta"), "VIP");
    await user.click(screen.getByRole("button", { name: /Añadir/ }));

    await waitFor(() => expect(addContactTag).toHaveBeenCalledWith("contact-1", "VIP"));
    await user.click(await screen.findByRole("button", { name: /Quitar etiqueta VIP/ }));
    await waitFor(() =>
      expect(removeContactTag).toHaveBeenCalledWith("contact-1", "tag-1"),
    );
  });

  it("oculta la edición a quien solo puede consultar", async () => {
    const user = userEvent.setup();
    renderDirectory(["contacts.read"]);

    await user.click(await screen.findByRole("button", { name: /María Gómez/ }));

    expect(await screen.findByLabelText("Nombre")).toBeDisabled();
    expect(screen.queryByRole("button", { name: /Guardar ficha/ })).toBeNull();
    expect(screen.queryByLabelText("Nueva etiqueta")).toBeNull();
  });
});
