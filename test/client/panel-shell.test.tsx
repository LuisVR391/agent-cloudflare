import { cleanup, render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

vi.mock("../../src/client/lib/api", () => ({
  getAppContext: vi.fn(),
  getSetupStatus: vi.fn(),
  completeSetup: vi.fn(),
  selectOrganization: vi.fn(),
  signIn: vi.fn(),
  signOut: vi.fn(),
  listConversations: vi.fn(),
  getConversationMessages: vi.fn(),
  sendConversationMessage: vi.fn(),
  updateConversation: vi.fn(),
}));

const api = await import("../../src/client/lib/api");

const context = {
  user: { id: "user-1", name: "Ana Propietaria", email: "ana@example.com" },
  organizations: [],
  activeOrganization: {
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Salón Uno",
    organizationSlug: "salon-uno",
    membershipId: "membership-1",
    role: "owner" as const,
    permissions: ["panel.read", "conversations.read", "conversations.manage"],
  },
  requiresOrganizationSelection: false,
};

// `BreadcrumbPage` también expone `role="link"`, así que la consulta se acota
// al botón de menú del sidebar para no confundirlo con la ruta de navegación.
function navigationState() {
  return ["Resumen", "Conversaciones"].map((label) => {
    const item = screen
      .getAllByRole("link", { name: label })
      .find((element) => element.dataset.slot === "sidebar-menu-button");
    return [label, item?.dataset.active];
  });
}

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  vi.mocked(api.getAppContext).mockResolvedValue(context);
  vi.mocked(api.listConversations).mockResolvedValue({
    conversations: [],
    nextCursor: null,
  });
});

describe("shell del panel", () => {
  it("marca activo únicamente el resumen en la raíz del panel", async () => {
    window.history.replaceState({}, "", "/app");

    render(<App />);

    expect(await screen.findByText("Hola, Ana")).toBeInTheDocument();
    expect(navigationState()).toEqual([
      ["Resumen", "true"],
      ["Conversaciones", "false"],
    ]);
  });

  it("marca activas las conversaciones en su propia ruta", async () => {
    window.history.replaceState({}, "", "/app/conversaciones");

    render(<App />);

    expect(await screen.findByRole("heading", { name: "Conversaciones", level: 2 })).toBeInTheDocument();
    expect(navigationState()).toEqual([
      ["Resumen", "false"],
      ["Conversaciones", "true"],
    ]);
  });

  it("guarda la navegación tras el disparador en ancho móvil", async () => {
    // El sidebar se convierte en un panel lateral bajo el punto de corte, así
    // que la navegación no ocupa espacio hasta que se pide. `useIsMobile`
    // decide por `innerWidth`, no por el resultado de la media query.
    vi.stubGlobal("innerWidth", 500);
    window.history.replaceState({}, "", "/app");
    const browserUser = userEvent.setup();

    render(<App />);
    await screen.findByText("Hola, Ana");
    expect(screen.queryByRole("link", { name: "Conversaciones" })).not.toBeInTheDocument();

    await browserUser.click(screen.getByRole("button", { name: "Toggle Sidebar" }));

    expect(await screen.findByRole("link", { name: "Conversaciones" })).toBeInTheDocument();
  });

  it("anuncia las secciones planeadas sin permitir abrirlas", async () => {
    window.history.replaceState({}, "", "/app");

    render(<App />);
    await screen.findByText("Hola, Ana");

    for (const label of ["Agentes", "Equipo", "Configuración"]) {
      expect(screen.getByRole("button", { name: label })).toBeDisabled();
    }
  });
});
