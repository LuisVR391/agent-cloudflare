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
        "agent_publication_transitions",
        "agent_version_knowledge_scopes",
        "agent_version_tools",
        "agent_versions",
        "agents",
        "appointment_transitions",
        "appointments",
        "audit_logs",
        "communication_channels",
        "auth_rate_limits",
        "auth_verifications",
        "contact_identities",
        "contact_notes",
        "contact_tag_assignments",
        "contact_tags",
        "contacts",
        "conversation_assignments",
        "inbound_webhook_events",
        "installation_state",
        "membership_roles",
        "memberships",
        "organization_invitations",
        "opportunities",
        "opportunity_stage_transitions",
        "organizations",
        "permissions",
        "pipeline_stages",
        "pipelines",
        "role_permissions",
        "roles",
        "services",
        "tasks",
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
      "0012_service_catalog.sql",
      "0013_pipelines_and_stages.sql",
      "0014_opportunities.sql",
      "0015_contact_notes.sql",
      "0016_tasks.sql",
      "0017_appointments_and_time_zone.sql",
      "0018_metrics_read_access.sql",
      "0019_agents_and_versions.sql",
    ]);
  });

  it("indexa cada tabla empresarial por organización", async () => {
    expect(await objectNames("index")).toEqual(
      expect.arrayContaining([
        "agents_organization_normalized_name_unique",
        "agents_organization_status_name_idx",
        "agent_versions_organization_agent_number_unique",
        // Garantiza en el motor que un agente no tenga dos versiones publicadas
        // a la vez, sin depender de que el repositorio sea la única ruta de
        // escritura (ADR-0014).
        "agent_versions_published_unique",
        "agent_version_tools_organization_tool_idx",
        "agent_version_knowledge_scopes_organization_label_idx",
        "agent_publication_transitions_organization_agent_idx",
        "appointments_organization_starts_idx",
        "appointments_organization_assignee_starts_idx",
        "appointment_transitions_organization_appointment_idx",
        "contact_identities_contact_idx",
        "contact_identities_scope_unique",
        "contact_notes_organization_contact_idx",
        "contact_notes_organization_conversation_idx",
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
        "opportunities_organization_stage_activity_idx",
        "opportunity_transitions_organization_opportunity_idx",
        "organizations_slug_unique",
        "pipelines_organization_template_unique",
        "pipeline_stages_organization_pipeline_position_idx",
        "services_organization_normalized_name_unique",
        "services_organization_status_name_idx",
        "tasks_organization_assignee_due_idx",
        "tasks_organization_status_due_idx",
        "message_status_events_reconciliation_idx",
        "messages_organization_platform_idx",
        "outbound_deliveries_organization_external_idx",
        // Sin estos dos, acotar el periodo de una métrica no evitaría el
        // escaneo de la tabla (ADR-0012).
        "messages_organization_occurred_idx",
        "opportunities_organization_created_idx",
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

  it("impide que el historial de publicación cruce organizaciones", async () => {
    const now = new Date().toISOString();
    const [owner, intruder] = [crypto.randomUUID(), crypto.randomUUID()];
    const userId = crypto.randomUUID();
    const memberships = {
      [owner]: crypto.randomUUID(),
      [intruder]: crypto.randomUUID(),
    };
    const agents = {
      [owner]: crypto.randomUUID(),
      [intruder]: crypto.randomUUID(),
    };
    const foreignVersionId = crypto.randomUUID();

    await env.DB.batch([
      ...[owner, intruder].map((id) =>
        env.DB.prepare(`INSERT INTO organizations
          (id, slug, display_name, status, created_at, updated_at)
          VALUES (?, ?, 'Publicación cruzada', 'active', ?, ?)`).bind(
          id,
          `publication-${id}`,
          now,
          now,
        ),
      ),
      env.DB.prepare(`INSERT INTO users
        (id, name, email, email_verified, status, created_at, updated_at)
        VALUES (?, 'Ajeno', ?, 0, 'active', ?, ?)`).bind(
        userId,
        `${userId}@example.com`,
        now,
        now,
      ),
    ]);
    await env.DB.batch(
      [owner, intruder].map((id) =>
        env.DB.prepare(`INSERT INTO memberships
          (id, organization_id, user_id, status, created_at, updated_at)
          VALUES (?, ?, ?, 'active', ?, ?)`).bind(
          memberships[id],
          id,
          userId,
          now,
          now,
        ),
      ),
    );
    await env.DB.batch(
      [owner, intruder].map((id) =>
        env.DB.prepare(`INSERT INTO agents
          (id, organization_id, name, normalized_name, status,
           created_by_membership_id, created_at, updated_at)
          VALUES (?, ?, 'Recepción', 'recepción', 'active', ?, ?, ?)`).bind(
          agents[id],
          id,
          memberships[id],
          now,
          now,
        ),
      ),
    );
    // La versión pertenece a la organización intrusa.
    await env.DB.prepare(`INSERT INTO agent_versions
      (id, organization_id, agent_id, version_number, status, instructions,
       model, created_by_membership_id, created_at, updated_at)
      VALUES (?, ?, ?, 1, 'published', 'Atiende con amabilidad.',
              'modelo-previsto', ?, ?, ?)`)
      .bind(
        foreignVersionId,
        intruder,
        agents[intruder],
        memberships[intruder],
        now,
        now,
      )
      .run();

    await expect(
      env.DB.prepare(`INSERT INTO agent_publication_transitions
        (id, organization_id, agent_id, previous_version_id, next_version_id,
         action, reason, actor_type, actor_id, correlation_id, occurred_at)
        VALUES (?, ?, ?, NULL, ?, 'published', 'Intento cruzado',
                'staff', ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          owner,
          agents[owner],
          foreignVersionId,
          userId,
          crypto.randomUUID(),
          now,
        )
        .run(),
    ).rejects.toThrow();
  });

  it("admite a lo sumo una versión publicada por agente", async () => {
    const now = new Date().toISOString();
    const organizationId = crypto.randomUUID();
    const userId = crypto.randomUUID();
    const membershipId = crypto.randomUUID();
    const [firstAgentId, secondAgentId] = [
      crypto.randomUUID(),
      crypto.randomUUID(),
    ];

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, ?, 'Una sola publicada', 'active', ?, ?)`).bind(
        organizationId,
        `published-${organizationId}`,
        now,
        now,
      ),
      env.DB.prepare(`INSERT INTO users
        (id, name, email, email_verified, status, created_at, updated_at)
        VALUES (?, 'Dueña', ?, 0, 'active', ?, ?)`).bind(
        userId,
        `${userId}@example.com`,
        now,
        now,
      ),
    ]);
    await env.DB.prepare(`INSERT INTO memberships
      (id, organization_id, user_id, status, created_at, updated_at)
      VALUES (?, ?, ?, 'active', ?, ?)`)
      .bind(membershipId, organizationId, userId, now, now)
      .run();
    await env.DB.batch(
      [firstAgentId, secondAgentId].map((agentId, index) =>
        env.DB.prepare(`INSERT INTO agents
          (id, organization_id, name, normalized_name, status,
           created_by_membership_id, created_at, updated_at)
          VALUES (?, ?, ?, ?, 'active', ?, ?, ?)`).bind(
          agentId,
          organizationId,
          `Agente ${index}`,
          `agente ${index}`,
          membershipId,
          now,
          now,
        ),
      ),
    );

    const publish = (agentId: string, versionNumber: number) =>
      env.DB.prepare(`INSERT INTO agent_versions
        (id, organization_id, agent_id, version_number, status, instructions,
         model, created_by_membership_id, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'published', 'Atiende con amabilidad.',
                'modelo-previsto', ?, ?, ?)`)
        .bind(
          crypto.randomUUID(),
          organizationId,
          agentId,
          versionNumber,
          membershipId,
          now,
          now,
        )
        .run();

    await publish(firstAgentId, 1);
    // Una segunda versión publicada del mismo agente dejaría sin respuesta la
    // pregunta de con qué configuración se atiende.
    await expect(publish(firstAgentId, 2)).rejects.toThrow();
    // El índice es parcial y por agente: otro agente sí publica la suya.
    await expect(publish(secondAgentId, 1)).resolves.toBeDefined();
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
