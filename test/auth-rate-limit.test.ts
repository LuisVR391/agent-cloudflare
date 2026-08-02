import { exports } from "cloudflare:workers";
import { describe, expect, it, vi } from "vitest";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

describe("límite de intentos de autenticación", () => {
  it("limita intentos repetidos sin registrar las credenciales", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const statuses: number[] = [];

    for (let attempt = 0; attempt < 9; attempt += 1) {
      const response = await fetchWorker("/api/auth/sign-in/email", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "CF-Connecting-IP": "192.0.2.10",
        },
        body: JSON.stringify({
          email: "unknown@example.com",
          password: "incorrect-password",
        }),
      });
      statuses.push(response.status);
    }

    expect(statuses.slice(0, 8).every((status) => status !== 429)).toBe(true);
    expect(statuses[8]).toBe(429);
    const securityWarnings = warning.mock.calls
      .map(([entry]) => String(entry))
      .filter((entry) => entry.includes('"event":"security.authorization"'));
    expect(securityWarnings).toHaveLength(9);
    const serializedWarnings = securityWarnings.join(" ");
    expect(serializedWarnings).not.toContain("unknown@example.com");
    expect(serializedWarnings).not.toContain("incorrect-password");
    warning.mockRestore();
  });
});
