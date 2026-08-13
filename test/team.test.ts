import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { TeamMember } from "../src/worker/domain/types";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón con Equipo",
  organizationSlug: "salon-con-equipo",
  ownerName: "Olga Owner",
  ownerEmail: "owner-team-api@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "88888888-8888-4888-8888-888888888888";

describe.sequential("superficie de equipo", () => {
  let sessionCookie: string;
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    const setup = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    const result = (await setup.json()) as { organization: { id: string } };
    organizationId = result.organization.id;

    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: setupBody.ownerEmail,
        password: setupBody.ownerPassword,
      }),
    });
    sessionCookie = cookiePair(login.headers.get("set-cookie"));
    const owner = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(setupBody.ownerEmail)
      .first<{ id: string }>();
    userId = owner!.id;

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
       VALUES (?, 'otro-salon-equipo', 'Otro salón', 'active', ?, ?)`,
    )
      .bind(otherOrganizationId, now, now)
      .run();
  });

  it("lista al equipo con su rol vigente", async () => {
    const response = await fetchWorker("/api/team/members", {
      headers: { Cookie: sessionCookie },
    });
    const body = (await response.json()) as { members: TeamMember[] };

    expect(response.status).toBe(200);
    expect(body.members).toHaveLength(1);
    expect(body.members[0]).toMatchObject({
      email: setupBody.ownerEmail,
      role: "owner",
      status: "active",
    });
    expect(body.members[0].membershipId).toEqual(expect.any(String));
  });

  it("no revoca una invitación de otra organización", async () => {
    const now = new Date().toISOString();
    const foreignId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO organization_invitations
        (id, organization_id, email, role_key, token_hash, status, expires_at,
         invited_by, created_at, updated_at)
       VALUES (?, ?, 'ajena@example.com', 'operator', ?, 'pending', ?, ?, ?, ?)`,
    )
      .bind(
        foreignId,
        otherOrganizationId,
        crypto.randomUUID(),
        new Date(Date.now() + 3_600_000).toISOString(),
        userId,
        now,
        now,
      )
      .run();

    const response = await fetchWorker(
      `/api/team/invitations/${foreignId}/revoke`,
      { method: "POST", headers: { Cookie: sessionCookie } },
    );
    // Nunca `403`: la respuesta no revela que la invitación existe.
    expect(response.status).toBe(404);

    const listed = await fetchWorker("/api/team/invitations", {
      headers: { Cookie: sessionCookie },
    });
    const body = (await listed.json()) as { invitations: { id: string }[] };
    expect(body.invitations.map(({ id }) => id)).not.toContain(foreignId);

    const untouched = await env.DB.prepare(
      "SELECT status FROM organization_invitations WHERE id = ?",
    )
      .bind(foreignId)
      .first<{ status: string }>();
    expect(untouched?.status).toBe("pending");
  });

  it("audita el intento de invitar sin permiso de administración", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id = (
            SELECT id FROM permissions WHERE permission_key = 'users.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();

    const response = await fetchWorker("/api/team/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ email: "sin-permiso@example.com", role: "operator" }),
    });

    expect(response.status).toBe(403);
    const audit = await env.DB.prepare(
      `SELECT action, result, actor_id, organization_id FROM audit_logs
        WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{
        action: string;
        result: string;
        actor_id: string;
        organization_id: string;
      }>();
    expect(audit).toEqual({
      action: "invitation.create",
      result: "rejected",
      actor_id: userId,
      organization_id: organizationId,
    });

    const created = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM organization_invitations WHERE email = ?",
    )
      .bind("sin-permiso@example.com")
      .first<{ total: number }>();
    expect(created?.total).toBe(0);
  });

  it("cierra la lectura del equipo sin el permiso correspondiente", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id = (
            SELECT id FROM permissions WHERE permission_key = 'users.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker("/api/team/members", {
      headers: { Cookie: sessionCookie },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });

  it("exige sesión para cualquier ruta de equipo", async () => {
    const response = await fetchWorker("/api/team/members");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
  });
});
