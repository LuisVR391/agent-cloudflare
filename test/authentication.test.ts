import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón Aurora",
  organizationSlug: "salon-aurora",
  ownerName: "Ana Propietaria",
  ownerEmail: "ana@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

describe("instalación y autenticación", () => {
  it("rechaza un token de instalación inválido sin crear datos", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ ...setupBody, setupToken: "incorrecto" }),
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_SETUP_TOKEN" },
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"invalid_setup_token"'),
    );
    warning.mockRestore();
  });

  it("crea una sola instalación, cierra el registro y permite iniciar sesión", async () => {
    const initialStatus = await fetchWorker("/api/setup/status");
    await expect(initialStatus.json()).resolves.toEqual({ required: true });

    const setup = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    expect(setup.status).toBe(201);

    const repeatedSetup = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    expect(repeatedSetup.status).toBe(409);

    const publicSignup = await fetchWorker("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Cuenta pública",
        email: "publica@example.com",
        password: "another-secure-password",
      }),
    });
    expect(publicSignup.status).toBe(400);

    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: setupBody.ownerEmail,
        password: setupBody.ownerPassword,
      }),
    });
    expect(login.status).toBe(200);
    const cookie = login.headers.get("set-cookie");
    expect(cookie).toContain("better-auth.session_token");

    const context = await fetchWorker("/api/context", {
      headers: { cookie: cookie ?? "" },
    });
    expect(context.status).toBe(200);
    await expect(context.json()).resolves.toMatchObject({
      user: { email: setupBody.ownerEmail },
      activeOrganization: {
        organizationName: setupBody.organizationName,
        role: "owner",
      },
      requiresOrganizationSelection: false,
    });

    const finalStatus = await fetchWorker("/api/setup/status");
    await expect(finalStatus.json()).resolves.toEqual({ required: false });
  });
});
