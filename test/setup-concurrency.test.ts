import { env, exports } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón Concurrente",
  organizationSlug: "salon-concurrente",
  ownerName: "Propietaria Inicial",
  ownerEmail: "owner-concurrent@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

describe("concurrencia de configuración inicial", () => {
  it("solo permite que un intento adquiera el bloqueo", async () => {
    const responses = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map((correlationId) =>
        exports.default.fetch(
          new Request("https://example.com/api/setup", {
            method: "POST",
            headers: {
              "Content-Type": "application/json",
              "X-Correlation-Id": correlationId,
            },
            body: JSON.stringify(setupBody),
          }),
        ),
      ),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 409]);

    const organizationCount = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM organizations",
    ).first<{ total: number }>();
    const membershipCount = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM memberships",
    ).first<{ total: number }>();

    expect(organizationCount?.total).toBe(1);
    expect(membershipCount?.total).toBe(1);
  });
});
