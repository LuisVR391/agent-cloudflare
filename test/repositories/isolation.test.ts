import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ContactNotInOrganizationError,
  MissingOrganizationScopeError,
} from "../../src/worker/domain/errors";
import type { Organization } from "../../src/worker/domain/types";
import { createRepositories } from "../../src/worker/repositories";

const { organizations, contacts, services, pipelines, metrics, agents } =
  createRepositories(env.DB);

let salon: Organization;
let barberia: Organization;
const memberships = new Map<string, string>();

/**
 * Un agente conserva quién lo creó, así que cada organización necesita una
 * membresía real: la clave foránea compuesta rechazaría una de la otra.
 */
async function seedMembership(organizationId: string): Promise<string> {
  const now = new Date().toISOString();
  const userId = crypto.randomUUID();
  const membershipId = crypto.randomUUID();
  await env.DB.prepare(
    `INSERT INTO users (id, name, email, email_verified, status, created_at, updated_at)
     VALUES (?, 'Titular', ?, 0, 'active', ?, ?)`,
  )
    .bind(userId, `${userId}@example.com`, now, now)
    .run();
  await env.DB.prepare(
    `INSERT INTO memberships (id, organization_id, user_id, status, created_at, updated_at)
     VALUES (?, ?, ?, 'active', ?, ?)`,
  )
    .bind(membershipId, organizationId, userId, now, now)
    .run();
  memberships.set(organizationId, membershipId);
  return membershipId;
}

beforeEach(async () => {
  salon = await organizations.create({
    slug: `salon-${crypto.randomUUID()}`,
    displayName: "Salón Aurora",
  });
  barberia = await organizations.create({
    slug: `barberia-${crypto.randomUUID()}`,
    displayName: "Barbería Norte",
  });
  await seedMembership(salon.id);
  await seedMembership(barberia.id);
});

