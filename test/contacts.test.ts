import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { ContactRepository } from "../src/worker/repositories/contact-repository";
import { ContactNotInOrganizationError } from "../src/worker/domain/errors";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Contactos",
  organizationSlug: "salon-contactos",
  ownerName: "Carla Contacto",
  ownerEmail: "owner-contacts@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "99999999-9999-4999-8999-999999999999";

describe.sequential("contactos del CRM", () => {
  let sessionCookie: string;
  let organizationId: string;

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

    const now = new Date().toISOString();
    await env.DB.prepare(
      `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
       VALUES (?, 'otro-salon-contactos', 'Otro salón', 'active', ?, ?)`,
    )
      .bind(otherOrganizationId, now, now)
      .run();
  });

  it("crea la ficha con teléfono y la encuentra por búsqueda", async () => {
    const repository = new ContactRepository(env.DB);
    const contact = await repository.create(organizationId, {
      displayName: "María Gómez",
      phoneNumber: "+52 55 1234 5678",
    });

    const byName = await repository.search(organizationId, { query: "maría", limit: 30 });
    expect(byName.contacts.map((item) => item.id)).toContain(contact.id);

    const byPhone = await repository.search(organizationId, { query: "1234", limit: 30 });
    expect(byPhone.contacts.map((item) => item.id)).toContain(contact.id);

    const miss = await repository.search(organizationId, { query: "inexistente", limit: 30 });
    expect(miss.contacts).toEqual([]);
  });

  it("trata los comodines de la búsqueda como texto literal", async () => {
    const repository = new ContactRepository(env.DB);
    await repository.create(organizationId, { displayName: "Cliente sin comodín" });

    // Sin escapar, `%` devolvería la organización entera.
    const escaped = await repository.search(organizationId, { query: "%", limit: 30 });
    expect(escaped.contacts).toEqual([]);
  });

  it("no expone ni edita contactos de otra organización", async () => {
    const repository = new ContactRepository(env.DB);
    const foreign = await repository.create(otherOrganizationId, {
      displayName: "Contacto ajeno",
    });

    await expect(
      repository.findProfile(organizationId, foreign.id),
    ).resolves.toBeNull();
    await expect(
      repository.updateProfile(organizationId, foreign.id, {
        expectedVersion: 1,
        displayName: "Intento",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.assignTag(organizationId, {
        contactId: foreign.id,
        name: "VIP",
        assignedBy: "staff-1",
      }),
    ).rejects.toBeInstanceOf(ContactNotInOrganizationError);

    const search = await repository.search(organizationId, { query: "ajeno", limit: 30 });
    expect(search.contacts).toEqual([]);
  });

  it("rechaza una edición con versión vencida", async () => {
    const repository = new ContactRepository(env.DB);
    const contact = await repository.create(organizationId, { displayName: "Versionado" });

    const updated = await repository.updateProfile(organizationId, contact.id, {
      expectedVersion: contact.version,
      email: "versionado@example.com",
    });
    expect(updated?.version).toBe(contact.version + 1);
    // El correo cambió sin borrar el nombre: un campo ausente se conserva.
    expect(updated?.displayName).toBe("Versionado");

    await expect(
      repository.updateProfile(organizationId, contact.id, {
        expectedVersion: contact.version,
        email: "tarde@example.com",
      }),
    ).resolves.toBeNull();
  });

  it("reutiliza la etiqueta sin duplicarla y la quita", async () => {
    const repository = new ContactRepository(env.DB);
    const contact = await repository.create(organizationId, { displayName: "Etiquetado" });

    const first = await repository.assignTag(organizationId, {
      contactId: contact.id,
      name: "VIP",
      assignedBy: "staff-1",
    });
    const repeated = await repository.assignTag(organizationId, {
      contactId: contact.id,
      name: "  vip  ",
      assignedBy: "staff-1",
    });
    expect(repeated.id).toBe(first.id);

    const profile = await repository.findProfile(organizationId, contact.id);
    expect(profile?.tags).toHaveLength(1);

    await expect(
      repository.removeTag(organizationId, contact.id, first.id),
    ).resolves.toBe(true);
    await expect(
      repository.removeTag(organizationId, contact.id, first.id),
    ).resolves.toBe(false);
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
    await env.DB.prepare(
      `INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
       SELECT ?, ?, p.id, ?
         FROM permissions p
        WHERE p.permission_key NOT LIKE 'contacts.%'`,
    )
      .bind(legacyId, roleIds.operator, now)
      .run();

    // Solo las sentencias de catálogo: reaplicar el DDL fallaría porque la
    // columna y las tablas ya existen, y la propagación es lo que se verifica.
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
      .TEST_MIGRATIONS;
    const migration = migrations.find(
      (item) => item.name === "0010_contacts_profile_and_tags.sql",
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
          WHERE rp.organization_id = ? AND p.permission_key LIKE 'contacts.%'
          ORDER BY r.role_key, p.permission_key`,
      )
        .bind(scope)
        .all<{ role_key: string; permission_key: string }>();
      return results.map((row) => `${row.role_key}:${row.permission_key}`);
    };

    expect(await catalog(legacyId)).toEqual(await catalog(organizationId));
    expect(await catalog(legacyId)).toEqual([
      "manager:contacts.manage",
      "manager:contacts.read",
      "operator:contacts.manage",
      "operator:contacts.read",
      "owner:contacts.manage",
      "owner:contacts.read",
    ]);
  });

  it("expone la ficha por API y audita la edición", async () => {
    const repository = new ContactRepository(env.DB);
    const contact = await repository.create(organizationId, { displayName: "Vía API" });

    const list = await fetchWorker("/api/contacts?query=API", {
      headers: { cookie: sessionCookie },
    });
    expect(list.status).toBe(200);
    await expect(list.json()).resolves.toMatchObject({
      contacts: [{ id: contact.id, displayName: "Vía API" }],
    });

    const updated = await fetchWorker(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, phoneNumber: "+52 55 0000 1111" }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      contact: { phoneNumber: "+52 55 0000 1111", version: 2 },
    });

    const conflict = await fetchWorker(`/api/contacts/${contact.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, email: "tarde@example.com" }),
    });
    expect(conflict.status).toBe(409);

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs
        WHERE organization_id = ? AND action = 'contact.profile.update'`,
    )
      .bind(organizationId)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toMatchObject({ resource_id: contact.id, result: "allowed" });
  });

  it("falla cerrado ante entrada inválida, otra organización y sesión ausente", async () => {
    const repository = new ContactRepository(env.DB);
    const foreign = await repository.create(otherOrganizationId, {
      displayName: "Fuera de alcance",
    });

    await expect(
      fetchWorker("/api/contacts").then((response) => response.status),
    ).resolves.toBe(401);
    await expect(
      fetchWorker("/api/contacts?cursor=sincorte", {
        headers: { cookie: sessionCookie },
      }).then((response) => response.status),
    ).resolves.toBe(400);
    await expect(
      fetchWorker("/api/contacts?limit=0", {
        headers: { cookie: sessionCookie },
      }).then((response) => response.status),
    ).resolves.toBe(400);
    // Existe, pero en otra organización: la respuesta no lo distingue de un
    // identificador inexistente.
    await expect(
      fetchWorker(`/api/contacts/${foreign.id}`, {
        headers: { cookie: sessionCookie },
      }).then((response) => response.status),
    ).resolves.toBe(404);

    const invalidPatch = await fetchWorker(
      `/api/contacts/${(await repository.create(organizationId, {})).id}`,
      {
        method: "PATCH",
        headers: { cookie: sessionCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, email: "no-es-correo" }),
      },
    );
    expect(invalidPatch.status).toBe(400);
  });

  it("rechaza la consulta sin el permiso de contactos", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (SELECT id FROM permissions WHERE permission_key = 'contacts.read')`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker("/api/contacts", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
