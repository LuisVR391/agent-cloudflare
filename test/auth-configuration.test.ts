import { env } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

import { routeAuthRequest } from "../src/worker/auth/http";
import type { WorkerEnv } from "../src/worker/auth/types";

function withBindings(overrides: Partial<WorkerEnv>): WorkerEnv {
  return new Proxy(env as WorkerEnv, {
    get(target, property, receiver) {
      if (Object.prototype.hasOwnProperty.call(overrides, property)) {
        return Reflect.get(overrides, property, receiver);
      }
      return Reflect.get(target, property, receiver);
    },
  });
}

describe("configuración del origen de autenticación", () => {
  it("falla de forma cerrada cuando falta un origen explícito", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await routeAuthRequest(
      new Request("https://example.com/api/context"),
      withBindings({ BETTER_AUTH_URL: "" }),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "AUTH_NOT_CONFIGURED" },
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"auth_not_configured"'),
    );
    warning.mockRestore();
  });

  it("rechaza solicitudes recibidas por un origen distinto", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await routeAuthRequest(
      new Request("https://otro.example/api/context"),
      env as WorkerEnv,
    );

    expect(response?.status).toBe(403);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "AUTH_ORIGIN_MISMATCH" },
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"auth_origin_mismatch"'),
    );
    warning.mockRestore();
  });

  it("rechaza HTTP fuera del entorno local", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await routeAuthRequest(
      new Request("http://panel.example/api/context"),
      withBindings({ BETTER_AUTH_URL: "http://panel.example" }),
    );

    expect(response?.status).toBe(503);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "AUTH_NOT_CONFIGURED" },
    });
    warning.mockRestore();
  });

  it("permite el origen configurado y conserva el rechazo de sesión", async () => {
    const response = await routeAuthRequest(
      new Request("https://example.com/api/context"),
      env as WorkerEnv,
    );

    expect(response?.status).toBe(401);
    await expect(response?.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
