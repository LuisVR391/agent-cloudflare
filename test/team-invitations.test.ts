import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón Invitaciones",
  organizationSlug: "salon-invitaciones",
  ownerName: "Olga Owner",
  ownerEmail: "owner-invitations@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

const invitedPassword = "another-correct-horse-battery";

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

function tokenFromLink(acceptUrl: string): string {
  return acceptUrl.slice(acceptUrl.indexOf("#") + 1);
}

type InvitationResponse = {
  invitation: { id: string; email: string; role: string; status: string };
  acceptUrl: string;
};

describe.sequential("invitaciones de colaboradores", () => {
  let sessionCookie: string;
  let organizationId: string;

  async function invite(
    email: string,
    role: "owner" | "manager" | "operator" = "operator",
    expiresInHours?: number,
  ) {
    const response = await fetchWorker("/api/team/invitations", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        Cookie: sessionCookie,
      },
      body: JSON.stringify({ email, role, expiresInHours }),
    });
    return {
      status: response.status,
      body: (await response.json()) as InvitationResponse,
    };
  }

  /**
   * Cada caso llega desde una dirección distinta porque el límite de intentos
   * se cuenta por IP: compartirla haría que un caso agotara el cupo del
   * siguiente y las pruebas medirían el límite en vez del flujo.
   */
  function accept(body: Record<string, unknown>, address = crypto.randomUUID()) {
    return fetchWorker("/api/invitations/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": address,
      },
      body: JSON.stringify(body),
    });
  }

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
  });

  it("entrega el enlace una sola vez y guarda el token hasheado", async () => {
    const created = await invite("nueva@example.com", "manager");

    expect(created.status).toBe(201);
    expect(created.body.invitation.status).toBe("pending");
    expect(created.body.invitation.role).toBe("manager");
    // El token viaja en el fragmento: así no llega al servidor en la
    // navegación ni queda en registros de acceso.
    expect(created.body.acceptUrl).toContain("/invitacion#");

    const token = tokenFromLink(created.body.acceptUrl);
    const stored = await env.DB.prepare(
      `SELECT token_hash, email, status FROM organization_invitations WHERE id = ?`,
    )
      .bind(created.body.invitation.id)
      .first<{ token_hash: string; email: string; status: string }>();

    expect(stored?.token_hash).not.toBe(token);
    expect(stored?.token_hash).toMatch(/^[0-9a-f]{64}$/);

    const listed = await fetchWorker("/api/team/invitations", {
      headers: { Cookie: sessionCookie },
    });
    const body = (await listed.json()) as { invitations: unknown[] };
    expect(JSON.stringify(body)).not.toContain(token);
    expect(JSON.stringify(body)).not.toContain(stored?.token_hash);
  });

  it("previsualiza sin revelar el correo invitado", async () => {
    const created = await invite("previsualiza@example.com");
    const preview = await fetchWorker("/api/invitations/preview", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ token: tokenFromLink(created.body.acceptUrl) }),
    });
    const body = (await preview.json()) as {
      invitation: { organizationName: string; role: string };
    };

    expect(preview.status).toBe(200);
    expect(body.invitation.organizationName).toBe(setupBody.organizationName);
    expect(body.invitation.role).toBe("operator");
    expect(JSON.stringify(body)).not.toContain("previsualiza@example.com");
  });

  it("rechaza un token inexistente sin escribir auditoría empresarial", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const before = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM audit_logs",
    ).first<{ total: number }>();

    const response = await accept({
      token: "token-inventado-de-longitud-suficiente",
      email: "cualquiera@example.com",
      name: "Nadie",
      password: invitedPassword,
    });
    const after = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM audit_logs",
    ).first<{ total: number }>();

    expect(response.status).toBe(404);
    expect((await response.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "INVITATION_NOT_AVAILABLE" },
    });
    // Sin invitación no hay organización validada, así que el rechazo se emite
    // como evento operativo y no como fila de `audit_logs`.
    expect(after?.total).toBe(before?.total);
    expect(warn.mock.calls.flat().join(" ")).toContain("token_not_found");
    expect(warn.mock.calls.flat().join(" ")).not.toContain(
      "token-inventado-de-longitud-suficiente",
    );
    warn.mockRestore();
  });

  it("rechaza el token de otro correo", async () => {
    const created = await invite("titular@example.com");
    const response = await accept({
      token: tokenFromLink(created.body.acceptUrl),
      email: "impostor@example.com",
      name: "Impostor",
      password: invitedPassword,
    });

    expect(response.status).toBe(404);
    const invitation = await env.DB.prepare(
      "SELECT status FROM organization_invitations WHERE id = ?",
    )
      .bind(created.body.invitation.id)
      .first<{ status: string }>();
    expect(invitation?.status).toBe("pending");

    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs
        WHERE organization_id = ? AND resource_id = ?
        ORDER BY occurred_at DESC LIMIT 1`,
    )
      .bind(organizationId, created.body.invitation.id)
      .first<{ action: string; result: string }>();
    expect(audit).toMatchObject({
      action: "invitation.rejected",
      result: "rejected",
    });
  });

  it("rechaza una invitación vencida y la marca como tal", async () => {
    const created = await invite("tarde@example.com");
    await env.DB.prepare(
      "UPDATE organization_invitations SET expires_at = ? WHERE id = ?",
    )
      .bind(new Date(Date.now() - 1_000).toISOString(), created.body.invitation.id)
      .run();

    const response = await accept({
      token: tokenFromLink(created.body.acceptUrl),
      email: "tarde@example.com",
      name: "Tarde",
      password: invitedPassword,
    });

    expect(response.status).toBe(404);
    const invitation = await env.DB.prepare(
      "SELECT status FROM organization_invitations WHERE id = ?",
    )
      .bind(created.body.invitation.id)
      .first<{ status: string }>();
    expect(invitation?.status).toBe("expired");

    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs
        WHERE organization_id = ? AND resource_id = ?
        ORDER BY occurred_at DESC LIMIT 1`,
    )
      .bind(organizationId, created.body.invitation.id)
      .first<{ action: string; result: string }>();
    expect(audit).toMatchObject({
      action: "invitation.expired",
      result: "rejected",
    });
  });

  it("crea la cuenta con el rol invitado y consume el token", async () => {
    const created = await invite("colaboradora@example.com", "operator");
    const token = tokenFromLink(created.body.acceptUrl);

    const accepted = await accept({
      token,
      email: "colaboradora@example.com",
      name: "Cora Colaboradora",
      password: invitedPassword,
    });

    expect(accepted.status).toBe(201);
    expect(await accepted.json()).toMatchObject({
      organization: { name: setupBody.organizationName },
    });

    const membership = await env.DB.prepare(
      `SELECT m.status, r.role_key
         FROM memberships m
         JOIN users u ON u.id = m.user_id
         JOIN membership_roles mr ON mr.membership_id = m.id
         JOIN roles r ON r.id = mr.role_id
        WHERE m.organization_id = ? AND u.email = ?`,
    )
      .bind(organizationId, "colaboradora@example.com")
      .first<{ status: string; role_key: string }>();
    expect(membership).toMatchObject({ status: "active", role_key: "operator" });

    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs
        WHERE organization_id = ? AND resource_id = ?
        ORDER BY occurred_at DESC LIMIT 1`,
    )
      .bind(organizationId, created.body.invitation.id)
      .first<{ action: string; result: string }>();
    expect(audit).toMatchObject({
      action: "invitation.accepted",
      result: "allowed",
    });

    // El alta habilita el inicio de sesión y nada más: el token ya no sirve.
    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: "colaboradora@example.com",
        password: invitedPassword,
      }),
    });
    expect(login.status).toBe(200);

    const reused = await accept({
      token,
      email: "colaboradora@example.com",
      name: "Cora Otra Vez",
      password: invitedPassword,
    });
    expect(reused.status).toBe(404);

    const memberships = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM memberships m
         JOIN users u ON u.id = m.user_id
        WHERE u.email = ?`,
    )
      .bind("colaboradora@example.com")
      .first<{ total: number }>();
    expect(memberships?.total).toBe(1);
  });

  it("deja sin efecto la invitación revocada", async () => {
    const created = await invite("revocada@example.com");
    const revoked = await fetchWorker(
      `/api/team/invitations/${created.body.invitation.id}/revoke`,
      { method: "POST", headers: { Cookie: sessionCookie } },
    );
    expect(revoked.status).toBe(200);

    const response = await accept({
      token: tokenFromLink(created.body.acceptUrl),
      email: "revocada@example.com",
      name: "Revocada",
      password: invitedPassword,
    });
    expect(response.status).toBe(404);
  });

  it("revoca la invitación anterior al reenviar el mismo correo", async () => {
    const first = await invite("reenviada@example.com");
    const second = await invite("reenviada@example.com");

    const previous = await env.DB.prepare(
      "SELECT status FROM organization_invitations WHERE id = ?",
    )
      .bind(first.body.invitation.id)
      .first<{ status: string }>();
    expect(previous?.status).toBe("revoked");

    const stale = await accept({
      token: tokenFromLink(first.body.acceptUrl),
      email: "reenviada@example.com",
      name: "Reenviada",
      password: invitedPassword,
    });
    expect(stale.status).toBe(404);

    const fresh = await accept({
      token: tokenFromLink(second.body.acceptUrl),
      email: "reenviada@example.com",
      name: "Reenviada",
      password: invitedPassword,
    });
    expect(fresh.status).toBe(201);
  });

  it("corta los intentos repetidos desde la misma dirección", async () => {
    const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
    const address = crypto.randomUUID();
    const attempt = () =>
      accept(
        {
          token: "token-inventado-de-longitud-suficiente",
          email: "fuerza@example.com",
          name: "Fuerza Bruta",
          password: invitedPassword,
        },
        address,
      );

    const statuses: number[] = [];
    for (let index = 0; index < 6; index += 1) {
      statuses.push((await attempt()).status);
    }

    expect(statuses.slice(0, 5)).toEqual([404, 404, 404, 404, 404]);
    expect(statuses.at(-1)).toBe(429);
    // La dirección se guarda hasheada, nunca en claro.
    const keys = await env.DB.prepare(
      "SELECT key_hash FROM auth_rate_limits",
    ).all<{ key_hash: string }>();
    expect(keys.results.map((row) => row.key_hash)).not.toContain(address);
    warn.mockRestore();
  });

  it("no reabre el registro público", async () => {
    const response = await fetchWorker("/api/auth/sign-up/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Intrusa",
        email: "intrusa@example.com",
        password: invitedPassword,
      }),
    });

    expect(response.ok).toBe(false);
    const user = await env.DB.prepare(
      "SELECT COUNT(*) AS total FROM users WHERE email = ?",
    )
      .bind("intrusa@example.com")
      .first<{ total: number }>();
    expect(user?.total).toBe(0);
  });
});
