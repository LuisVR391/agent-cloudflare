import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ContactNotInOrganizationError,
  MembershipNotActiveInOrganizationError,
} from "../src/worker/domain/errors";
import { ContactRepository } from "../src/worker/repositories/contact-repository";
import { NoteRepository } from "../src/worker/repositories/note-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Notas",
  organizationSlug: "salon-notas",
  ownerName: "Nadia Notas",
  ownerEmail: "owner-notes@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "55555555-5555-4555-8555-555555555555";

describe.sequential("notas del contacto", () => {
  let sessionCookie: string;
  let organizationId: string;
  let ownerMembershipId: string;
  let contactId: string;
  let conversationId: string;
  let foreignMembershipId: string;

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

    const members = await fetchWorker("/api/team/members", {
      headers: { cookie: sessionCookie },
    });
    const { members: team } = (await members.json()) as {
      members: { membershipId: string; email: string }[];
    };
    ownerMembershipId = team.find(
      ({ email }) => email === setupBody.ownerEmail,
    )!.membershipId;

    const now = new Date().toISOString();
    const channelId = crypto.randomUUID();
    const foreignUserId = crypto.randomUUID();
    conversationId = crypto.randomUUID();
    foreignMembershipId = crypto.randomUUID();

    const contact = await new ContactRepository(env.DB).create(organizationId, {
      displayName: "Lucía Cliente",
    });
    contactId = contact.id;

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, 'otro-salon-notas', 'Otro salón', 'active', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO users
        (id, name, email, email_verified, status, created_at, updated_at)
        VALUES (?, 'Ajena', 'ajena-notes@example.com', 0, 'active', ?, ?)`)
        .bind(foreignUserId, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', ?, 'active', ?, ?)`)
        .bind(channelId, organizationId, `account-${channelId}`, now, now),
    ]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO memberships
        (id, organization_id, user_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`)
        .bind(foreignMembershipId, otherOrganizationId, foreignUserId, now, now),
      env.DB.prepare(`INSERT INTO conversations
        (id, organization_id, channel_id, contact_id, external_conversation_id,
         last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(conversationId, organizationId, channelId, contactId,
          `conversation-${conversationId}`, now, now, now),
    ]);
  });

  it("conserva autor, cuerpo y la conversación que la originó", async () => {
    const repository = new NoteRepository(env.DB);
    const note = await repository.create(organizationId, {
      contactId,
      conversationId,
      body: "Prefiere cita por la tarde.",
      authorMembershipId: ownerMembershipId,
    });

    expect(note).toMatchObject({
      contactId,
      conversationId,
      authorMembershipId: ownerMembershipId,
      authorName: setupBody.ownerName,
      body: "Prefiere cita por la tarde.",
    });

    const fromContact = await repository.listByContact(organizationId, contactId);
    expect(fromContact.map((item) => item.id)).toContain(note.id);
    const fromConversation = await repository.listByConversation(
      organizationId,
      conversationId,
    );
    expect(fromConversation.map((item) => item.id)).toContain(note.id);
  });

  it("acepta una nota de ficha, sin conversación de origen", async () => {
    const note = await new NoteRepository(env.DB).create(organizationId, {
      contactId,
      body: "Llegó por recomendación de otra clienta.",
      authorMembershipId: ownerMembershipId,
    });

    expect(note.conversationId).toBeNull();
  });

  it("rechaza al autor sin membresía activa en la organización", async () => {
    const repository = new NoteRepository(env.DB);

    // Una membresía de otra organización no autoriza aquí.
    await expect(
      repository.create(organizationId, {
        contactId,
        body: "Nota de un autor ajeno.",
        authorMembershipId: foreignMembershipId,
      }),
    ).rejects.toBeInstanceOf(MembershipNotActiveInOrganizationError);

    // Y una membresía propia revocada tampoco.
    await env.DB.prepare("UPDATE memberships SET status = 'revoked' WHERE id = ?")
      .bind(ownerMembershipId)
      .run();
    await expect(
      repository.create(organizationId, {
        contactId,
        body: "Nota de quien ya no pertenece al equipo.",
        authorMembershipId: ownerMembershipId,
      }),
    ).rejects.toBeInstanceOf(MembershipNotActiveInOrganizationError);
    await env.DB.prepare("UPDATE memberships SET status = 'active' WHERE id = ?")
      .bind(ownerMembershipId)
      .run();
  });

  it("no anota sobre un contacto ni una conversación de otra organización", async () => {
    const repository = new NoteRepository(env.DB);
    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Cliente ajena" },
    );

    await expect(
      repository.create(organizationId, {
        contactId: foreignContact.id,
        body: "Nota que cruzaría el límite.",
        authorMembershipId: ownerMembershipId,
      }),
    ).rejects.toBeInstanceOf(ContactNotInOrganizationError);

    // La conversación pertenece a esta organización, pero a otro contacto: la
    // nota quedaría anclada a un hilo que no le corresponde.
    const otherContact = await new ContactRepository(env.DB).create(
      organizationId,
      { displayName: "Otra clienta" },
    );
    await expect(
      repository.create(organizationId, {
        contactId: otherContact.id,
        conversationId,
        body: "Nota con hilo ajeno.",
        authorMembershipId: ownerMembershipId,
      }),
    ).rejects.toBeInstanceOf(ContactNotInOrganizationError);

    const { results } = await env.DB.prepare(
      `SELECT id FROM contact_notes WHERE organization_id = ? AND contact_id = ?`,
    )
      .bind(organizationId, foreignContact.id)
      .all<{ id: string }>();
    expect(results).toEqual([]);
  });

  it("no expone las notas de otra organización", async () => {
    const repository = new NoteRepository(env.DB);
    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Cliente de otro salón" },
    );
    const foreign = await repository.create(otherOrganizationId, {
      contactId: foreignContact.id,
      body: "Nota ajena.",
      authorMembershipId: foreignMembershipId,
    });

    await expect(repository.find(organizationId, foreign.id)).resolves.toBeNull();
    const visible = await repository.listByContact(
      organizationId,
      foreignContact.id,
    );
    expect(visible).toEqual([]);
  });

  it("crea y lista por API dejando constancia sin el cuerpo", async () => {
    const correlationId = crypto.randomUUID();
    const created = await fetchWorker("/api/notes", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({
        contactId,
        conversationId,
        body: "Confirmó que viene con su hija.",
      }),
    });
    expect(created.status).toBe(201);
    const { note } = (await created.json()) as {
      note: { id: string; authorName: string | null; body: string };
    };
    expect(note).toMatchObject({
      authorName: setupBody.ownerName,
      body: "Confirmó que viene con su hija.",
    });

    const listed = await fetchWorker(`/api/notes?contactId=${contactId}`, {
      headers: { cookie: sessionCookie },
    });
    expect(listed.status).toBe(200);
    const { notes } = (await listed.json()) as { notes: Array<{ id: string }> };
    expect(notes.map((item) => item.id)).toContain(note.id);

    const byConversation = await fetchWorker(
      `/api/notes?conversationId=${conversationId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(byConversation.status).toBe(200);

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs
        WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toEqual({
      action: "contact_note.create",
      resource_id: note.id,
      result: "allowed",
    });

    // El cuerpo de la nota es dato personal por contexto: la auditoría guarda
    // identificadores y nunca lo que se escribió.
    const leaked = await env.DB.prepare(
      `SELECT count(*) AS total FROM audit_logs
        WHERE organization_id = ? AND action LIKE 'contact_note%'
          AND resource_id LIKE '%viene con su hija%'`,
    )
      .bind(organizationId)
      .first<{ total: number }>();
    expect(leaked?.total).toBe(0);
  });

  it("falla cerrado ante entrada inválida, sesión ausente y referencia ajena", async () => {
    await expect(
      fetchWorker(`/api/notes?contactId=${contactId}`).then((r) => r.status),
    ).resolves.toBe(401);

    await expect(
      fetchWorker("/api/notes", { headers: { cookie: sessionCookie } }).then(
        (r) => r.status,
      ),
    ).resolves.toBe(400);

    const empty = await fetchWorker("/api/notes", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, body: "   " }),
    });
    expect(empty.status).toBe(400);

    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Ajena otra vez" },
    );
    const foreign = await fetchWorker("/api/notes", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: foreignContact.id, body: "Hola." }),
    });
    expect(foreign.status).toBe(404);

    await expect(
      fetchWorker(`/api/notes/${crypto.randomUUID()}`, {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(404);
  });

  it("audita el rechazo sin permiso de gestión y conserva la lectura", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'contacts.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();

    const rejected = await fetchWorker("/api/notes", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ contactId, body: "No debería escribirse." }),
    });
    expect(rejected.status).toBe(403);

    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; result: string }>();
    expect(audit).toEqual({ action: "contact_note.create", result: "rejected" });

    const listed = await fetchWorker(`/api/notes?contactId=${contactId}`, {
      headers: { cookie: sessionCookie },
    });
    expect(listed.status).toBe(200);
  });

  it("rechaza la consulta sin el permiso de contactos", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'contacts.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker(`/api/notes?contactId=${contactId}`, {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
