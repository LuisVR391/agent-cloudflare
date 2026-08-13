import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import { DuplicateServiceNameError } from "../src/worker/domain/errors";
import { ServiceRepository } from "../src/worker/repositories/service-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Servicios",
  organizationSlug: "salon-servicios",
  ownerName: "Sara Servicio",
  ownerEmail: "owner-services@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "88888888-8888-4888-8888-888888888888";

describe.sequential("catálogo de servicios", () => {
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
       VALUES (?, 'otro-salon-servicios', 'Otro salón', 'active', ?, ?)`,
    )
      .bind(otherOrganizationId, now, now)
      .run();
  });

  it("guarda duración y precio, y lista solo lo activo por defecto", async () => {
    const repository = new ServiceRepository(env.DB);
    const service = await repository.create(organizationId, {
      name: "Corte de dama",
      durationMinutes: 45,
      priceAmountCents: 35000,
      priceCurrency: "MXN",
    });
    expect(service).toMatchObject({
      durationMinutes: 45,
      priceAmountCents: 35000,
      priceCurrency: "MXN",
      status: "active",
      version: 1,
    });

    const archived = await repository.create(organizationId, {
      name: "Servicio retirado",
      durationMinutes: 30,
      status: "archived",
    });
    expect(archived.priceAmountCents).toBeNull();
    expect(archived.priceCurrency).toBeNull();

    const active = await repository.list(organizationId);
    expect(active.map((item) => item.id)).toContain(service.id);
    expect(active.map((item) => item.id)).not.toContain(archived.id);

    const all = await repository.list(organizationId, { status: "all" });
    expect(all.map((item) => item.id)).toContain(archived.id);
  });

  it("trata como el mismo servicio un nombre que solo cambia de mayúsculas", async () => {
    const repository = new ServiceRepository(env.DB);
    await repository.create(organizationId, {
      name: "Manicura express",
      durationMinutes: 30,
    });

    await expect(
      repository.create(organizationId, {
        name: "  MANICURA EXPRESS  ",
        durationMinutes: 40,
      }),
    ).rejects.toBeInstanceOf(DuplicateServiceNameError);
  });

  it("conserva los campos ausentes y rechaza una edición con versión vencida", async () => {
    const repository = new ServiceRepository(env.DB);
    const service = await repository.create(organizationId, {
      name: "Peinado de fiesta",
      durationMinutes: 60,
      priceAmountCents: 50000,
      priceCurrency: "MXN",
    });

    const updated = await repository.update(organizationId, service.id, {
      expectedVersion: service.version,
      durationMinutes: 75,
    });
    expect(updated).toMatchObject({
      name: "Peinado de fiesta",
      durationMinutes: 75,
      priceAmountCents: 50000,
      version: service.version + 1,
    });

    // `null` borra importe y moneda a la vez: uno sin el otro no significa nada.
    const withoutPrice = await repository.update(organizationId, service.id, {
      expectedVersion: updated!.version,
      price: null,
    });
    expect(withoutPrice).toMatchObject({
      priceAmountCents: null,
      priceCurrency: null,
    });

    await expect(
      repository.update(organizationId, service.id, {
        expectedVersion: service.version,
        durationMinutes: 90,
      }),
    ).resolves.toBeNull();
  });

  it("impide renombrar un servicio con el nombre de otro sin alterarlo", async () => {
    const repository = new ServiceRepository(env.DB);
    const first = await repository.create(organizationId, {
      name: "Tinte completo",
      durationMinutes: 120,
    });
    const second = await repository.create(organizationId, {
      name: "Tinte de raíz",
      durationMinutes: 60,
    });

    await expect(
      repository.update(organizationId, second.id, {
        expectedVersion: second.version,
        name: "tinte completo",
      }),
    ).rejects.toBeInstanceOf(DuplicateServiceNameError);

    const unchanged = await repository.findById(organizationId, second.id);
    expect(unchanged).toMatchObject({
      name: "Tinte de raíz",
      version: second.version,
    });
    expect(await repository.findById(organizationId, first.id)).toMatchObject({
      name: "Tinte completo",
    });
  });

  it("no expone ni edita servicios de otra organización", async () => {
    const repository = new ServiceRepository(env.DB);
    const foreign = await repository.create(otherOrganizationId, {
      name: "Servicio ajeno",
      durationMinutes: 30,
    });

    await expect(
      repository.findById(organizationId, foreign.id),
    ).resolves.toBeNull();
    await expect(
      repository.update(organizationId, foreign.id, {
        expectedVersion: 1,
        name: "Intento",
      }),
    ).resolves.toBeNull();

    const visible = await repository.list(organizationId, { status: "all" });
    expect(visible.map((item) => item.id)).not.toContain(foreign.id);

    // El mismo nombre puede existir en dos organizaciones: la unicidad se
    // define dentro de la organización, no globalmente (ADR-0006).
    await expect(
      repository.create(otherOrganizationId, {
        name: "Corte de dama",
        durationMinutes: 45,
      }),
    ).resolves.toMatchObject({ organizationId: otherOrganizationId });
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
      .bind(legacyId, `legacy-services-${legacyId}`, now, now)
      .run();
    await env.DB.batch(
      Object.entries(roleIds).map(([roleKey, roleId]) =>
        env.DB.prepare(
          `INSERT INTO roles (id, organization_id, role_key, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(roleId, legacyId, roleKey, roleKey, now, now),
      ),
    );
    // Estado previo al corte: cada rol conserva todo menos los permisos que
    // este corte introduce.
    await env.DB.batch(
      Object.values(roleIds).map((roleId) =>
        env.DB.prepare(
          `INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
           SELECT ?, ?, p.id, ?
             FROM permissions p
            WHERE p.permission_key NOT LIKE 'services.%'`,
        ).bind(legacyId, roleId, now),
      ),
    );

    // Solo las sentencias de catálogo: reaplicar el DDL fallaría porque la
    // tabla ya existe, y la propagación es lo que se verifica.
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
      .TEST_MIGRATIONS;
    const migration = migrations.find(
      (item) => item.name === "0012_service_catalog.sql",
    );
    expect(migration).toBeDefined();
    const grants = migration!.queries.filter((query) =>
      /INSERT INTO (permissions|role_permissions)/i.test(query),
    );
    expect(grants).toHaveLength(3);
    for (const query of grants) {
      await env.DB.prepare(query).run();
    }

    const catalog = async (scope: string) => {
      const { results } = await env.DB.prepare(
        `SELECT r.role_key, p.permission_key
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.organization_id = ? AND p.permission_key LIKE 'services.%'
          ORDER BY r.role_key, p.permission_key`,
      )
        .bind(scope)
        .all<{ role_key: string; permission_key: string }>();
      return results.map((row) => `${row.role_key}:${row.permission_key}`);
    };

    expect(await catalog(legacyId)).toEqual([
      "manager:services.manage",
      "manager:services.read",
      "operator:services.read",
      "owner:services.manage",
      "owner:services.read",
    ]);
    expect(await catalog(organizationId)).toEqual(await catalog(legacyId));
  });

  it("crea y edita por API dejando constancia en la auditoría", async () => {
    const created = await fetchWorker("/api/services", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        name: "Maquillaje social",
        durationMinutes: 50,
        price: { amountCents: 42000, currency: "mxn" },
      }),
    });
    expect(created.status).toBe(201);
    const { service } = (await created.json()) as {
      service: { id: string; priceCurrency: string; version: number };
    };
    // La moneda se normaliza a mayúsculas: el `CHECK` de D1 solo admite ASCII
    // en mayúsculas y el cliente no debería decidir el formato.
    expect(service.priceCurrency).toBe("MXN");

    const list = await fetchWorker("/api/services", {
      headers: { cookie: sessionCookie },
    });
    expect(list.status).toBe(200);
    const listed = (await list.json()) as { services: Array<{ id: string }> };
    expect(listed.services.map((item) => item.id)).toContain(service.id);

    const updated = await fetchWorker(`/api/services/${service.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: service.version, status: "archived" }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      service: { status: "archived", version: service.version + 1 },
    });

    const conflict = await fetchWorker(`/api/services/${service.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: service.version, status: "active" }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "SERVICE_VERSION_CONFLICT" },
    });

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs
        WHERE organization_id = ? AND action = 'service.create'
          AND resource_id = ?`,
    )
      .bind(organizationId, service.id)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toMatchObject({ resource_id: service.id, result: "allowed" });
  });

  it("falla cerrado ante entrada inválida, otra organización y sesión ausente", async () => {
    const repository = new ServiceRepository(env.DB);
    const foreign = await repository.create(otherOrganizationId, {
      name: "Fuera de alcance",
      durationMinutes: 30,
    });

    await expect(
      fetchWorker("/api/services").then((response) => response.status),
    ).resolves.toBe(401);
    // Existe, pero en otra organización: la respuesta no lo distingue de un
    // identificador inexistente.
    await expect(
      fetchWorker(`/api/services/${foreign.id}`, {
        headers: { cookie: sessionCookie },
      }).then((response) => response.status),
    ).resolves.toBe(404);
    await expect(
      fetchWorker("/api/services?status=cualquiera", {
        headers: { cookie: sessionCookie },
      }).then((response) => response.status),
    ).resolves.toBe(400);

    for (const body of [
      { name: "Sin duración", durationMinutes: 0 },
      { name: "Duración excesiva", durationMinutes: 2000 },
      { name: "", durationMinutes: 30 },
      {
        name: "Moneda inválida",
        durationMinutes: 30,
        price: { amountCents: 1000, currency: "pesos" },
      },
      {
        name: "Importe negativo",
        durationMinutes: 30,
        price: { amountCents: -1, currency: "MXN" },
      },
    ]) {
      const response = await fetchWorker("/api/services", {
        method: "POST",
        headers: { cookie: sessionCookie, "Content-Type": "application/json" },
        body: JSON.stringify(body),
      });
      expect(response.status).toBe(400);
    }

    const duplicated = await fetchWorker("/api/services", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ name: "corte de dama", durationMinutes: 45 }),
    });
    expect(duplicated.status).toBe(409);
    await expect(duplicated.json()).resolves.toMatchObject({
      error: { code: "SERVICE_NAME_TAKEN" },
    });
  });

  it("audita el rechazo de la edición sin permiso de gestión", async () => {
    const repository = new ServiceRepository(env.DB);
    const service = await repository.create(organizationId, {
      name: "Solo lectura",
      durationMinutes: 20,
    });
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'services.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();

    const response = await fetchWorker(`/api/services/${service.id}`, {
      method: "PATCH",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ expectedVersion: 1, durationMinutes: 25 }),
    });

    // El resultado auditado debe pertenecer al dominio del `CHECK`; uno fuera
    // de él convertiría este 403 en un 500.
    expect(response.status).toBe(403);
    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; result: string }>();
    expect(audit).toEqual({ action: "service.update", result: "rejected" });

    // Leer sigue permitido: quien atiende necesita saber qué ofrece la empresa.
    const list = await fetchWorker("/api/services", {
      headers: { cookie: sessionCookie },
    });
    expect(list.status).toBe(200);
  });

  it("rechaza la consulta sin el permiso de servicios", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'services.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker("/api/services", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
