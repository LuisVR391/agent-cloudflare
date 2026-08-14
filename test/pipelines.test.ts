import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  LastPipelineStageError,
  StageOrderMismatchError,
} from "../src/worker/domain/errors";
import {
  initialPipelineTemplate,
  PipelineRepository,
} from "../src/worker/repositories/pipeline-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Pipeline",
  organizationSlug: "salon-pipeline",
  ownerName: "Paula Pipeline",
  ownerEmail: "owner-pipeline@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "77777777-7777-4777-8777-777777777777";

describe.sequential("pipeline comercial", () => {
  let sessionCookie: string;
  let organizationId: string;
  let pipelineId: string;

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
       VALUES (?, 'otro-salon-pipeline', 'Otro salón', 'active', ?, ?)`,
    )
      .bind(otherOrganizationId, now, now)
      .run();

    const [pipeline] = await new PipelineRepository(env.DB).list(organizationId);
    pipelineId = pipeline.id;
  });

  it("siembra el pipeline inicial durante la instalación", async () => {
    const repository = new PipelineRepository(env.DB);
    const pipelines = await repository.list(organizationId);

    expect(pipelines).toHaveLength(1);
    expect(pipelines[0]).toMatchObject({
      name: initialPipelineTemplate.name,
      templateKey: initialPipelineTemplate.key,
      version: 1,
    });
    expect(pipelines[0].stages.map((stage) => stage.name)).toEqual(
      initialPipelineTemplate.stages.map((stage) => stage.name),
    );
    expect(pipelines[0].stages.map((stage) => stage.position)).toEqual([
      1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12,
    ]);
    expect(pipelines[0].stages.at(-1)).toMatchObject({
      name: "Oportunidad perdida",
      color: "danger",
    });
  });

  it("no duplica la siembra al repetirla", async () => {
    const repository = new PipelineRepository(env.DB);
    await repository.seedInitial(organizationId);
    await repository.seedInitial(organizationId);

    const pipelines = await repository.list(organizationId);
    expect(pipelines).toHaveLength(1);
    expect(pipelines[0].stages).toHaveLength(
      initialPipelineTemplate.stages.length,
    );
  });

  it("produce el mismo pipeline en una organización instalada y en una migrada", async () => {
    const now = new Date().toISOString();
    const legacyId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
       VALUES (?, ?, 'Salón heredado', 'active', ?, ?)`,
    )
      .bind(legacyId, `legacy-pipeline-${legacyId}`, now, now)
      .run();

    // Solo las sentencias de siembra y catálogo: reaplicar el DDL fallaría
    // porque las tablas ya existen, y la propagación es lo que se verifica.
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
      .TEST_MIGRATIONS;
    const migration = migrations.find(
      (item) => item.name === "0013_pipelines_and_stages.sql",
    );
    expect(migration).toBeDefined();
    const seeds = migration!.queries.filter((query) =>
      /INSERT INTO (pipelines|pipeline_stages)/i.test(query),
    );
    // El pipeline y una sentencia por etapa: SQLite no admite las doce en un
    // solo `UNION ALL`.
    expect(seeds).toHaveLength(1 + initialPipelineTemplate.stages.length);
    for (const query of seeds) {
      await env.DB.prepare(query).run();
    }

    const repository = new PipelineRepository(env.DB);
    const [migrated] = await repository.list(legacyId);
    const [installed] = await repository.list(organizationId);

    const shape = (pipeline: typeof migrated) => ({
      name: pipeline.name,
      templateKey: pipeline.templateKey,
      stages: pipeline.stages.map((stage) => ({
        name: stage.name,
        position: stage.position,
        color: stage.color,
      })),
    });

    expect(shape(migrated)).toEqual(shape(installed));
    // La migración tampoco duplica lo que la instalación ya sembró.
    expect((await repository.list(organizationId))[0].stages).toHaveLength(
      initialPipelineTemplate.stages.length,
    );
  });

  it("agrega, renombra y reordena etapas bajo la versión del pipeline", async () => {
    const repository = new PipelineRepository(env.DB);
    const before = await repository.find(organizationId, pipelineId);

    const added = await repository.addStage(organizationId, pipelineId, {
      expectedVersion: before!.version,
      name: "Presupuesto enviado",
      color: "warning",
    });
    expect(added!.version).toBe(before!.version + 1);
    expect(added!.stages.at(-1)).toMatchObject({
      name: "Presupuesto enviado",
      position: before!.stages.length + 1,
      color: "warning",
    });

    const stageId = added!.stages.at(-1)!.id;
    const renamed = await repository.updateStage(
      organizationId,
      pipelineId,
      stageId,
      { expectedVersion: added!.version, name: "Cotización enviada" },
    );
    expect(renamed!.stages.at(-1)).toMatchObject({
      name: "Cotización enviada",
      // El color ausente se conserva.
      color: "warning",
    });

    // Mover la etapa nueva al principio reasigna todas las posiciones.
    const order = [stageId, ...renamed!.stages
      .filter((stage) => stage.id !== stageId)
      .map((stage) => stage.id)];
    const reordered = await repository.reorderStages(organizationId, pipelineId, {
      expectedVersion: renamed!.version,
      stageIds: order,
    });
    expect(reordered!.stages.map((stage) => stage.id)).toEqual(order);
    expect(reordered!.stages.map((stage) => stage.position)).toEqual(
      order.map((_, index) => index + 1),
    );

    // Una versión vencida no aplica nada.
    await expect(
      repository.addStage(organizationId, pipelineId, {
        expectedVersion: before!.version,
        name: "Tardía",
      }),
    ).resolves.toBeNull();
    const unchanged = await repository.find(organizationId, pipelineId);
    expect(unchanged!.stages.map((stage) => stage.name)).not.toContain("Tardía");
  });

  it("rechaza un orden que no enumera exactamente las etapas vigentes", async () => {
    const repository = new PipelineRepository(env.DB);
    const pipeline = await repository.find(organizationId, pipelineId);

    await expect(
      repository.reorderStages(organizationId, pipelineId, {
        expectedVersion: pipeline!.version,
        stageIds: pipeline!.stages.slice(0, 3).map((stage) => stage.id),
      }),
    ).rejects.toBeInstanceOf(StageOrderMismatchError);

    await expect(
      repository.reorderStages(organizationId, pipelineId, {
        expectedVersion: pipeline!.version,
        stageIds: [
          ...pipeline!.stages.map((stage) => stage.id).slice(1),
          crypto.randomUUID(),
        ],
      }),
    ).rejects.toBeInstanceOf(StageOrderMismatchError);

    const intact = await repository.find(organizationId, pipelineId);
    expect(intact!.version).toBe(pipeline!.version);
    expect(intact!.stages.map((stage) => stage.id)).toEqual(
      pipeline!.stages.map((stage) => stage.id),
    );
  });

  it("borra una etapa compactando posiciones y conserva la última", async () => {
    const repository = new PipelineRepository(env.DB);
    const pipeline = await repository.find(organizationId, pipelineId);
    const target = pipeline!.stages[1];

    const afterRemoval = await repository.removeStage(
      organizationId,
      pipelineId,
      target.id,
      pipeline!.version,
    );
    expect(afterRemoval!.stages.map((stage) => stage.id)).not.toContain(target.id);
    expect(afterRemoval!.stages.map((stage) => stage.position)).toEqual(
      afterRemoval!.stages.map((_, index) => index + 1),
    );

    // Un pipeline propio, reducido a una sola etapa, no se queda sin ninguna.
    const solo = await repository.seedInitial(otherOrganizationId);
    let current = solo;
    for (const stage of solo.stages.slice(1)) {
      current = (await repository.removeStage(
        otherOrganizationId,
        solo.id,
        stage.id,
        current.version,
      ))!;
    }
    expect(current.stages).toHaveLength(1);
    await expect(
      repository.removeStage(
        otherOrganizationId,
        solo.id,
        current.stages[0].id,
        current.version,
      ),
    ).rejects.toBeInstanceOf(LastPipelineStageError);
  });

  it("no expone ni modifica el pipeline de otra organización", async () => {
    const repository = new PipelineRepository(env.DB);
    const [foreign] = await repository.list(otherOrganizationId);

    await expect(
      repository.find(organizationId, foreign.id),
    ).resolves.toBeNull();
    await expect(
      repository.rename(organizationId, foreign.id, {
        expectedVersion: foreign.version,
        name: "Intento",
      }),
    ).resolves.toBeNull();
    await expect(
      repository.addStage(organizationId, foreign.id, {
        expectedVersion: foreign.version,
        name: "Etapa ajena",
      }),
    ).resolves.toBeNull();

    const visible = await repository.list(organizationId);
    expect(visible.map((item) => item.id)).not.toContain(foreign.id);
  });

  it("expone el pipeline por API y audita la configuración", async () => {
    const list = await fetchWorker("/api/pipelines", {
      headers: { cookie: sessionCookie },
    });
    expect(list.status).toBe(200);
    const { pipelines } = (await list.json()) as {
      pipelines: Array<{ id: string; version: number; stages: unknown[] }>;
    };
    expect(pipelines).toHaveLength(1);
    const version = pipelines[0].version;

    const created = await fetchWorker(`/api/pipelines/${pipelineId}/stages`, {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: version, name: "Reactivación" }),
    });
    expect(created.status).toBe(201);
    const { pipeline } = (await created.json()) as {
      pipeline: { version: number; stages: Array<{ id: string; name: string }> };
    };
    expect(pipeline.stages.at(-1)!.name).toBe("Reactivación");

    const conflict = await fetchWorker(`/api/pipelines/${pipelineId}/stages`, {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: version, name: "Tardía" }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "PIPELINE_VERSION_CONFLICT" },
    });

    const reorder = await fetchWorker(
      `/api/pipelines/${pipelineId}/stages/order`,
      {
        method: "PATCH",
        headers: { cookie: sessionCookie, "Content-Type": "application/json" },
        body: JSON.stringify({
          expectedVersion: pipeline.version,
          stageIds: pipeline.stages.map((stage) => stage.id).slice(0, -1),
        }),
      },
    );
    expect(reorder.status).toBe(400);
    await expect(reorder.json()).resolves.toMatchObject({
      error: { code: "INVALID_STAGE_ORDER" },
    });

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs
        WHERE organization_id = ? AND action = 'pipeline.stage.create'`,
    )
      .bind(organizationId)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toMatchObject({ resource_id: pipelineId, result: "allowed" });
  });

  it("falla cerrado ante otra organización, entrada inválida y sesión ausente", async () => {
    const [foreign] = await new PipelineRepository(env.DB).list(
      otherOrganizationId,
    );

    await expect(
      fetchWorker("/api/pipelines").then((response) => response.status),
    ).resolves.toBe(401);
    // Existe, pero en otra organización: la respuesta no lo distingue de un
    // identificador inexistente.
    await expect(
      fetchWorker(`/api/pipelines/${foreign.id}`, {
        headers: { cookie: sessionCookie },
      }).then((response) => response.status),
    ).resolves.toBe(404);

    const invalid = await fetchWorker(`/api/pipelines/${pipelineId}/stages`, {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ expectedVersion: 1, name: "", color: "morado" }),
    });
    expect(invalid.status).toBe(400);

    const unknownStage = await fetchWorker(
      `/api/pipelines/${pipelineId}/stages/${crypto.randomUUID()}`,
      {
        method: "PATCH",
        headers: { cookie: sessionCookie, "Content-Type": "application/json" },
        body: JSON.stringify({ expectedVersion: 1, name: "Fantasma" }),
      },
    );
    expect(unknownStage.status).toBe(404);
  });

  it("audita el rechazo de la configuración sin permiso de gestión", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'pipelines.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();

    const response = await fetchWorker(`/api/pipelines/${pipelineId}/stages`, {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ expectedVersion: 1, name: "Sin permiso" }),
    });

    // El resultado auditado debe pertenecer al dominio del `CHECK`; uno fuera
    // de él convertiría este 403 en un 500.
    expect(response.status).toBe(403);
    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; result: string }>();
    expect(audit).toEqual({
      action: "pipeline.stage.create",
      result: "rejected",
    });

    // Leer sigue permitido: quien atiende necesita ver en qué etapa está todo.
    const list = await fetchWorker("/api/pipelines", {
      headers: { cookie: sessionCookie },
    });
    expect(list.status).toBe(200);
  });

  it("rechaza la consulta sin el permiso de pipelines", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'pipelines.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker("/api/pipelines", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
