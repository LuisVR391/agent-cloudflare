import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Equipo",
  organizationSlug: "salon-equipo",
  ownerName: "Olga Owner",
  ownerEmail: "owner-team@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

/**
 * `AuthorizationRepository.seedOwner` solo siembra el catálogo durante la
 * instalación, así que una organización ya instalada no recibiría el permiso
 * que introduce este corte. La migración lo concede por `role_key`; esta
 * prueba comprueba que ambos caminos terminan igual.
 */
describe.sequential("catálogo de permisos del equipo", () => {
  let organizationId: string;

  beforeAll(async () => {
    const setup = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    const result = (await setup.json()) as { organization: { id: string } };
    organizationId = result.organization.id;
  });

  it("concede el mismo catálogo a una organización instalada y a una migrada", async () => {
    const now = new Date().toISOString();
    const legacyId = crypto.randomUUID();
    const roleIds = {
      owner: crypto.randomUUID(),
      manager: crypto.randomUUID(),
      operator: crypto.randomUUID(),
    };
    await env.DB.prepare(
      `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
       VALUES (?, ?, 'Salón heredado', 'active', ?, ?)`,
    )
      .bind(legacyId, `legacy-team-${legacyId}`, now, now)
      .run();
    await env.DB.batch(
      Object.entries(roleIds).map(([roleKey, roleId]) =>
        env.DB.prepare(
          `INSERT INTO roles (id, organization_id, role_key, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(roleId, legacyId, roleKey, roleKey, now, now),
      ),
    );
    // Estado previo al corte: cada rol conserva exactamente lo que tenía antes
    // de que existiera `users.read`. Conceder todo a los tres inventaría un
    // catálogo que nunca existió y la comparación dejaría de significar algo.
    const legacyPermissions: Record<keyof typeof roleIds, string[]> = {
      owner: [
        "panel.read",
        "conversations.read",
        "conversations.manage",
        "contacts.read",
        "contacts.manage",
        "agents.read",
        "agents.manage",
        "users.manage",
        "organization.manage",
      ],
      manager: [
        "panel.read",
        "conversations.read",
        "conversations.manage",
        "contacts.read",
        "contacts.manage",
        "agents.read",
        "agents.manage",
      ],
      operator: [
        "panel.read",
        "conversations.read",
        "conversations.manage",
        "contacts.read",
        "contacts.manage",
      ],
    };
    await env.DB.batch(
      Object.entries(legacyPermissions).flatMap(([roleKey, keys]) =>
        keys.map((permissionKey) =>
          env.DB.prepare(
            `INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
             SELECT ?, ?, p.id, ?
               FROM permissions p
              WHERE p.permission_key = ?`,
          ).bind(
            legacyId,
            roleIds[roleKey as keyof typeof roleIds],
            now,
            permissionKey,
          ),
        ),
      ),
    );

    // Solo las sentencias de catálogo: reaplicar el DDL fallaría porque las
    // tablas ya existen, y la propagación es lo que se verifica.
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
      .TEST_MIGRATIONS;
    const migration = migrations.find(
      (item) =>
        item.name === "0011_team_invitations_and_conversation_assignment.sql",
    );
    expect(migration).toBeDefined();
    const grants = migration!.queries.filter((query) =>
      /INSERT INTO (permissions|role_permissions)/i.test(query),
    );
    expect(grants).toHaveLength(2);
    for (const query of grants) {
      await env.DB.prepare(query).run();
    }

    const catalog = async (scope: string) => {
      const { results } = await env.DB.prepare(
        `SELECT r.role_key, p.permission_key
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.organization_id = ? AND p.permission_key LIKE 'users.%'
          ORDER BY r.role_key, p.permission_key`,
      )
        .bind(scope)
        .all<{ role_key: string; permission_key: string }>();
      return results.map((row) => `${row.role_key}:${row.permission_key}`);
    };

    expect(await catalog(legacyId)).toEqual([
      "manager:users.read",
      "operator:users.read",
      "owner:users.manage",
      "owner:users.read",
    ]);
    expect(await catalog(organizationId)).toEqual(await catalog(legacyId));
  });
});
