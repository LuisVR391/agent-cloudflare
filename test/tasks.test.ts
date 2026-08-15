import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MembershipNotActiveInOrganizationError,
  TaskSubjectNotInOrganizationError,
} from "../src/worker/domain/errors";
import { ContactRepository } from "../src/worker/repositories/contact-repository";
import { TaskRepository } from "../src/worker/repositories/task-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Tareas",
  organizationSlug: "salon-tareas",
  ownerName: "Tania Tareas",
  ownerEmail: "owner-tasks@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "44444444-4444-4444-8444-444444444444";

describe.sequential("tareas con responsable y vencimiento", () => {
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
        VALUES (?, 'otro-salon-tareas', 'Otro salón', 'active', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO users
        (id, name, email, email_verified, status, created_at, updated_at)
        VALUES (?, 'Ajena', 'ajena-tasks@example.com', 0, 'active', ?, ?)`)
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

  it("nace abierta, a nombre de quien la crea si nadie más la recibe", async () => {
    const task = await new TaskRepository(env.DB).create(organizationId, {
      title: "Llamar al proveedor",
      createdByMembershipId: ownerMembershipId,
    });

    expect(task).toMatchObject({
      title: "Llamar al proveedor",
      status: "open",
      assigneeMembershipId: ownerMembershipId,
      assigneeName: setupBody.ownerName,
      dueAt: null,
      subject: null,
      version: 1,
      completedAt: null,
    });
  });

  it("cuelga de un solo sujeto y lo resuelve para mostrarlo", async () => {
    const repository = new TaskRepository(env.DB);
    const fromConversation = await repository.create(organizationId, {
      title: "Confirmar la cita del sábado",
      subject: { type: "conversation", id: conversationId },
      dueAt: "2026-08-20T17:00:00.000Z",
      createdByMembershipId: ownerMembershipId,
    });

    expect(fromConversation.subject).toEqual({
      type: "conversation",
      id: conversationId,
    });
    expect(fromConversation.subjectLabel).toBe("Lucía Cliente");

    const bySubject = await repository.listBySubject(organizationId, {
      type: "conversation",
      id: conversationId,
    });
    expect(bySubject.map((task) => task.id)).toContain(fromConversation.id);

    // La misma tarea no puede colgar además de un contacto: el `CHECK` de la
    // tabla lo impide incluso saltándose el repositorio.
    await expect(
      env.DB.prepare(
        `UPDATE tasks SET contact_id = ? WHERE organization_id = ? AND id = ?`,
      )
        .bind(contactId, organizationId, fromConversation.id)
        .run(),
    ).rejects.toThrow();
  });

  it("cierra sellando el momento y reabrir lo borra", async () => {
    const repository = new TaskRepository(env.DB);
    const created = await repository.create(organizationId, {
      title: "Pedir tinte",
      createdByMembershipId: ownerMembershipId,
    });

    const done = await repository.update(organizationId, created.id, {
      expectedVersion: created.version,
      status: "done",
    });
    expect(done).toMatchObject({ status: "done", version: created.version + 1 });
    expect(done!.completedAt).not.toBeNull();

    const reopened = await repository.update(organizationId, created.id, {
      expectedVersion: done!.version,
      status: "open",
    });
    expect(reopened).toMatchObject({ status: "open", completedAt: null });

    // Cerrarla otra vez con la versión vieja no aplica nada.
    await expect(
      repository.update(organizationId, created.id, {
        expectedVersion: created.version,
        status: "done",
      }),
    ).resolves.toBeNull();
    const unchanged = await repository.find(organizationId, created.id);
    expect(unchanged!.status).toBe("open");
  });

  it("rechaza al responsable sin membresía activa, al crear y al reasignar", async () => {
    const repository = new TaskRepository(env.DB);

    await expect(
      repository.create(organizationId, {
        title: "Tarea para alguien ajeno",
        assigneeMembershipId: foreignMembershipId,
        createdByMembershipId: ownerMembershipId,
      }),
    ).rejects.toBeInstanceOf(MembershipNotActiveInOrganizationError);

    const created = await repository.create(organizationId, {
      title: "Revisar caja",
      createdByMembershipId: ownerMembershipId,
    });
    await expect(
      repository.update(organizationId, created.id, {
        expectedVersion: created.version,
        assigneeMembershipId: foreignMembershipId,
      }),
    ).rejects.toBeInstanceOf(MembershipNotActiveInOrganizationError);

    const unchanged = await repository.find(organizationId, created.id);
    expect(unchanged!.assigneeMembershipId).toBe(ownerMembershipId);
  });

  it("no cuelga la tarea de un sujeto de otra organización", async () => {
    const repository = new TaskRepository(env.DB);
    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Cliente ajena" },
    );

    await expect(
      repository.create(organizationId, {
        title: "Tarea que cruzaría el límite",
        subject: { type: "contact", id: foreignContact.id },
        createdByMembershipId: ownerMembershipId,
      }),
    ).rejects.toBeInstanceOf(TaskSubjectNotInOrganizationError);

    const { results } = await env.DB.prepare(
      `SELECT id FROM tasks WHERE organization_id = ? AND contact_id = ?`,
    )
      .bind(organizationId, foreignContact.id)
      .all<{ id: string }>();
    expect(results).toEqual([]);
  });

  it("no expone ni cambia la tarea de otra organización", async () => {
    const repository = new TaskRepository(env.DB);
    const foreign = await repository.create(otherOrganizationId, {
      title: "Tarea ajena",
      createdByMembershipId: foreignMembershipId,
    });

    await expect(repository.find(organizationId, foreign.id)).resolves.toBeNull();
    await expect(
      repository.update(organizationId, foreign.id, {
        expectedVersion: foreign.version,
        status: "done",
      }),
    ).resolves.toBeNull();

    const visible = await repository.list(organizationId);
    expect(visible.map((task) => task.id)).not.toContain(foreign.id);
  });

  it("ordena las pendientes primero y filtra por responsable y vencimiento", async () => {
    const repository = new TaskRepository(env.DB);
    await repository.create(organizationId, {
      title: "Urgente de hoy",
      dueAt: "2026-08-15T09:00:00.000Z",
      createdByMembershipId: ownerMembershipId,
    });
    const late = await repository.create(organizationId, {
      title: "De la semana que viene",
      dueAt: "2026-08-25T09:00:00.000Z",
      createdByMembershipId: ownerMembershipId,
    });

    const open = await repository.list(organizationId, { status: "open" });
    const withDueDate = open.filter((task) => task.dueAt !== null);
    expect(withDueDate[0].title).toBe("Urgente de hoy");

    const soon = await repository.list(organizationId, {
      dueBefore: "2026-08-20T00:00:00.000Z",
    });
    expect(soon.map((task) => task.id)).not.toContain(late.id);

    const mine = await repository.list(organizationId, {
      assigneeMembershipId: ownerMembershipId,
    });
    expect(mine.length).toBeGreaterThan(0);
    expect(
      mine.every((task) => task.assigneeMembershipId === ownerMembershipId),
    ).toBe(true);
  });

  it("crea, filtra por «me» y cierra por API dejando constancia", async () => {
    const correlationId = crypto.randomUUID();
    const created = await fetchWorker("/api/tasks", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({
        title: "Cotizar el paquete de novia",
        details: "Pidió precio con maquillaje incluido.",
        dueAt: "2026-08-18T16:00:00.000Z",
        subject: { type: "contact", id: contactId },
      }),
    });
    expect(created.status).toBe(201);
    const { task } = (await created.json()) as {
      task: { id: string; version: number; assigneeName: string | null };
    };
    // Sin responsable explícito, la tarea queda a nombre de quien la creó.
    expect(task.assigneeName).toBe(setupBody.ownerName);

    const mine = await fetchWorker("/api/tasks?assignee=me&status=open", {
      headers: { cookie: sessionCookie },
    });
    expect(mine.status).toBe(200);
    const listed = (await mine.json()) as {
      tasks: Array<{ id: string }>;
      truncated: boolean;
    };
    expect(listed.tasks.map((item) => item.id)).toContain(task.id);
    expect(listed.truncated).toBe(false);

    const closed = await fetchWorker(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: task.version, status: "done" }),
    });
    expect(closed.status).toBe(200);
    await expect(closed.json()).resolves.toMatchObject({
      task: { status: "done", version: task.version + 1 },
    });

    const conflict = await fetchWorker(`/api/tasks/${task.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: task.version, status: "open" }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "TASK_VERSION_CONFLICT" },
    });

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs
        WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toEqual({
      action: "task.create",
      resource_id: task.id,
      result: "allowed",
    });
  });

  it("falla cerrado ante entrada inválida, sesión ausente y referencia ajena", async () => {
    await expect(
      fetchWorker("/api/tasks").then((r) => r.status),
    ).resolves.toBe(401);

    const noTitle = await fetchWorker("/api/tasks", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "   " }),
    });
    expect(noTitle.status).toBe(400);

    const badDueAt = await fetchWorker("/api/tasks", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ title: "Con fecha rara", dueAt: "el jueves" }),
    });
    expect(badDueAt.status).toBe(400);

    await expect(
      fetchWorker("/api/tasks?status=inventado", {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(400);

    await expect(
      fetchWorker(`/api/tasks/${crypto.randomUUID()}`, {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(404);

    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Ajena otra vez" },
    );
    const foreignSubject = await fetchWorker("/api/tasks", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        title: "Tarea con sujeto ajeno",
        subject: { type: "contact", id: foreignContact.id },
      }),
    });
    expect(foreignSubject.status).toBe(404);
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
      .bind(legacyId, `legacy-${legacyId}`, now, now)
      .run();
    await env.DB.batch(
      Object.entries(roleIds).map(([roleKey, roleId]) =>
        env.DB.prepare(
          `INSERT INTO roles (id, organization_id, role_key, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(roleId, legacyId, roleKey, roleKey, now, now),
      ),
    );
    // Estado previo al corte: la organización tiene todo menos los permisos
    // que este corte introduce.
    await env.DB.batch(
      Object.values(roleIds).map((roleId) =>
        env.DB.prepare(
          `INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
           SELECT ?, ?, p.id, ?
             FROM permissions p
            WHERE p.permission_key NOT LIKE 'tasks.%'`,
        ).bind(legacyId, roleId, now),
      ),
    );

    // Solo las sentencias de catálogo: reaplicar el DDL fallaría porque las
    // tablas ya existen, y la propagación es lo que se verifica.
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
      .TEST_MIGRATIONS;
    const migration = migrations.find((item) => item.name === "0016_tasks.sql");
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
          WHERE rp.organization_id = ? AND p.permission_key LIKE 'tasks.%'
          ORDER BY r.role_key, p.permission_key`,
      )
        .bind(scope)
        .all<{ role_key: string; permission_key: string }>();
      return results.map((row) => `${row.role_key}:${row.permission_key}`);
    };

    expect(await catalog(legacyId)).toEqual(await catalog(organizationId));
    expect(await catalog(legacyId)).toEqual([
      "manager:tasks.manage",
      "manager:tasks.read",
      "operator:tasks.manage",
      "operator:tasks.read",
      "owner:tasks.manage",
      "owner:tasks.read",
    ]);
  });

  it("audita el rechazo sin permiso de gestión y conserva la lectura", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'tasks.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();

    const response = await fetchWorker("/api/tasks", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ title: "No debería crearse" }),
    });
    expect(response.status).toBe(403);

    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; result: string }>();
    expect(audit).toEqual({ action: "task.create", result: "rejected" });

    const listed = await fetchWorker("/api/tasks", {
      headers: { cookie: sessionCookie },
    });
    expect(listed.status).toBe(200);
  });

  it("rechaza la consulta sin el permiso de tareas", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'tasks.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker("/api/tasks", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
