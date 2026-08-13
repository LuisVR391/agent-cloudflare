import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { App } from "../../src/client/App";

/**
 * Igual que `app-auth-flow`, esta prueba stubbea `fetch` por URL en vez de
 * mockear el módulo de API: lo que se comprueba es qué viaja por la red, y en
 * particular que el token no aparezca en ninguna URL.
 */
const requests: Array<{ url: string; body: unknown }> = [];

function stubFetch(overrides: Record<string, { status: number; body: unknown }>) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (input: RequestInfo | URL, init?: RequestInit) => {
      const url = String(input);
      requests.push({
        url,
        body: init?.body ? JSON.parse(String(init.body)) : undefined,
      });
      const match = Object.entries(overrides).find(([path]) => url.includes(path));
      const result = match?.[1] ?? { status: 404, body: {} };
      return new Response(JSON.stringify(result.body), { status: result.status });
    }),
  );
}

describe("aceptación de una invitación", () => {
  afterEach(() => {
    cleanup();
    vi.unstubAllGlobals();
  });

  beforeEach(() => {
    requests.length = 0;
    window.history.replaceState({}, "", "/invitacion#token-secreto");
  });

  it("crea la cuenta sin exponer el token en la URL", async () => {
    const user = userEvent.setup();
    stubFetch({
      "/api/invitations/preview": {
        status: 200,
        body: {
          invitation: {
            organizationName: "Salón Uno",
            role: "operator",
            expiresAt: "2999-01-01T10:00:00.000Z",
          },
        },
      },
      "/api/invitations/accept": {
        status: 201,
        body: { organization: { name: "Salón Uno" } },
      },
    });

    render(<App />);

    expect(await screen.findByText("Únete a Salón Uno")).toBeInTheDocument();
    // El fragmento se borra al montar: no queda en el historial ni se comparte
    // al copiar la dirección.
    expect(window.location.hash).toBe("");
    expect(requests[0]).toMatchObject({
      body: { token: "token-secreto" },
    });
    expect(requests[0]?.url).not.toContain("token-secreto");

    await user.type(screen.getByLabelText("Correo"), "nueva@example.com");
    await user.type(screen.getByLabelText("Nombre"), "Nora Nueva");
    await user.type(screen.getByLabelText("Contraseña"), "una-contrasena-larga");
    await user.click(screen.getByRole("button", { name: "Crear mi cuenta" }));

    await waitFor(() =>
      expect(window.location.pathname).toBe("/login"),
    );
    const acceptance = requests.find(({ url }) =>
      url.includes("/api/invitations/accept"),
    );
    expect(acceptance?.body).toEqual({
      token: "token-secreto",
      email: "nueva@example.com",
      name: "Nora Nueva",
      password: "una-contrasena-larga",
    });
  });

  it("no pide datos cuando el enlace ya no sirve", async () => {
    stubFetch({
      "/api/invitations/preview": {
        status: 404,
        body: {
          error: {
            code: "INVITATION_NOT_AVAILABLE",
            message: "La invitación no está disponible.",
          },
        },
      },
    });

    render(<App />);

    expect(
      await screen.findByText("La invitación no está disponible."),
    ).toBeInTheDocument();
    expect(screen.queryByLabelText("Contraseña")).not.toBeInTheDocument();
  });
});
