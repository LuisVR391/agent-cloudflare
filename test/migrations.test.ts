import { env } from "cloudflare:workers";
import { describe, expect, it } from "vitest";

type NameRow = { name: string };

async function objectNames(type: "table" | "index"): Promise<string[]> {
  const { results } = await env.DB.prepare(
    `SELECT name FROM sqlite_master WHERE type = ? ORDER BY name`,
  )
    .bind(type)
    .all<NameRow>();

  return results.map((row) => row.name);
}

describe("migraciones de D1", () => {
  it("crea el esquema inicial desde una base vacía", async () => {
    expect(await objectNames("table")).toEqual(
      expect.arrayContaining([
        "audit_logs",
        "communication_channels",
        "auth_rate_limits",
        "auth_verifications",
        "contact_identities",
        "contacts",
        "inbound_webhook_events",
        "installation_state",
        "membership_roles",
        "memberships",
        "organizations",
        "permissions",
        "role_permissions",
        "roles",
        "user_accounts",
        "user_sessions",
        "users",
      ]),
    );
  });

  it("registra la migración aplicada", async () => {
    const { results } = await env.DB.prepare(
      `SELECT name FROM d1_migrations ORDER BY id`,
    ).all<NameRow>();

    expect(results.map((row) => row.name)).toEqual([
      "0001_initial_schema.sql",
      "0002_authentication_and_authorization.sql",
      "0003_zernio_whatsapp_channel.sql",
    ]);
  });

  it("indexa cada tabla empresarial por organización", async () => {
    expect(await objectNames("index")).toEqual(
      expect.arrayContaining([
        "contact_identities_contact_idx",
        "contact_identities_scope_unique",
        "communication_channels_organization_status_idx",
        "inbound_webhook_events_organization_received_idx",
        "inbound_webhook_events_organization_status_idx",
        "contacts_organization_created_idx",
        "organizations_slug_unique",
      ]),
    );
  });

  it("rechaza una fila empresarial sin organización", async () => {
    const now = new Date().toISOString();

    await expect(
      env.DB.prepare(
        `INSERT INTO contacts (id, organization_id, status, created_at, updated_at)
         VALUES (?, NULL, 'active', ?, ?)`,
      )
        .bind(crypto.randomUUID(), now, now)
        .run(),
    ).rejects.toThrow();
  });

  it("rechaza un estado fuera del dominio", async () => {
    const now = new Date().toISOString();

    await expect(
      env.DB.prepare(
        `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, 'unknown', ?, ?)`,
      )
        .bind(crypto.randomUUID(), "estado-invalido", "Estado inválido", now, now)
        .run(),
    ).rejects.toThrow();
  });
});
