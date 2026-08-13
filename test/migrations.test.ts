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
        "conversation_assignments",
        "inbound_webhook_events",
        "installation_state",
        "membership_roles",
        "memberships",
        "organization_invitations",
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
      "0011_team_invitations_and_conversation_assignment.sql",
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
        "conversation_assignments_organization_conversation_idx",
        "conversations_organization_assignee_activity_idx",
        "memberships_organization_id_unique",
        "organization_invitations_organization_status_idx",
        "organization_invitations_pending_unique",
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

  it("busca la invitación por un hash único global", async () => {
    // Excepción documentada a «todo índice empieza por organización»: la
    // aceptación no tiene sesión ni organización activa, así que el token es
    // lo único que puede resolverla y debe identificar una sola fila.
    const index = await env.DB.prepare(
      `SELECT sql FROM sqlite_master
        WHERE type = 'index' AND name = 'organization_invitations_token_unique'`,
    ).first<{ sql: string }>();

    expect(index?.sql).toContain("UNIQUE");
    expect(index?.sql).not.toContain("organization_id");
  });

  it("impide que una asignación cruce organizaciones", async () => {
    const now = new Date().toISOString();
    const [owner, intruder] = [crypto.randomUUID(), crypto.randomUUID()];
    const channelId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();

    await env.DB.batch([
      ...[owner, intruder].map((id) =>
        env.DB.prepare(`INSERT INTO organizations
          (id, slug, display_name, status, created_at, updated_at)
          VALUES (?, ?, 'Asignación cruzada', 'active', ?, ?)`)
          .bind(id, `assignment-${id}`, now, now),
      ),
      env.DB.prepare(`INSERT INTO users
        (id, name, email, email_verified, status, created_at, updated_at)
        VALUES (?, 'Ajeno', ?, 0, 'active', ?, ?)`)
        .bind(userId, `${userId}@example.com`, now, now),
    ]);
    await env.DB.batch([
      // La membresía pertenece a la organización intrusa.
      env.DB.prepare(`INSERT INTO memberships
        (id, organization_id, user_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`)
        .bind(membershipId, intruder, userId, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', ?, 'active', ?, ?)`)
        .bind(channelId, owner, `account-${owner}`, now, now),
      env.DB.prepare(`INSERT INTO contacts
        (id, organization_id, status, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?)`)
        .bind(contactId, owner, now, now),
    ]);
    await env.DB.prepare(`INSERT INTO conversations
      (id, organization_id, channel_id, contact_id, external_conversation_id,
       last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(conversationId, owner, channelId, contactId,
        `external-${conversationId}`, now, now, now)
      .run();

    await expect(
      env.DB.prepare(`INSERT INTO conversation_assignments
        (id, organization_id, conversation_id, previous_membership_id,
         next_membership_id, actor_type, actor_id, correlation_id, occurred_at)
        VALUES (?, ?, ?, NULL, ?, 'staff', ?, ?, ?)`)
        .bind(crypto.randomUUID(), owner, conversationId, membershipId,
          userId, crypto.randomUUID(), now)
        .run(),
    ).rejects.toThrow();
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
