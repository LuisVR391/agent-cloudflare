import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

const user = {
  id: "user-1",
  name: "Ana Propietaria",
  email: "ana@example.com",
};
const organizations = [
  {
    organizationId: "11111111-1111-4111-8111-111111111111",
    organizationName: "Salón Uno",
    organizationSlug: "salon-uno",
    membershipId: "membership-1",
    role: "owner" as const,
    permissions: ["panel.read"],
  },
  {
    organizationId: "22222222-2222-4222-8222-222222222222",
    organizationName: "Salón Dos",
    organizationSlug: "salon-dos",
    membershipId: "membership-2",
    role: "manager" as const,
    permissions: ["panel.read"],
  },
];

afterEach(() => {
  cleanup();
  vi.unstubAllGlobals();
});

beforeEach(() => {
  window.history.replaceState({}, "", "/app");
});

describe("flujo autenticado del panel", () => {
  it("redirige al login cuando el contexto no tiene sesión", async () => {
    const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
      const url = String(input);
      if (url === "/api/context") {
        return new Response(
          JSON.stringify({ error: { code: "UNAUTHENTICATED" } }),
          { status: 401, headers: { "Content-Type": "application/json" } },
        );
      }
      return Response.json({ required: false });
    });
    vi.stubGlobal("fetch", fetchMock);

    render(<App />);

    expect(
      await screen.findByRole("button", { name: "Iniciar sesión" }),
    ).toBeInTheDocument();
    expect(window.location.pathname).toBe("/login");
  });

  it("selecciona una membresía validada, abre el panel y cierra sesión", async () => {
    let selected = false;
    const fetchMock = vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      if (url === "/api/context" && !selected) {
        return Response.json({
          user,
          organizations,
          activeOrganization: null,
          requiresOrganizationSelection: true,
        });
      }
      if (url === "/api/context/organization") {
        expect(init?.method).toBe("POST");
        expect(JSON.parse(String(init?.body))).toEqual({
          organizationId: organizations[1].organizationId,
        });
        selected = true;
        return Response.json({ activeOrganization: organizations[1] });
      }
      if (url === "/api/context" && selected) {
        return Response.json({
          user,
          organizations,
          activeOrganization: organizations[1],
          requiresOrganizationSelection: false,
        });
      }
      if (url === "/api/auth/sign-out") return Response.json({ success: true });
      if (url === "/api/setup/status") return Response.json({ required: false });
      throw new Error(`Solicitud inesperada: ${url}`);
    });
    vi.stubGlobal("fetch", fetchMock);
    const browserUser = userEvent.setup();

    render(<App />);
    await browserUser.click(
      await screen.findByRole("button", { name: /Salón Dos/ }),
    );

    expect(await screen.findByText("Hola, Ana")).toBeInTheDocument();
    expect(screen.getByText("Salón Dos")).toBeInTheDocument();

    await browserUser.click(screen.getByRole("button", { name: "Cerrar sesión" }));
    await waitFor(() => expect(window.location.pathname).toBe("/login"));
    expect(
      await screen.findByRole("button", { name: "Iniciar sesión" }),
    ).toBeInTheDocument();
  });
});
