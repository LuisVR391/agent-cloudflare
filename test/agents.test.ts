import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Agentes",
  organizationSlug: "salon-agentes",
  ownerName: "Aura Agente",
  ownerEmail: "owner-agents@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "77777777-7777-4777-8777-777777777777";

type AgentPayload = {
  id: string;
  name: string;
  purpose: string | null;
  status: string;
  publishedVersionId: string | null;
  publishedVersionNumber: number | null;
  version: number;
};

type VersionPayload = {
  id: string;
  versionNumber: number;
  status: string;
  instructions: string;
  model: string;
  playbook: string | null;
  changeReason: string | null;
  tools: string[];
  knowledgeScopes: string[];
  createdByName: string | null;
};

type PublicationPayload = {
  previousVersionNumber: number | null;
  nextVersionNumber: number | null;
  action: string;
  reason: string;
  actorId: string | null;
  actorName: string | null;
  occurredAt: string;
};

type DetailPayload = AgentPayload & {
  versions: VersionPayload[];
  publications: PublicationPayload[];
};

describe.sequential("agentes y sus versiones", () => {
  let sessionCookie: string;
  let organizationId: string;
  let ownerUserId: string;
  let foreignVersionId: string;

  const call = (path: string, init: RequestInit = {}) =>
    fetchWorker(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
        ...(init.headers ?? {}),
      },
    });

  const createAgent = async (name: string, purpose?: string) => {
    const response = await call("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name, purpose }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { agent: AgentPayload }).agent;
  };

  const addVersion = async (
    agentId: string,
    expectedVersion: number,
    body: Record<string, unknown>,
  ) => {
    const response = await call(`/api/agents/${agentId}/versions`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion, ...body }),
    });
    expect(response.status).toBe(201);
    return ((await response.json()) as { agent: DetailPayload }).agent;
  };

  const setPublication = (
    agentId: string,
    expectedVersion: number,
    versionId: string | null,
    reason: string,
    correlationId?: string,
  ) =>
    call(`/api/agents/${agentId}/publication`, {
      method: "PUT",
      body: JSON.stringify({ expectedVersion, versionId, reason }),
      ...(correlationId
        ? { headers: { "X-Correlation-Id": correlationId } }
        : {}),
    });

  beforeAll(async () => {
    const setup = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    organizationId = (
      (await setup.json()) as { organization: { id: string } }
    ).organization.id;

    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: setupBody.ownerEmail,
        password: setupBody.ownerPassword,
      }),
    });
    sessionCookie = cookiePair(login.headers.get("set-cookie"));

    const owner = await env.DB.prepare(
      `SELECT id FROM users WHERE email = ?`,
    )
      .bind(setupBody.ownerEmail)
      .first<{ id: string }>();
    ownerUserId = owner!.id;

    // Organización ajena con su propio agente y su propia versión publicada:
    // es contra la que se comprueba que nada cruce el límite de aislamiento.
    const now = new Date().toISOString();
    const foreignUserId = crypto.randomUUID();
    const foreignMembershipId = crypto.randomUUID();
    const foreignAgentId = crypto.randomUUID();
    foreignVersionId = crypto.randomUUID();

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
         VALUES (?, 'otro-salon-agentes', 'Otro salón', 'active', ?, ?)`,
      ).bind(otherOrganizationId, now, now),
      env.DB.prepare(
        `INSERT INTO users (id, name, email, email_verified, status, created_at, updated_at)
         VALUES (?, 'Ajena', ?, 0, 'active', ?, ?)`,
      ).bind(foreignUserId, `${foreignUserId}@example.com`, now, now),
    ]);
    await env.DB.prepare(
      `INSERT INTO memberships (id, organization_id, user_id, status, created_at, updated_at)
       VALUES (?, ?, ?, 'active', ?, ?)`,
    )
      .bind(foreignMembershipId, otherOrganizationId, foreignUserId, now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO agents (id, organization_id, name, normalized_name, status,
        created_by_membership_id, created_at, updated_at)
       VALUES (?, ?, 'Recepción ajena', 'recepción ajena', 'active', ?, ?, ?)`,
    )
      .bind(foreignAgentId, otherOrganizationId, foreignMembershipId, now, now)
      .run();
    await env.DB.prepare(
      `INSERT INTO agent_versions (id, organization_id, agent_id, version_number,
        status, instructions, model, created_by_membership_id, created_at, updated_at)
       VALUES (?, ?, ?, 1, 'published', 'Secreto ajeno', 'modelo-ajeno', ?, ?, ?)`,
    )
      .bind(
        foreignVersionId,
        otherOrganizationId,
        foreignAgentId,
        foreignMembershipId,
        now,
        now,
      )
      .run();
  });

  it("abre en estado vacío: una organización nueva no trae ningún agente", async () => {
    const response = await call("/api/agents");
    expect(response.status).toBe(200);
    expect(((await response.json()) as { agents: AgentPayload[] }).agents).toEqual(
      [],
    );
  });

  it("crea el agente y le reserva el nombre dentro de la organización", async () => {
    const agent = await createAgent("Recepción", "Atiende la primera pregunta");
    expect(agent).toMatchObject({
      name: "Recepción",
      purpose: "Atiende la primera pregunta",
      status: "active",
      publishedVersionId: null,
      publishedVersionNumber: null,
      version: 1,
    });

    // La unicidad no depende de mayúsculas ni de espacios en los extremos.
    const duplicate = await call("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "  recepción " }),
    });
    expect(duplicate.status).toBe(409);
    expect((await duplicate.json()) as { error: { code: string } }).toMatchObject(
      { error: { code: "AGENT_NAME_TAKEN" } },
    );

    // La organización ajena tiene su propio agente y no aparece aquí.
    const listed = await call("/api/agents");
    const agents = ((await listed.json()) as { agents: AgentPayload[] }).agents;
    expect(agents.map((item) => item.name)).toEqual(["Recepción"]);
  });

  it("reserva el nombre aunque el agente esté archivado", async () => {
    const agent = await createAgent("Temporal");
    const archived = await call(`/api/agents/${agent.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: agent.version, status: "archived" }),
    });
    expect(archived.status).toBe(200);

    const duplicate = await call("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "temporal" }),
    });
    expect(duplicate.status).toBe(409);

    // Y deja de listarse mientras no se pidan los archivados.
    const active = await call("/api/agents");
    const names = ((await active.json()) as { agents: AgentPayload[] }).agents.map(
      (item) => item.name,
    );
    expect(names).not.toContain("Temporal");
    const all = await call("/api/agents?status=all");
    const allNames = ((await all.json()) as { agents: AgentPayload[] }).agents.map(
      (item) => item.name,
    );
    expect(allNames).toContain("Temporal");
  });

  it("numera las versiones de forma correlativa por agente", async () => {
    const first = await createAgent("Agenda");
    const second = await createAgent("Seguimiento");

    const withVersion = await addVersion(first.id, first.version, {
      instructions: "Agenda citas.",
      model: "modelo-previsto",
      tools: ["agenda.crear", "agenda.crear", "  AGENDA.crear  "],
      knowledgeScopes: ["Políticas", "políticas "],
    });
    expect(withVersion.versions).toHaveLength(1);
    expect(withVersion.versions[0]).toMatchObject({
      versionNumber: 1,
      status: "draft",
      createdByName: setupBody.ownerName,
    });
    // Las declaraciones son un conjunto: se normalizan y se deduplican.
    expect(withVersion.versions[0].tools).toEqual(["agenda.crear"]);
    expect(withVersion.versions[0].knowledgeScopes).toEqual(["Políticas"]);

    const secondVersion = await addVersion(first.id, withVersion.version, {
      instructions: "Agenda y confirma.",
      model: "modelo-previsto",
    });
    expect(secondVersion.versions.map((item) => item.versionNumber)).toEqual([
      2, 1,
    ]);

    // Cada agente lleva su propia numeración.
    const other = await addVersion(second.id, second.version, {
      instructions: "Da seguimiento.",
      model: "modelo-previsto",
    });
    expect(other.versions[0].versionNumber).toBe(1);
  });

  it("deriva un borrador copiando el contenido, sin cruzar de agente ni de organización", async () => {
    const agent = await createAgent("Derivados");
    const base = await addVersion(agent.id, agent.version, {
      instructions: "Texto original.",
      model: "modelo-previsto",
      playbook: "Saluda primero.",
      tools: ["catalogo.consultar"],
      knowledgeScopes: ["Servicios"],
    });
    const sourceId = base.versions[0].id;

    const derived = await addVersion(agent.id, base.version, {
      fromVersionId: sourceId,
      changeReason: "Partir de la anterior",
    });
    const copy = derived.versions.find((item) => item.versionNumber === 2)!;
    expect(copy).toMatchObject({
      instructions: "Texto original.",
      model: "modelo-previsto",
      playbook: "Saluda primero.",
      changeReason: "Partir de la anterior",
      status: "draft",
    });
    expect(copy.tools).toEqual(["catalogo.consultar"]);
    expect(copy.knowledgeScopes).toEqual(["Servicios"]);

    // Una versión de otra organización no puede sembrar un borrador.
    const foreign = await call(`/api/agents/${agent.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: derived.version,
        fromVersionId: foreignVersionId,
      }),
    });
    expect(foreign.status).toBe(404);

    // Ni una de otro agente de la misma organización.
    const sibling = await createAgent("Hermano");
    const crossed = await call(`/api/agents/${sibling.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: sibling.version,
        fromVersionId: sourceId,
      }),
    });
    expect(crossed.status).toBe(404);

    // Y derivar mezclando contenido propio es una petición ambigua.
    const mixed = await call(`/api/agents/${agent.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: derived.version,
        fromVersionId: sourceId,
        instructions: "Otra cosa.",
        model: "modelo-previsto",
      }),
    });
    expect(mixed.status).toBe(400);
  });

  it("congela el contenido de una versión publicada", async () => {
    const agent = await createAgent("Congelado");
    const created = await addVersion(agent.id, agent.version, {
      instructions: "Texto publicado.",
      model: "modelo-previsto",
      tools: ["catalogo.consultar"],
    });
    const versionId = created.versions[0].id;

    const published = await setPublication(
      agent.id,
      created.version,
      versionId,
      "Primera publicación",
    );
    expect(published.status).toBe(200);
    const detail = ((await published.json()) as { agent: DetailPayload }).agent;

    const edit = await call(`/api/agents/${agent.id}/versions/${versionId}`, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: detail.version,
        instructions: "Texto cambiado.",
        model: "modelo-previsto",
      }),
    });
    expect(edit.status).toBe(409);
    expect((await edit.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "AGENT_VERSION_NOT_EDITABLE" },
    });

    // Ni el texto ni las declaraciones se movieron.
    const stored = await env.DB.prepare(
      `SELECT instructions FROM agent_versions WHERE organization_id = ? AND id = ?`,
    )
      .bind(organizationId, versionId)
      .first<{ instructions: string }>();
    expect(stored?.instructions).toBe("Texto publicado.");
    const tools = await env.DB.prepare(
      `SELECT count(*) AS total FROM agent_version_tools
        WHERE organization_id = ? AND agent_version_id = ?`,
    )
      .bind(organizationId, versionId)
      .first<{ total: number }>();
    expect(tools?.total).toBe(1);
  });

  it("edita el borrador y reemplaza sus declaraciones sin tocar lo publicado", async () => {
    const agent = await createAgent("Borrador vivo");
    const first = await addVersion(agent.id, agent.version, {
      instructions: "Publicada.",
      model: "modelo-previsto",
    });
    const publishedId = first.versions[0].id;
    const published = await setPublication(
      agent.id,
      first.version,
      publishedId,
      "Publicar la primera",
    );
    const afterPublish = ((await published.json()) as { agent: DetailPayload })
      .agent;

    const withDraft = await addVersion(agent.id, afterPublish.version, {
      instructions: "Borrador.",
      model: "modelo-previsto",
      tools: ["uno", "dos"],
    });
    const draftId = withDraft.versions.find((item) => item.status === "draft")!.id;

    const edited = await call(`/api/agents/${agent.id}/versions/${draftId}`, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: withDraft.version,
        instructions: "Borrador corregido.",
        model: "otro-modelo",
        tools: ["tres"],
      }),
    });
    expect(edited.status).toBe(200);
    const detail = ((await edited.json()) as { agent: DetailPayload }).agent;
    const draft = detail.versions.find((item) => item.id === draftId)!;
    expect(draft).toMatchObject({
      instructions: "Borrador corregido.",
      model: "otro-modelo",
    });
    expect(draft.tools).toEqual(["tres"]);

    // La publicada conserva su texto y sigue siendo la viva.
    const live = detail.versions.find((item) => item.id === publishedId)!;
    expect(live.instructions).toBe("Publicada.");
    expect(detail.publishedVersionId).toBe(publishedId);
  });

  it("admite a lo sumo una versión publicada y archiva la anterior", async () => {
    const agent = await createAgent("Relevo");
    const first = await addVersion(agent.id, agent.version, {
      instructions: "Primera.",
      model: "modelo-previsto",
    });
    const firstId = first.versions[0].id;
    const published = await setPublication(
      agent.id,
      first.version,
      firstId,
      "Publicar la primera",
    );
    const afterFirst = ((await published.json()) as { agent: DetailPayload }).agent;

    const second = await addVersion(agent.id, afterFirst.version, {
      instructions: "Segunda.",
      model: "modelo-previsto",
    });
    const secondId = second.versions.find((item) => item.versionNumber === 2)!.id;
    const relieved = await setPublication(
      agent.id,
      second.version,
      secondId,
      "Publicar la segunda",
    );
    expect(relieved.status).toBe(200);
    const detail = ((await relieved.json()) as { agent: DetailPayload }).agent;

    expect(detail.publishedVersionId).toBe(secondId);
    expect(detail.publishedVersionNumber).toBe(2);
    expect(detail.versions.find((item) => item.id === firstId)?.status).toBe(
      "archived",
    );

    const live = await env.DB.prepare(
      `SELECT count(*) AS total FROM agent_versions
        WHERE organization_id = ? AND agent_id = ? AND status = 'published'`,
    )
      .bind(organizationId, agent.id)
      .first<{ total: number }>();
    expect(live?.total).toBe(1);
  });

  it("revierte reactivando la versión anterior sin copiar contenido", async () => {
    const agent = await createAgent("Reversible");
    const first = await addVersion(agent.id, agent.version, {
      instructions: "Texto de la uno.",
      model: "modelo-previsto",
    });
    const firstId = first.versions[0].id;
    let detail = ((await (
      await setPublication(agent.id, first.version, firstId, "Publicar v1")
    ).json()) as { agent: DetailPayload }).agent;

    const second = await addVersion(agent.id, detail.version, {
      instructions: "Texto de la dos.",
      model: "modelo-previsto",
    });
    const secondId = second.versions.find((item) => item.versionNumber === 2)!.id;
    detail = ((await (
      await setPublication(agent.id, second.version, secondId, "Publicar v2")
    ).json()) as { agent: DetailPayload }).agent;

    const reverted = await setPublication(
      agent.id,
      detail.version,
      firstId,
      "La dos respondía de más",
    );
    expect(reverted.status).toBe(200);
    detail = ((await reverted.json()) as { agent: DetailPayload }).agent;

    expect(detail.publishedVersionId).toBe(firstId);
    expect(detail.publishedVersionNumber).toBe(1);
    // No se derivó una copia: siguen siendo dos versiones y el texto original
    // llegó intacto.
    expect(detail.versions).toHaveLength(2);
    expect(detail.versions.find((item) => item.id === firstId)).toMatchObject({
      instructions: "Texto de la uno.",
      versionNumber: 1,
    });
    expect(detail.publications[0]).toMatchObject({
      action: "rolled_back",
      previousVersionNumber: 2,
      nextVersionNumber: 1,
      reason: "La dos respondía de más",
      actorName: setupBody.ownerName,
    });
  });

  it("registra en el historial quién publicó, cuándo y por qué", async () => {
    const agent = await createAgent("Historial");
    const created = await addVersion(agent.id, agent.version, {
      instructions: "Primera.",
      model: "modelo-previsto",
    });
    const versionId = created.versions[0].id;
    const correlationId = crypto.randomUUID();

    const published = await setPublication(
      agent.id,
      created.version,
      versionId,
      "Arranque del piloto",
      correlationId,
    );
    const detail = ((await published.json()) as { agent: DetailPayload }).agent;

    expect(detail.publications).toHaveLength(1);
    expect(detail.publications[0]).toMatchObject({
      action: "published",
      previousVersionNumber: null,
      nextVersionNumber: 1,
      reason: "Arranque del piloto",
      actorId: ownerUserId,
      actorName: setupBody.ownerName,
    });
    expect(detail.publications[0].occurredAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);

    const stored = await env.DB.prepare(
      `SELECT correlation_id FROM agent_publication_transitions
        WHERE organization_id = ? AND agent_id = ?`,
    )
      .bind(organizationId, agent.id)
      .first<{ correlation_id: string }>();
    expect(stored?.correlation_id).toBe(correlationId);

    const audit = await env.DB.prepare(
      `SELECT action, resource_type, resource_id, result FROM audit_logs
        WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{
        action: string;
        resource_type: string;
        resource_id: string;
        result: string;
      }>();
    expect(audit).toEqual({
      action: "agent.publication_change",
      resource_type: "agent",
      resource_id: agent.id,
      result: "allowed",
    });
  });

  it("desactiva la publicación sin borrar la versión", async () => {
    const agent = await createAgent("Desactivable");
    const created = await addVersion(agent.id, agent.version, {
      instructions: "Única.",
      model: "modelo-previsto",
    });
    const versionId = created.versions[0].id;
    let detail = ((await (
      await setPublication(agent.id, created.version, versionId, "Publicar")
    ).json()) as { agent: DetailPayload }).agent;

    const disabled = await setPublication(
      agent.id,
      detail.version,
      null,
      "Pausar mientras se revisa",
    );
    expect(disabled.status).toBe(200);
    detail = ((await disabled.json()) as { agent: DetailPayload }).agent;

    expect(detail.publishedVersionId).toBeNull();
    expect(detail.versions).toHaveLength(1);
    expect(detail.versions[0].status).toBe("archived");
    expect(detail.publications[0]).toMatchObject({
      action: "unpublished",
      previousVersionNumber: 1,
      nextVersionNumber: null,
    });
  });

  it("rechaza una publicación que no cambia nada", async () => {
    const agent = await createAgent("Sin cambio");

    // Desactivar lo que ya está desactivado no describe ninguna transición.
    const idle = await setPublication(agent.id, agent.version, null, "Nada");
    expect(idle.status).toBe(409);
    expect((await idle.json()) as { error: { code: string } }).toMatchObject({
      error: { code: "AGENT_PUBLICATION_UNCHANGED" },
    });

    const created = await addVersion(agent.id, agent.version, {
      instructions: "Única.",
      model: "modelo-previsto",
    });
    const versionId = created.versions[0].id;
    const detail = ((await (
      await setPublication(agent.id, created.version, versionId, "Publicar")
    ).json()) as { agent: DetailPayload }).agent;

    const again = await setPublication(
      agent.id,
      detail.version,
      versionId,
      "Otra vez",
    );
    expect(again.status).toBe(409);

    const history = await env.DB.prepare(
      `SELECT count(*) AS total FROM agent_publication_transitions
        WHERE organization_id = ? AND agent_id = ?`,
    )
      .bind(organizationId, agent.id)
      .first<{ total: number }>();
    expect(history?.total).toBe(1);
  });

  it("un borrador nunca queda archivado", async () => {
    const { results } = await env.DB.prepare(
      `SELECT v.id FROM agent_versions v
        WHERE v.organization_id = ? AND v.status = 'archived'
          AND NOT EXISTS (SELECT 1 FROM agent_publication_transitions t
                           WHERE t.organization_id = v.organization_id
                             AND t.previous_version_id = v.id)`,
    )
      .bind(organizationId)
      .all<{ id: string }>();
    expect(results).toEqual([]);
  });

  it("exige la versión vigente del agente en toda mutación", async () => {
    const agent = await createAgent("Concurrente");
    const stale = agent.version;
    const created = await addVersion(agent.id, stale, {
      instructions: "Primera.",
      model: "modelo-previsto",
    });
    const versionId = created.versions[0].id;

    const repeated = await call(`/api/agents/${agent.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: stale,
        instructions: "Otra.",
        model: "modelo-previsto",
      }),
    });
    expect(repeated.status).toBe(409);

    const rename = await call(`/api/agents/${agent.id}`, {
      method: "PATCH",
      body: JSON.stringify({ expectedVersion: stale, name: "Otro nombre" }),
    });
    expect(rename.status).toBe(409);

    const edit = await call(`/api/agents/${agent.id}/versions/${versionId}`, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: stale,
        instructions: "Otra.",
        model: "modelo-previsto",
      }),
    });
    expect(edit.status).toBe(409);

    const publish = await setPublication(agent.id, stale, versionId, "Publicar");
    expect(publish.status).toBe(409);

    // Nada se escribió a medias: sigue habiendo una sola versión y ninguna viva.
    const detail = ((await (
      await call(`/api/agents/${agent.id}`)
    ).json()) as { agent: DetailPayload }).agent;
    expect(detail.versions).toHaveLength(1);
    expect(detail.publishedVersionId).toBeNull();
  });

  it("responde 404 a un agente ajeno en todas las ramas", async () => {
    const foreignAgent = await env.DB.prepare(
      `SELECT id FROM agents WHERE organization_id = ?`,
    )
      .bind(otherOrganizationId)
      .first<{ id: string }>();
    const path = `/api/agents/${foreignAgent!.id}`;

    for (const [method, body] of [
      ["GET", undefined],
      ["PATCH", JSON.stringify({ expectedVersion: 1, name: "Robado" })],
    ] as const) {
      const response = await call(path, { method, body });
      expect(response.status).toBe(404);
    }

    const version = await call(`${path}/versions`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: 1,
        instructions: "Robado.",
        model: "modelo-previsto",
      }),
    });
    expect(version.status).toBe(404);

    const publication = await call(`${path}/publication`, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: 1,
        versionId: foreignVersionId,
        reason: "Robado",
      }),
    });
    expect(publication.status).toBe(404);

    // La organización ajena conserva su versión publicada intacta.
    const stored = await env.DB.prepare(
      `SELECT status, instructions FROM agent_versions
        WHERE organization_id = ? AND id = ?`,
    )
      .bind(otherOrganizationId, foreignVersionId)
      .first<{ status: string; instructions: string }>();
    expect(stored).toEqual({
      status: "published",
      instructions: "Secreto ajeno",
    });
  });

  it("rechaza sin sesión y con cuerpo inválido", async () => {
    const anonymous = await fetchWorker("/api/agents");
    expect(anonymous.status).toBe(401);

    const noName = await call("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name: "   " }),
    });
    expect(noName.status).toBe(400);

    const agent = await createAgent("Validaciones");
    const created = await addVersion(agent.id, agent.version, {
      instructions: "Primera.",
      model: "modelo-previsto",
    });

    // Un borrador sin instrucciones ni origen no describe ningún comportamiento.
    const empty = await call(`/api/agents/${agent.id}/versions`, {
      method: "POST",
      body: JSON.stringify({ expectedVersion: created.version }),
    });
    expect(empty.status).toBe(400);

    // El motivo de una publicación es obligatorio: sin él el historial no
    // conserva el porqué.
    const reasonless = await call(`/api/agents/${agent.id}/publication`, {
      method: "PUT",
      body: JSON.stringify({
        expectedVersion: created.version,
        versionId: created.versions[0].id,
        reason: "   ",
      }),
    });
    expect(reasonless.status).toBe(400);
  });

  it("responde 405 al método no permitido", async () => {
    const agent = await createAgent("Métodos");
    const removal = await call(`/api/agents/${agent.id}`, { method: "DELETE" });
    expect(removal.status).toBe(405);

    const publicationGet = await call(`/api/agents/${agent.id}/publication`);
    expect(publicationGet.status).toBe(405);
  });

  it("no confunde una subruta desconocida con el detalle del agente", async () => {
    const agent = await createAgent("Subrutas");

    for (const path of [
      `/api/agents/${agent.id}/desconocida`,
      `/api/agents/${agent.id}/publication/algo`,
      `/api/agents/${agent.id}/versions/uno/dos`,
    ]) {
      const response = await call(path);
      expect(response.status).toBe(404);
    }
  });

  it("publicar una versión no cambia ninguna conversación", async () => {
    const now = new Date().toISOString();
    const channelId = crypto.randomUUID();
    const contactId = crypto.randomUUID();
    const conversationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO communication_channels
          (id, organization_id, provider, adapter, external_account_id, status,
           created_at, updated_at)
         VALUES (?, ?, 'whatsapp', 'zernio', ?, 'active', ?, ?)`,
      ).bind(channelId, organizationId, `account-${channelId}`, now, now),
      env.DB.prepare(
        `INSERT INTO contacts (id, organization_id, status, created_at, updated_at)
         VALUES (?, ?, 'active', ?, ?)`,
      ).bind(contactId, organizationId, now, now),
    ]);
    await env.DB.prepare(
      `INSERT INTO conversations
        (id, organization_id, channel_id, contact_id, external_conversation_id,
         last_message_at, created_at, updated_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    )
      .bind(
        conversationId,
        organizationId,
        channelId,
        contactId,
        `external-${conversationId}`,
        now,
        now,
        now,
      )
      .run();

    const before = await env.DB.prepare(
      `SELECT attention_mode, updated_at FROM conversations
        WHERE organization_id = ? AND id = ?`,
    )
      .bind(organizationId, conversationId)
      .first<{ attention_mode: string; updated_at: string }>();

    const agent = await createAgent("Sin efecto");
    const created = await addVersion(agent.id, agent.version, {
      instructions: "Responde todo.",
      model: "modelo-previsto",
    });
    const published = await setPublication(
      agent.id,
      created.version,
      created.versions[0].id,
      "Publicar",
    );
    expect(published.status).toBe(200);

    const after = await env.DB.prepare(
      `SELECT attention_mode, updated_at FROM conversations
        WHERE organization_id = ? AND id = ?`,
    )
      .bind(organizationId, conversationId)
      .first<{ attention_mode: string; updated_at: string }>();

    expect(after).toEqual(before);
    expect(after?.attention_mode).toBe("human");
  });

  it("concede agentes a owner y manager, y no a operator", async () => {
    const { results } = await env.DB.prepare(
      `SELECT r.role_key, p.permission_key
         FROM role_permissions rp
         JOIN roles r ON r.id = rp.role_id
         JOIN permissions p ON p.id = rp.permission_id
        WHERE rp.organization_id = ? AND p.permission_key LIKE 'agents.%'
        ORDER BY r.role_key, p.permission_key`,
    )
      .bind(organizationId)
      .all<{ role_key: string; permission_key: string }>();

    // El corte no introduce permisos: ambos se siembran en la instalación desde
    // el commit que creó la migración 0002, así que no hay catálogo que
    // propagar por migración.
    expect(
      results.map((row) => `${row.role_key}:${row.permission_key}`),
    ).toEqual([
      "manager:agents.manage",
      "manager:agents.read",
      "owner:agents.manage",
      "owner:agents.read",
    ]);
  });

  it("audita el rechazo de gestión y sigue dejando consultar", async () => {
    const agent = await createAgent("Sin gestión");
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id = (SELECT id FROM permissions WHERE permission_key = 'agents.manage')`,
    )
      .bind(organizationId)
      .run();

    const correlationId = crypto.randomUUID();
    const rejected = await setPublication(
      agent.id,
      agent.version,
      null,
      "Sin permiso",
      correlationId,
    );
    expect(rejected.status).toBe(403);

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toEqual({
      action: "agent.publication_change",
      resource_id: agent.id,
      result: "rejected",
    });

    // Leer sigue permitido.
    const listed = await call("/api/agents");
    expect(listed.status).toBe(200);
  });

  it("falla cerrado sin el permiso de lectura", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id = (SELECT id FROM permissions WHERE permission_key = 'agents.read')`,
    )
      .bind(organizationId)
      .run();

    const correlationId = crypto.randomUUID();
    const listed = await call("/api/agents", {
      headers: { "X-Correlation-Id": correlationId },
    });
    expect(listed.status).toBe(403);

    // Un rechazo de lectura no escribe auditoría: no hubo intento de efecto.
    const audit = await env.DB.prepare(
      `SELECT count(*) AS total FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ total: number }>();
    expect(audit?.total).toBe(0);
  });
});
