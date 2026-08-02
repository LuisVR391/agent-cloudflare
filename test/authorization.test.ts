import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { createActiveOrganizationCookie } from "../src/worker/auth/active-organization";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón Autorizado",
  organizationSlug: "salon-autorizado",
  ownerName: "Olivia Owner",
  ownerEmail: "owner-authorization@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

describe.sequential("autorización multiempresa", () => {
  let sessionCookie: string;
  let organizationId: string;
  let userId: string;

  beforeAll(async () => {
    const setup = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    const setupResult = (await setup.json()) as {
      organization: { id: string };
    };
    organizationId = setupResult.organization.id;

    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: setupBody.ownerEmail,
        password: setupBody.ownerPassword,
      }),
    });
    sessionCookie = cookiePair(login.headers.get("set-cookie"));
    const user = await env.DB.prepare("SELECT id FROM users WHERE email = ?")
      .bind(setupBody.ownerEmail)
      .first<{ id: string }>();
    if (!user) throw new Error("No se creó el usuario de prueba.");
    userId = user.id;
  });

  it("distingue una sesión ausente de otros rechazos", async () => {
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);
    const response = await fetchWorker("/agents/CustomerSupportAgent/demo");

    expect(response.status).toBe(401);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "UNAUTHENTICATED" },
    });
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"action":"conversation.agent.access"'),
    );
    warning.mockRestore();
  });

  it("falla cerrado para usuario, membresía u organización suspendidos", async () => {
    await env.DB.prepare("UPDATE users SET status = 'suspended' WHERE id = ?")
      .bind(userId)
      .run();
    const suspendedUser = await fetchWorker("/api/context", {
      headers: { cookie: sessionCookie },
    });
    expect(suspendedUser.status).toBe(401);
    await env.DB.prepare("UPDATE users SET status = 'active' WHERE id = ?")
      .bind(userId)
      .run();

    await env.DB.prepare(
      "UPDATE memberships SET status = 'suspended' WHERE organization_id = ? AND user_id = ?",
    )
      .bind(organizationId, userId)
      .run();
    const suspendedMembership = await fetchWorker("/api/context", {
      headers: { cookie: sessionCookie },
    });
    expect(suspendedMembership.status).toBe(403);
    await env.DB.prepare(
      "UPDATE memberships SET status = 'active' WHERE organization_id = ? AND user_id = ?",
    )
      .bind(organizationId, userId)
      .run();

    await env.DB.prepare("UPDATE organizations SET status = 'suspended' WHERE id = ?")
      .bind(organizationId)
      .run();
    const suspendedOrganization = await fetchWorker("/api/context", {
      headers: { cookie: sessionCookie },
    });
    expect(suspendedOrganization.status).toBe(403);
    await env.DB.prepare("UPDATE organizations SET status = 'active' WHERE id = ?")
      .bind(organizationId)
      .run();
  });

  it("rechaza una cookie firmada para una organización ajena", async () => {
    const foreignOrganizationId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
       VALUES (?, 'salon-ajeno', 'Salón Ajeno', 'active', ?, ?)`,
    )
      .bind(foreignOrganizationId, now, now)
      .run();
    const activeCookie = cookiePair(
      await createActiveOrganizationCookie(
        foreignOrganizationId,
        "test-only-better-auth-secret-at-least-thirty-two-characters",
        "https://example.com",
      ),
    );

    const response = await fetchWorker("/agents/CustomerSupportAgent/demo", {
      headers: { cookie: `${sessionCookie}; ${activeCookie}` },
    });
    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORGANIZATION_SELECTION_REQUIRED" },
    });
  });

  it("rechaza una cookie organizacional alterada", async () => {
    const response = await fetchWorker("/agents/CustomerSupportAgent/demo", {
      headers: {
        cookie: `${sessionCookie}; agent_cloudflare_active_organization=${organizationId}.invalid`,
      },
    });

    expect(response.status).toBe(409);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "ORGANIZATION_SELECTION_REQUIRED" },
    });
  });

  it("permite llegar al router del agente con el permiso efectivo", async () => {
    const response = await fetchWorker("/agents/customer-support-agent/demo", {
      headers: { cookie: sessionCookie },
    });

    expect([401, 403, 409]).not.toContain(response.status);
  });

  it("exige y valida la selección cuando existen varias membresías", async () => {
    const secondOrganizationId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const roleId = crypto.randomUUID();
    const now = new Date().toISOString();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
         VALUES (?, 'salon-secundario', 'Salón Secundario', 'active', ?, ?)`,
      ).bind(secondOrganizationId, now, now),
      env.DB.prepare(
        `INSERT INTO memberships
           (id, organization_id, user_id, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      ).bind(membershipId, secondOrganizationId, userId, now, now),
      env.DB.prepare(
        `INSERT INTO roles
           (id, organization_id, role_key, display_name, created_at, updated_at)
         VALUES (?, ?, 'owner', 'Propietario', ?, ?)`,
      ).bind(roleId, secondOrganizationId, now, now),
      env.DB.prepare(
        `INSERT INTO membership_roles
           (organization_id, membership_id, role_id, assigned_at)
         VALUES (?, ?, ?, ?)`,
      ).bind(secondOrganizationId, membershipId, roleId, now),
    ]);

    const context = await fetchWorker("/api/context", {
      headers: { cookie: sessionCookie },
    });
    expect(context.status).toBe(200);
    await expect(context.json()).resolves.toMatchObject({
      activeOrganization: null,
      requiresOrganizationSelection: true,
    });

    const selection = await fetchWorker("/api/context/organization", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({ organizationId: secondOrganizationId }),
    });
    expect(selection.status).toBe(200);
    const activeCookie = cookiePair(selection.headers.get("set-cookie"));

    const selectedContext = await fetchWorker("/api/context", {
      headers: { cookie: `${sessionCookie}; ${activeCookie}` },
    });
    await expect(selectedContext.json()).resolves.toMatchObject({
      activeOrganization: { organizationId: secondOrganizationId },
      requiresOrganizationSelection: false,
    });
  });

  it("impide seleccionar una organización sin membresía y no emite cookie", async () => {
    const foreign = await env.DB.prepare(
      "SELECT id FROM organizations WHERE slug = 'salon-ajeno'",
    ).first<{ id: string }>();
    if (!foreign) throw new Error("No existe la organización ajena de prueba.");
    const warning = vi.spyOn(console, "warn").mockImplementation(() => undefined);

    const response = await fetchWorker("/api/context/organization", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({ organizationId: foreign.id }),
    });

    expect(response.status).toBe(403);
    expect(response.headers.get("set-cookie")).toBeNull();
    expect(warning).toHaveBeenCalledWith(
      expect.stringContaining('"reason":"organization_access_denied"'),
    );
    warning.mockRestore();
  });

  it("audita en D1 un permiso denegado dentro de la organización activa", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
       WHERE organization_id = ?
         AND permission_id = (
           SELECT id FROM permissions WHERE permission_key = 'conversations.manage'
         )`,
    )
      .bind(organizationId)
      .run();
    const selection = await fetchWorker("/api/context/organization", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
      },
      body: JSON.stringify({ organizationId }),
    });
    const activeCookie = cookiePair(selection.headers.get("set-cookie"));
    const correlationId = crypto.randomUUID();

    const response = await fetchWorker("/agents/CustomerSupportAgent/demo", {
      headers: {
        cookie: `${sessionCookie}; ${activeCookie}`,
        "X-Correlation-Id": correlationId,
      },
    });

    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN", correlationId },
    });
    const audit = await env.DB.prepare(
      `SELECT action, result, actor_id, organization_id
       FROM audit_logs
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
      action: "conversation.agent.access",
      result: "rejected",
      actor_id: userId,
      organization_id: organizationId,
    });
  });
});
