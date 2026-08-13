import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import type { ConversationSummary } from "../src/worker/domain/types";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón con Responsables",
  organizationSlug: "salon-responsables",
  ownerName: "Olga Owner",
  ownerEmail: "owner-assignment@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

const invitedEmail = "responsable@example.com";
const invitedPassword = "another-correct-horse-battery";

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "77777777-7777-4777-8777-777777777777";

describe.sequential("responsable de conversación", () => {
  let sessionCookie: string;
  let organizationId: string;
  let ownerMembershipId: string;
  let invitedMembershipId: string;
  let foreignMembershipId: string;
  let conversationId: string;

  async function patch(body: Record<string, unknown>) {
    return fetchWorker(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify(body),
    });
  }

  async function currentVersion(): Promise<number> {
    const row = await env.DB.prepare(
      "SELECT version FROM conversations WHERE id = ?",
    )
      .bind(conversationId)
      .first<{ version: number }>();
    return row!.version;
  }

  function assignmentHistory() {
    return env.DB.prepare(
      `SELECT previous_membership_id, next_membership_id, actor_id
         FROM conversation_assignments
        WHERE organization_id = ? AND conversation_id = ?
        ORDER BY occurred_at, id`,
    )
      .bind(organizationId, conversationId)
      .all<{
        previous_membership_id: string | null;
        next_membership_id: string | null;
        actor_id: string;
      }>();
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

    // Segunda persona por el camino real: invitación creada y aceptada.
    const invitation = await fetchWorker("/api/team/invitations", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ email: invitedEmail, role: "operator" }),
    });
    const { acceptUrl } = (await invitation.json()) as { acceptUrl: string };
    await fetchWorker("/api/invitations/accept", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "CF-Connecting-IP": crypto.randomUUID(),
      },
      body: JSON.stringify({
        token: acceptUrl.slice(acceptUrl.indexOf("#") + 1),
        email: invitedEmail,
        name: "Rosa Responsable",
        password: invitedPassword,
      }),
    });

    const members = await fetchWorker("/api/team/members", {
      headers: { Cookie: sessionCookie },
    });
    const { members: team } = (await members.json()) as {
      members: { membershipId: string; email: string }[];
    };
    ownerMembershipId = team.find(
      ({ email }) => email === setupBody.ownerEmail,
    )!.membershipId;
    invitedMembershipId = team.find(
      ({ email }) => email === invitedEmail,
    )!.membershipId;

    const now = new Date().toISOString();
    const channelId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const foreignUserId = crypto.randomUUID();
    conversationId = crypto.randomUUID();
    foreignMembershipId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, 'otro-salon-responsables', 'Otro salón', 'active', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO users
        (id, name, email, email_verified, status, created_at, updated_at)
        VALUES (?, 'Ajena', 'ajena-assignment@example.com', 0, 'active', ?, ?)`)
        .bind(foreignUserId, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', ?, 'active', ?, ?)`)
        .bind(channelId, organizationId, `account-${channelId}`, now, now),
      env.DB.prepare(`INSERT INTO contacts
        (id, organization_id, display_name, status, created_at, updated_at)
        VALUES (?, ?, 'Clienta', 'active', ?, ?)`)
        .bind(contactId, organizationId, now, now),
    ]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO memberships
        (id, organization_id, user_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`)
        .bind(foreignMembershipId, otherOrganizationId, foreignUserId, now, now),
      env.DB.prepare(`INSERT INTO contact_identities
        (id, organization_id, contact_id, provider, external_id, created_at, updated_at)
        VALUES (?, ?, ?, 'whatsapp', ?, ?, ?)`)
        .bind(crypto.randomUUID(), organizationId, contactId,
          `external-${contactId}`, now, now),
      env.DB.prepare(`INSERT INTO conversations
        (id, organization_id, channel_id, contact_id, external_conversation_id,
         last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(conversationId, organizationId, channelId, contactId,
          `conversation-${conversationId}`, now, now, now),
    ]);
  });

  it("asigna, reasigna y libera dejando historial de cada cambio", async () => {
    const assigned = await patch({
      expectedVersion: await currentVersion(),
      assigneeMembershipId: ownerMembershipId,
    });
    expect(assigned.status).toBe(200);
    const first = (await assigned.json()) as { conversation: ConversationSummary };
    expect(first.conversation.assignee).toMatchObject({
      membershipId: ownerMembershipId,
      name: setupBody.ownerName,
    });

    const reassigned = await patch({
      expectedVersion: await currentVersion(),
      assigneeMembershipId: invitedMembershipId,
    });
    expect(reassigned.status).toBe(200);

    const released = await patch({
      expectedVersion: await currentVersion(),
      assigneeMembershipId: null,
    });
    expect(released.status).toBe(200);
    expect(
      ((await released.json()) as { conversation: ConversationSummary })
        .conversation.assignee,
    ).toBeNull();

    const { results } = await assignmentHistory();
    expect(
      results.map((row) => [row.previous_membership_id, row.next_membership_id]),
    ).toEqual([
      [null, ownerMembershipId],
      [ownerMembershipId, invitedMembershipId],
      [invitedMembershipId, null],
    ]);
  });

  it("rechaza una membresía de otra organización sin dejar rastro", async () => {
    const before = await assignmentHistory();
    const version = await currentVersion();

    const response = await patch({
      expectedVersion: version,
      assigneeMembershipId: foreignMembershipId,
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ASSIGNEE" },
    });
    const after = await assignmentHistory();
    expect(after.results).toHaveLength(before.results.length);
    // Ni la versión avanza: el lote entero se revierte.
    expect(await currentVersion()).toBe(version);
  });

  it("rechaza una membresía revocada de la propia organización", async () => {
    await env.DB.prepare(
      "UPDATE memberships SET status = 'revoked' WHERE id = ?",
    )
      .bind(invitedMembershipId)
      .run();

    const response = await patch({
      expectedVersion: await currentVersion(),
      assigneeMembershipId: invitedMembershipId,
    });

    expect(response.status).toBe(400);
    await env.DB.prepare(
      "UPDATE memberships SET status = 'active' WHERE id = ?",
    )
      .bind(invitedMembershipId)
      .run();
  });

  it("conserva el responsable cuando el cambio solo toca el estado", async () => {
    await patch({
      expectedVersion: await currentVersion(),
      assigneeMembershipId: ownerMembershipId,
    });
    const historyBefore = (await assignmentHistory()).results.length;

    const resolved = await patch({
      expectedVersion: await currentVersion(),
      status: "resolved",
    });
    const body = (await resolved.json()) as { conversation: ConversationSummary };

    expect(body.conversation.status).toBe("resolved");
    expect(body.conversation.assignee?.membershipId).toBe(ownerMembershipId);
    // Un cambio de estado no es un cambio de responsable.
    expect((await assignmentHistory()).results).toHaveLength(historyBefore);

    await patch({ expectedVersion: await currentVersion(), status: "open" });
  });

  it("rechaza una versión obsoleta sin escribir historial", async () => {
    const stale = (await currentVersion()) - 1;
    const before = (await assignmentHistory()).results.length;

    const response = await patch({
      expectedVersion: stale,
      assigneeMembershipId: invitedMembershipId,
    });

    expect(response.status).toBe(409);
    expect((await assignmentHistory()).results).toHaveLength(before);
  });

  it("filtra el inbox por responsable", async () => {
    await patch({
      expectedVersion: await currentVersion(),
      assigneeMembershipId: ownerMembershipId,
    });

    const mine = await fetchWorker("/api/conversations?assignee=me", {
      headers: { Cookie: sessionCookie },
    });
    const mineBody = (await mine.json()) as { conversations: ConversationSummary[] };
    expect(mineBody.conversations.map(({ id }) => id)).toContain(conversationId);

    const unassigned = await fetchWorker("/api/conversations?assignee=unassigned", {
      headers: { Cookie: sessionCookie },
    });
    const unassignedBody = (await unassigned.json()) as {
      conversations: ConversationSummary[];
    };
    expect(unassignedBody.conversations.map(({ id }) => id)).not.toContain(
      conversationId,
    );

    const other = await fetchWorker(
      `/api/conversations?assignee=${invitedMembershipId}`,
      { headers: { Cookie: sessionCookie } },
    );
    const otherBody = (await other.json()) as {
      conversations: ConversationSummary[];
    };
    expect(otherBody.conversations).toHaveLength(0);
  });

  it("rechaza un filtro de responsable con forma inválida", async () => {
    const response = await fetchWorker("/api/conversations?assignee=cualquiera", {
      headers: { Cookie: sessionCookie },
    });

    expect(response.status).toBe(400);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "INVALID_ASSIGNEE_FILTER" },
    });
  });
});
