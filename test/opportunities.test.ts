import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  ContactNotInOrganizationError,
  ServiceNotInOrganizationError,
  StageNotInPipelineError,
} from "../src/worker/domain/errors";
import { ContactRepository } from "../src/worker/repositories/contact-repository";
import { OpportunityRepository } from "../src/worker/repositories/opportunity-repository";
import { PipelineRepository } from "../src/worker/repositories/pipeline-repository";
import { ServiceRepository } from "../src/worker/repositories/service-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Oportunidades",
  organizationSlug: "salon-oportunidades",
  ownerName: "Olivia Oportunidad",
  ownerEmail: "owner-opportunities@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "66666666-6666-4666-8666-666666666666";

describe.sequential("oportunidades del pipeline", () => {
  let sessionCookie: string;
  let organizationId: string;
  let pipelineId: string;
  let stages: Array<{ id: string; name: string }>;
  let contactId: string;
  let serviceId: string;

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
       VALUES (?, 'otro-salon-oportunidades', 'Otro salón', 'active', ?, ?)`,
    )
      .bind(otherOrganizationId, now, now)
      .run();

    const [pipeline] = await new PipelineRepository(env.DB).list(organizationId);
    pipelineId = pipeline.id;
    stages = pipeline.stages.map((stage) => ({ id: stage.id, name: stage.name }));

    const contact = await new ContactRepository(env.DB).create(organizationId, {
      displayName: "Lucía Cliente",
    });
    contactId = contact.id;

    const service = await new ServiceRepository(env.DB).create(organizationId, {
      name: "Corte y peinado",
      durationMinutes: 60,
    });
    serviceId = service.id;
  });

  it("nace en la primera etapa y registra su transición inicial", async () => {
    const repository = new OpportunityRepository(env.DB);
    const opportunity = await repository.create(organizationId, {
      contactId,
      serviceId,
      actorId: "staff-1",
      correlationId: "corr-create",
    });

    expect(opportunity).toMatchObject({
      contactId,
      contactDisplayName: "Lucía Cliente",
      pipelineId,
      stageId: stages[0].id,
      stageName: stages[0].name,
      serviceId,
      serviceName: "Corte y peinado",
      version: 1,
    });
    expect(opportunity.transitions).toHaveLength(1);
    expect(opportunity.transitions[0]).toMatchObject({
      previousStageId: null,
      nextStageId: stages[0].id,
      actorId: "staff-1",
      correlationId: "corr-create",
    });
  });

  it("mueve de etapa conservando quién la movió y desde dónde", async () => {
    const repository = new OpportunityRepository(env.DB);
    const created = await repository.create(organizationId, {
      contactId,
      actorId: "staff-1",
      correlationId: "corr-1",
    });

    const moved = await repository.update(organizationId, created.id, {
      expectedVersion: created.version,
      stageId: stages[2].id,
      actorId: "staff-2",
      correlationId: "corr-2",
    });

    expect(moved).toMatchObject({
      stageId: stages[2].id,
      stageName: stages[2].name,
      version: created.version + 1,
    });
    expect(moved!.transitions[0]).toMatchObject({
      previousStageId: stages[0].id,
      previousStageName: stages[0].name,
      nextStageId: stages[2].id,
      actorId: "staff-2",
      correlationId: "corr-2",
    });
    expect(moved!.transitions).toHaveLength(2);

    // Mover la misma oportunidad dos veces con la misma versión falla.
    await expect(
      repository.update(organizationId, created.id, {
        expectedVersion: created.version,
        stageId: stages[1].id,
        actorId: "staff-3",
        correlationId: "corr-3",
      }),
    ).resolves.toBeNull();
    const unchanged = await repository.find(organizationId, created.id);
    expect(unchanged!.stageId).toBe(stages[2].id);
  });

  it("cambiar solo el servicio no inventa una transición", async () => {
    const repository = new OpportunityRepository(env.DB);
    const created = await repository.create(organizationId, {
      contactId,
      actorId: "staff-1",
      correlationId: "corr-service",
    });

    const updated = await repository.update(organizationId, created.id, {
      expectedVersion: created.version,
      serviceId,
      actorId: "staff-1",
      correlationId: "corr-service-2",
    });

    expect(updated).toMatchObject({ serviceId, stageId: created.stageId });
    expect(updated!.transitions).toHaveLength(1);

    // `null` desvincula el servicio sin tocar la etapa.
    const cleared = await repository.update(organizationId, created.id, {
      expectedVersion: updated!.version,
      serviceId: null,
      actorId: "staff-1",
      correlationId: "corr-service-3",
    });
    expect(cleared).toMatchObject({ serviceId: null, serviceName: null });
  });

  it("rechaza una etapa que pertenece a otro pipeline u organización", async () => {
    const pipelineRepository = new PipelineRepository(env.DB);
    const repository = new OpportunityRepository(env.DB);
    const created = await repository.create(organizationId, {
      contactId,
      actorId: "staff-1",
      correlationId: "corr-1",
    });

    // Un pipeline propio pero distinto: la clave foránea lo aceptaría, porque
    // la etapa sí es de esta organización.
    const now = new Date().toISOString();
    const secondPipelineId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pipelines (id, organization_id, name, created_at, updated_at)
       VALUES (?, ?, 'Pipeline paralelo', ?, ?)`,
    )
      .bind(secondPipelineId, organizationId, now, now)
      .run();
    const foreignStageId = crypto.randomUUID();
    await env.DB.prepare(
      `INSERT INTO pipeline_stages
         (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
       VALUES (?, ?, ?, 'Etapa paralela', 1, 'neutral', ?, ?)`,
    )
      .bind(foreignStageId, organizationId, secondPipelineId, now, now)
      .run();

    await expect(
      repository.update(organizationId, created.id, {
        expectedVersion: created.version,
        stageId: foreignStageId,
        actorId: "staff-1",
        correlationId: "corr-4",
      }),
    ).rejects.toBeInstanceOf(StageNotInPipelineError);

    // Y una etapa de otra organización tampoco entra.
    const foreignPipeline = await pipelineRepository.seedInitial(
      otherOrganizationId,
    );
    await expect(
      repository.update(organizationId, created.id, {
        expectedVersion: created.version,
        stageId: foreignPipeline.stages[0].id,
        actorId: "staff-1",
        correlationId: "corr-5",
      }),
    ).rejects.toBeInstanceOf(StageNotInPipelineError);

    const intact = await repository.find(organizationId, created.id);
    expect(intact!.stageId).toBe(stages[0].id);
    expect(intact!.version).toBe(created.version);
  });

  it("rechaza contacto o servicio de otra organización", async () => {
    const repository = new OpportunityRepository(env.DB);
    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Ajeno" },
    );
    const foreignService = await new ServiceRepository(env.DB).create(
      otherOrganizationId,
      { name: "Servicio ajeno", durationMinutes: 30 },
    );

    await expect(
      repository.create(organizationId, {
        contactId: foreignContact.id,
        actorId: "staff-1",
        correlationId: "corr-6",
      }),
    ).rejects.toBeInstanceOf(ContactNotInOrganizationError);

    await expect(
      repository.create(organizationId, {
        contactId,
        serviceId: foreignService.id,
        actorId: "staff-1",
        correlationId: "corr-7",
      }),
    ).rejects.toBeInstanceOf(ServiceNotInOrganizationError);

    const { results } = await env.DB.prepare(
      `SELECT id FROM opportunities WHERE organization_id = ? AND contact_id = ?`,
    )
      .bind(organizationId, foreignContact.id)
      .all<{ id: string }>();
    expect(results).toEqual([]);
  });

  it("no expone ni mueve la oportunidad de otra organización", async () => {
    const repository = new OpportunityRepository(env.DB);
    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Cliente ajeno" },
    );
    const foreign = await repository.create(otherOrganizationId, {
      contactId: foreignContact.id,
      actorId: "staff-x",
      correlationId: "corr-foreign",
    });

    await expect(repository.find(organizationId, foreign.id)).resolves.toBeNull();
    await expect(
      repository.update(organizationId, foreign.id, {
        expectedVersion: foreign.version,
        stageId: stages[1].id,
        actorId: "staff-1",
        correlationId: "corr-8",
      }),
    ).resolves.toBeNull();

    const visible = await repository.listByPipeline(organizationId, pipelineId);
    expect(visible.map((item) => item.id)).not.toContain(foreign.id);
  });

  it("crea y mueve por API dejando constancia en la auditoría", async () => {
    const created = await fetchWorker("/api/opportunities", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ contactId, serviceId }),
    });
    expect(created.status).toBe(201);
    const { opportunity } = (await created.json()) as {
      opportunity: { id: string; version: number; stageId: string };
    };

    const moved = await fetchWorker(`/api/opportunities/${opportunity.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: opportunity.version,
        stageId: stages[4].id,
      }),
    });
    expect(moved.status).toBe(200);
    await expect(moved.json()).resolves.toMatchObject({
      opportunity: { stageId: stages[4].id, version: opportunity.version + 1 },
    });

    const conflict = await fetchWorker(`/api/opportunities/${opportunity.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: opportunity.version,
        stageId: stages[3].id,
      }),
    });
    expect(conflict.status).toBe(409);
    await expect(conflict.json()).resolves.toMatchObject({
      error: { code: "OPPORTUNITY_VERSION_CONFLICT" },
    });

    const board = await fetchWorker(
      `/api/opportunities?pipelineId=${pipelineId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(board.status).toBe(200);
    const listed = (await board.json()) as {
      opportunities: Array<{ id: string }>;
      truncated: boolean;
    };
    expect(listed.opportunities.map((item) => item.id)).toContain(opportunity.id);
    expect(listed.truncated).toBe(false);

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs
        WHERE organization_id = ? AND action = 'opportunity.update'
          AND resource_id = ?`,
    )
      .bind(organizationId, opportunity.id)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toMatchObject({ resource_id: opportunity.id, result: "allowed" });
  });

  it("falla cerrado ante entrada inválida, otra organización y sesión ausente", async () => {
    await expect(
      fetchWorker("/api/opportunities?pipelineId=x").then((r) => r.status),
    ).resolves.toBe(401);
    await expect(
      fetchWorker("/api/opportunities", {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(400);
    await expect(
      fetchWorker(`/api/opportunities/${crypto.randomUUID()}`, {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(404);

    const invalid = await fetchWorker("/api/opportunities", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: "" }),
    });
    expect(invalid.status).toBe(400);

    // Un contacto que existe en otra organización responde como inexistente.
    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Otro más" },
    );
    const foreign = await fetchWorker("/api/opportunities", {
      method: "POST",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ contactId: foreignContact.id }),
    });
    expect(foreign.status).toBe(404);
  });

  it("audita el rechazo sin permiso de gestión y conserva la lectura", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'opportunities.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();

    const response = await fetchWorker("/api/opportunities", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ contactId }),
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
      action: "opportunity.create",
      result: "rejected",
    });

    const board = await fetchWorker(
      `/api/opportunities?pipelineId=${pipelineId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(board.status).toBe(200);
  });

  it("rechaza la consulta sin el permiso de oportunidades", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'opportunities.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker(
      `/api/opportunities?pipelineId=${pipelineId}`,
      { headers: { cookie: sessionCookie } },
    );
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
