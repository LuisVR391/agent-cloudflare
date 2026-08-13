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
        "contact_tag_assignments",
        "contact_tags",
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
      "0004_conversations_and_messages.sql",
      "0005_message_sent_reconciliation.sql",
      "0006_outbound_status_reconciliation.sql",
      "0007_conversation_read_receipts.sql",
      "0008_drop_conversation_read_receipts.sql",
      "0009_message_attachment_recovery.sql",
      "0010_contacts_profile_and_tags.sql",
    ]);
  });

  it("indexa cada tabla empresarial por organización", async () => {
    expect(await objectNames("index")).toEqual(
      expect.arrayContaining([
        "contact_identities_contact_idx",
        "contact_identities_scope_unique",
        "contact_tag_assignments_organization_tag_idx",
        "contact_tags_organization_name_unique",
        "contacts_organization_display_name_idx",
        "communication_channels_organization_status_idx",
        "inbound_webhook_events_organization_received_idx",
        "inbound_webhook_events_organization_status_idx",
        "contacts_organization_created_idx",
        "organizations_slug_unique",
        "message_status_events_reconciliation_idx",
        "messages_organization_platform_idx",
        "outbound_deliveries_organization_external_idx",
      ]),
    );
  });

  it("acepta message.sent en recepción y ciclo de estado", async () => {
    const now = new Date().toISOString();
    const organizationId = crypto.randomUUID();
    const channelId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, ?, 'Migración sent', 'active', ?, ?)`)
        .bind(organizationId, `migration-sent-${organizationId}`, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', ?, 'active', ?, ?)`)
        .bind(channelId, organizationId, `account-${organizationId}`, now, now),
    ]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO inbound_webhook_events
        (id, organization_id, channel_id, adapter, external_event_id,
         event_type, status, correlation_id, received_at)
        VALUES (?, ?, ?, 'zernio', ?, 'message.sent', 'received', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          organizationId,
          channelId,
          `event-${organizationId}`,
          crypto.randomUUID(),
          now,
        ),
      env.DB.prepare(`INSERT INTO message_status_events
        (id, organization_id, external_event_id, conversation_external_id,
         message_external_id, status, occurred_at, created_at)
        VALUES (?, ?, ?, 'conversation', 'message', 'sent', ?, ?)`)
        .bind(
          crypto.randomUUID(),
          organizationId,
          `status-${organizationId}`,
          now,
          now,
        ),
    ]);
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