describe("aislamiento por organización", () => {
  it("no lista contactos de otra organización", async () => {
    const propio = await contacts.create(salon.id, { displayName: "Ana" });
    await contacts.create(barberia.id, { displayName: "Luis" });

    const listados = await contacts.listByOrganization(salon.id);

    expect(listados.map((contacto) => contacto.id)).toEqual([propio.id]);
  });

  it("no resuelve por id un contacto de otra organización", async () => {
    const ajeno = await contacts.create(barberia.id, { displayName: "Luis" });

    await expect(contacts.findById(salon.id, ajeno.id)).resolves.toBeNull();
    await expect(contacts.findById(barberia.id, ajeno.id)).resolves.toMatchObject(
      { id: ajeno.id, organizationId: barberia.id },
    );
  });

  it("no resuelve por identidad externa un contacto de otra organización", async () => {
    const ajeno = await contacts.create(barberia.id, { displayName: "Luis" });
    await contacts.linkIdentity(barberia.id, {
      contactId: ajeno.id,
      provider: "whatsapp",
      externalId: "5215550001111",
    });

    await expect(
      contacts.findByExternalIdentity(salon.id, "whatsapp", "5215550001111"),
    ).resolves.toBeNull();
  });

  it("no lista servicios de otra organización", async () => {
    const propio = await services.create(salon.id, {
      name: "Corte",
      durationMinutes: 30,
    });
    await services.create(barberia.id, { name: "Corte", durationMinutes: 30 });

    const listados = await services.list(salon.id, { status: "all" });

    expect(listados.map((servicio) => servicio.id)).toEqual([propio.id]);
  });

  it("no expone el pipeline de otra organización", async () => {
    const propio = await pipelines.seedInitial(salon.id);
    await pipelines.seedInitial(barberia.id);

    const listados = await pipelines.list(salon.id);

    expect(listados.map((pipeline) => pipeline.id)).toEqual([propio.id]);
    // Cada organización recibe su propia copia editable de la plantilla.
    expect(listados[0].stages).toHaveLength(propio.stages.length);
  });

  it("no lista agentes de otra organización", async () => {
    const propio = await agents.create(salon.id, {
      name: "Recepción",
      createdByMembershipId: memberships.get(salon.id)!,
    });
    await agents.create(barberia.id, {
      name: "Recepción",
      createdByMembershipId: memberships.get(barberia.id)!,
    });

    const listados = await agents.list(salon.id, { status: "all" });

    expect(listados.map((agente) => agente.id)).toEqual([propio.id]);
  });

  it("no resuelve un agente ni su detalle desde otra organización", async () => {
    const ajeno = await agents.create(barberia.id, {
      name: "Recepción",
      createdByMembershipId: memberships.get(barberia.id)!,
    });

    await expect(agents.find(salon.id, ajeno.id)).resolves.toBeNull();
    await expect(agents.findDetail(salon.id, ajeno.id)).resolves.toBeNull();
    await expect(agents.find(barberia.id, ajeno.id)).resolves.toMatchObject({
      id: ajeno.id,
      organizationId: barberia.id,
    });
  });

  it("no alcanza desde otra organización la revisión de un agente ajeno", async () => {
    const ajeno = await agents.create(barberia.id, {
      name: "Recepción",
      createdByMembershipId: memberships.get(barberia.id)!,
    });
    const detalle = await agents.createVersion(barberia.id, ajeno.id, {
      expectedVersion: ajeno.version,
      content: { instructions: "Secreto", model: "modelo-previsto" },
      fromVersionId: null,
      createdByMembershipId: memberships.get(barberia.id)!,
    });
    const versionId = detalle!.versions[0].id;

    await expect(
      agents.findVersion(salon.id, ajeno.id, versionId),
    ).resolves.toBeNull();
  });

  it("falla de forma cerrada cuando no hay organización", async () => {
    await expect(contacts.listByOrganization("")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(contacts.create("   ")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(
      contacts.findByExternalIdentity("", "whatsapp", "5215550001111"),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(services.list("")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(
      services.create("   ", { name: "Corte", durationMinutes: 30 }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(pipelines.list("")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(pipelines.seedInitial("  ")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(
      metrics.summary("", {
        from: "2026-08-01T06:00:00.000Z",
        to: "2026-09-01T06:00:00.000Z",
      }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(agents.list("")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(agents.find("  ", "agente")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(agents.findDetail("", "agente")).rejects.toBeInstanceOf(
      MissingOrganizationScopeError,
    );
    await expect(
      agents.create("  ", { name: "Recepción", createdByMembershipId: "x" }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(
      agents.update("", "agente", { expectedVersion: 1, name: "Otro" }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(
      agents.createVersion("  ", "agente", {
        expectedVersion: 1,
        content: { instructions: "Hola", model: "modelo" },
        fromVersionId: null,
        createdByMembershipId: "x",
      }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(
      agents.updateVersion("", "agente", "version", {
        expectedVersion: 1,
        instructions: "Hola",
        model: "modelo",
      }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(
      agents.setPublication("  ", "agente", {
        expectedVersion: 1,
        versionId: null,
        reason: "Motivo",
        actorId: "actor",
        correlationId: "correlación",
      }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(
      agents.findVersion("", "agente", "version"),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
    await expect(
      agents.recordAudit({
        organizationId: "",
        actorId: "actor",
        resource: { type: "agent", id: null },
        action: "agent.create",
        result: "rejected",
        correlationId: "correlación",
      }),
    ).rejects.toBeInstanceOf(MissingOrganizationScopeError);
  });

  it("no cuenta en una organización los contactos de la otra", async () => {
    await contacts.create(salon.id, { displayName: "Ana" });
    await contacts.create(barberia.id, { displayName: "Luis" });
    await contacts.create(barberia.id, { displayName: "Marta" });

    // Ventana amplia alrededor del instante de creación: lo que se verifica es
    // el filtro por organización, no la frontera del día.
    const window = { from: "2000-01-01T00:00:00.000Z", to: "2100-01-01T00:00:00.000Z" };

    await expect(metrics.summary(salon.id, window)).resolves.toMatchObject({
      commercial: { newContacts: 1 },
    });
    await expect(metrics.summary(barberia.id, window)).resolves.toMatchObject({
      commercial: { newContacts: 2 },
    });
  });
});

describe("identidades externas", () => {
  it("permite el mismo identificador externo en organizaciones distintas", async () => {
    const enSalon = await contacts.create(salon.id, { displayName: "Ana" });
    const enBarberia = await contacts.create(barberia.id, {
      displayName: "Ana",
    });

    await contacts.linkIdentity(salon.id, {
      contactId: enSalon.id,
      provider: "whatsapp",
      externalId: "5215550002222",
    });
    await contacts.linkIdentity(barberia.id, {
      contactId: enBarberia.id,
      provider: "whatsapp",
      externalId: "5215550002222",
    });

    await expect(
      contacts.findByExternalIdentity(salon.id, "whatsapp", "5215550002222"),
    ).resolves.toMatchObject({ id: enSalon.id });
    await expect(
      contacts.findByExternalIdentity(barberia.id, "whatsapp", "5215550002222"),
    ).resolves.toMatchObject({ id: enBarberia.id });
  });

  it("es idempotente dentro de la organización", async () => {
    const contacto = await contacts.create(salon.id, { displayName: "Ana" });

    const primera = await contacts.linkIdentity(salon.id, {
      contactId: contacto.id,
      provider: "whatsapp",
      externalId: "5215550003333",
    });
    const repetida = await contacts.linkIdentity(salon.id, {
      contactId: contacto.id,
      provider: "whatsapp",
      externalId: "5215550003333",
    });

    expect(repetida.id).toBe(primera.id);

    const { results } = await env.DB.prepare(
      `SELECT id FROM contact_identities WHERE organization_id = ?`,
    )
      .bind(salon.id)
      .all<{ id: string }>();

    expect(results).toHaveLength(1);
  });

  it("no vincula una identidad a un contacto de otra organización", async () => {
    const ajeno = await contacts.create(barberia.id, { displayName: "Luis" });

    await expect(
      contacts.linkIdentity(salon.id, {
        contactId: ajeno.id,
        provider: "whatsapp",
        externalId: "5215550005555",
      }),
    ).rejects.toBeInstanceOf(ContactNotInOrganizationError);

    const { results } = await env.DB.prepare(
      `SELECT id FROM contact_identities WHERE organization_id = ?`,
    )
      .bind(salon.id)
      .all<{ id: string }>();

    expect(results).toHaveLength(0);
  });

  it("no vincula una identidad a un contacto inexistente", async () => {
    await expect(
      contacts.linkIdentity(salon.id, {
        contactId: crypto.randomUUID(),
        provider: "whatsapp",
        externalId: "5215550007777",
      }),
    ).rejects.toBeInstanceOf(ContactNotInOrganizationError);
  });

  it("deja libre el identificador externo tras un intento cruzado", async () => {
    const ajeno = await contacts.create(barberia.id, { displayName: "Luis" });
    const propio = await contacts.create(salon.id, { displayName: "Ana" });

    await expect(
      contacts.linkIdentity(salon.id, {
        contactId: ajeno.id,
        provider: "whatsapp",
        externalId: "5215550006666",
      }),
    ).rejects.toBeInstanceOf(ContactNotInOrganizationError);

    // El intento fallido no debe ocupar el slot único de la organización.
    await contacts.linkIdentity(salon.id, {
      contactId: propio.id,
      provider: "whatsapp",
      externalId: "5215550006666",
    });

    await expect(
      contacts.findByExternalIdentity(salon.id, "whatsapp", "5215550006666"),
    ).resolves.toMatchObject({ id: propio.id });
  });

  it("no reasigna una identidad ya vinculada a otro contacto", async () => {
    const original = await contacts.create(salon.id, { displayName: "Ana" });
    const otro = await contacts.create(salon.id, { displayName: "Ana Duplicada" });

    await contacts.linkIdentity(salon.id, {
      contactId: original.id,
      provider: "whatsapp",
      externalId: "5215550004444",
    });
    await contacts.linkIdentity(salon.id, {
      contactId: otro.id,
      provider: "whatsapp",
      externalId: "5215550004444",
    });

    await expect(
      contacts.findByExternalIdentity(salon.id, "whatsapp", "5215550004444"),
    ).resolves.toMatchObject({ id: original.id });
  });
});
