import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";
import {
  ContactNotInOrganizationError,
  MissingOrganizationScopeError,
} from "../../src/worker/domain/errors";
import type { Organization } from "../../src/worker/domain/types";
import { createRepositories } from "../../src/worker/repositories";

const { organizations, contacts, services, pipelines } = createRepositories(
  env.DB,
);

let salon: Organization;
let barberia: Organization;

beforeEach(async () => {
  salon = await organizations.create({
    slug: `salon-${crypto.randomUUID()}`,
    displayName: "Salón Aurora",
  });
  barberia = await organizations.create({
    slug: `barberia-${crypto.randomUUID()}`,
    displayName: "Barbería Norte",
  });
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
