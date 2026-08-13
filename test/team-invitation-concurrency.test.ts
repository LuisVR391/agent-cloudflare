import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón Simultáneo",
  organizationSlug: "salon-simultaneo",
  ownerName: "Olga Owner",
  ownerEmail: "owner-concurrent-invite@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

const invitedEmail = "simultanea@example.com";
const invitedPassword = "another-correct-horse-battery";

describe("concurrencia al aceptar una invitación", () => {
  let acceptUrl: string;

  beforeAll(async () => {
    await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: setupBody.ownerEmail,
        password: setupBody.ownerPassword,
      }),
    });
    const sessionCookie = (login.headers.get("set-cookie") ?? "").split(";", 1)[0];

    const created = await fetchWorker("/api/team/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ email: invitedEmail, role: "operator" }),
    });
    ({ acceptUrl } = (await created.json()) as { acceptUrl: string });
  });

  it("crea una sola membresía con dos aceptaciones simultáneas", async () => {
    const token = acceptUrl.slice(acceptUrl.indexOf("#") + 1);
    const responses = await Promise.all(
      [crypto.randomUUID(), crypto.randomUUID()].map((address) =>
        fetchWorker("/api/invitations/accept", {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            "CF-Connecting-IP": address,
          },
          body: JSON.stringify({
            token,
            email: invitedEmail,
            name: "Simultánea",
            password: invitedPassword,
          }),
        }),
      ),
    );

    expect(responses.map(({ status }) => status).sort()).toEqual([201, 404]);

    const users = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM users WHERE email = ?",
    )
      .bind(invitedEmail)
      .first<{ total: number }>();
    const memberships = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE u.email = ?`,
    )
      .bind(invitedEmail)
      .first<{ total: number }>();

    expect(users?.total).toBe(1);
    expect(memberships?.total).toBe(1);
  });
});
