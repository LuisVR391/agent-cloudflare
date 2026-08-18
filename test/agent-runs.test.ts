import { env, exports } from "cloudflare:workers";
import { getAgentByName } from "agents";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { executeAgentRun } from "../src/worker/agents/agent-run";
import type { ModelProvider, ModelRequest } from "../src/worker/agents/model-provider";
import { createModelProvider } from "../src/worker/agents/workers-ai-provider";
import type { OutboundQueueMessage } from "../src/worker/integrations/zernio/contracts";
import { processOutboundQueueMessage } from "../src/worker/integrations/zernio/outbound-queue";
import { AgentRunRepository } from "../src/worker/repositories/agent-run-repository";
import { ConversationRepository } from "../src/worker/repositories/conversation-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón que Responde",
  organizationSlug: "salon-que-responde",
  ownerName: "Ana Propietaria",
  ownerEmail: "owner-agent-runs@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

const otherOrganizationId = "88888888-8888-4888-8888-888888888888";
const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

/** Proveedor de prueba: ninguna corrida de esta suite llama a un modelo real. */
function providerReturning(text: string): ModelProvider & {
  requests: ModelRequest[];
} {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async generate(request) {
      requests.push(request);
      return { text };
    },
  };
}

function queueRecording() {
  return {
    send: vi.fn(async (_message: OutboundQueueMessage) => undefined),
  };
}

describe.sequential("ejecución del agente en la conversación", () => {
  let sessionCookie: string;
  let organizationId: string;
  let channelId: string;
  let agentId: string;
  let draftAgentId: string;

  async function patch(conversationId: string, body: Record<string, unknown>) {
    const version = await env.DB.prepare(
      "SELECT version FROM conversations WHERE id = ?",
    ).bind(conversationId).first<{ version: number }>();
    return fetchWorker(`/api/conversations/${conversationId}`, {
      method: "PATCH",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ expectedVersion: version!.version, ...body }),
    });
  }

  /** Crea el agente por el camino real y publica su primera versión. */
  async function createAgent(
    name: string,
    options: { publish: boolean } = { publish: true },
  ): Promise<string> {
    const created = await fetchWorker("/api/agents", {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({ name }),
    });
    const { agent } = (await created.json()) as {
      agent: { id: string; version: number };
    };
    const version = await fetchWorker(`/api/agents/${agent.id}/versions`, {
      method: "POST",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        expectedVersion: agent.version,
        instructions: "Atiende con calidez y agenda citas del salón.",
        model,
      }),
    });
    const detail = (await version.json()) as {
      agent: { version: number; versions: { id: string }[] };
    };
    if (!options.publish) return agent.id;
    const published = await fetchWorker(`/api/agents/${agent.id}/publication`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        expectedVersion: detail.agent.version,
        versionId: detail.agent.versions[0].id,
        reason: "Primera publicación",
      }),
    });
    expect(published.status).toBe(200);
    return agent.id;
  }

  /** Conversación con un mensaje entrante, ya respondiendo con el agente. */
  async function automaticConversation(input: {
    external: string;
    text?: string | null;
    messageType?: "text" | "image";
    agent?: string;
  }): Promise<{ conversationId: string; messageId: string }> {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId,
      channelId,
      externalConversationId: `z-${input.external}`,
      externalContactId: `wa-${input.external}`,
      externalMessageId: `m-${input.external}`,
      platformMessageId: `wamid-${input.external}`,
      text: input.text === undefined ? "¿Tienen cita mañana?" : input.text,
      messageType: input.messageType ?? "text",
      occurredAt: "2026-08-18T10:00:00.000Z",
      correlationId: crypto.randomUUID(),
    });
    const activated = await patch(inbound.conversationId, {
      attentionMode: "automatic",
      agentId: input.agent ?? agentId,
    });
    expect(activated.status).toBe(200);
    return inbound;
  }

  function conversationRow(conversationId: string) {
    return env.DB.prepare(
      `SELECT attention_mode, agent_id FROM conversations WHERE id = ?`,
    ).bind(conversationId).first<{
      attention_mode: string;
      agent_id: string | null;
    }>();
  }

  function outgoingMessages(conversationId: string) {
    return env.DB.prepare(
      `SELECT id, sender_type, sender_id, text_content, status
         FROM messages
        WHERE conversation_id = ? AND direction = 'outgoing'
        ORDER BY occurred_at, id`,
    ).bind(conversationId).all<{
      id: string;
      sender_type: string;
      sender_id: string | null;
      text_content: string;
      status: string;
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

    const now = new Date().toISOString();
    channelId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, 'otro-salon-runs', 'Otro salón', 'active', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', 'account-runs', 'active', ?, ?)`)
        .bind(channelId, organizationId, now, now),
    ]);

    agentId = await createAgent("Recepción");
    draftAgentId = await createAgent("Sin publicar", { publish: false });
  });

  it("responde con la versión publicada y deja la traza de la corrida", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "responde",
    });
    const provider = providerReturning("Sí, mañana a las 11.");
    const outbound = queueRecording();

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    const messages = await outgoingMessages(conversationId);
    expect(messages.results).toHaveLength(1);
    expect(messages.results[0]).toMatchObject({
      sender_type: "system",
      sender_id: agentId,
      text_content: "Sí, mañana a las 11.",
      status: "queued",
    });
    expect(outbound.send).toHaveBeenCalledTimes(1);

    const run = await new AgentRunRepository(env.DB).findByTriggerMessage(
      organizationId,
      messageId,
    );
    expect(run).toMatchObject({
      status: "succeeded",
      agentId,
      agentVersionNumber: 1,
      model,
      failureCode: null,
    });
    expect(run?.responseMessageId).toBe(messages.results[0].id);
    expect(run?.finishedAt).not.toBeNull();

    // La correlación del mensaje entrante llega intacta hasta la salida.
    const trigger = await env.DB.prepare(
      "SELECT correlation_id FROM messages WHERE id = ?",
    ).bind(messageId).first<{ correlation_id: string }>();
    expect(run?.correlationId).toBe(trigger!.correlation_id);
    expect(outbound.send.mock.calls[0][0]).toMatchObject({
      correlationId: trigger!.correlation_id,
    });

    const audit = await env.DB.prepare(
      `SELECT actor_type, result, resource_type FROM audit_logs
        WHERE organization_id = ? AND action = 'conversation.agent.run'`,
    ).bind(organizationId).all<{
      actor_type: string;
      result: string;
      resource_type: string;
    }>();
    expect(audit.results).toContainEqual({
      actor_type: "system",
      result: "allowed",
      resource_type: "agent_run",
    });
  });

  it("no lleva al modelo mensajes de otra organización ni de otra conversación", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "aislada",
      text: "¿Cuánto cuesta el retoque?",
    });

    // Conversación ajena, con su propio contacto y su propio mensaje.
    const now = new Date().toISOString();
    const foreignChannelId = crypto.randomUUID();
    const foreignContactId = crypto.randomUUID();
    const foreignConversationId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', 'account-ajena', 'active', ?, ?)`)
        .bind(foreignChannelId, otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO contacts
        (id, organization_id, status, created_at, updated_at)
        VALUES (?, ?, 'active', ?, ?)`)
        .bind(foreignContactId, otherOrganizationId, now, now),
    ]);
    await env.DB.prepare(`INSERT INTO conversations
      (id, organization_id, channel_id, contact_id, external_conversation_id,
       last_message_at, created_at, updated_at)
      VALUES (?, ?, ?, ?, 'z-ajena', ?, ?, ?)`)
      .bind(foreignConversationId, otherOrganizationId, foreignChannelId,
        foreignContactId, now, now, now).run();
    await env.DB.prepare(`INSERT INTO messages
      (id, organization_id, conversation_id, direction, sender_type, message_type,
       text_content, status, correlation_id, occurred_at, created_at, updated_at)
      VALUES (?, ?, ?, 'incoming', 'customer', 'text', 'SECRETO DE OTRA EMPRESA',
        'received', ?, ?, ?, ?)`)
      .bind(crypto.randomUUID(), otherOrganizationId, foreignConversationId,
        crypto.randomUUID(), now, now, now).run();

    // Y otra conversación de la misma organización, que tampoco entra.
    await automaticConversation({
      external: "vecina",
      text: "MENSAJE DE OTRA CONVERSACIÓN",
    });

    const provider = providerReturning("El retoque cuesta 800.");
    await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    const [request] = provider.requests;
    const contents = request.turns.map((turn) => turn.content).join("\n");
    expect(contents).toContain("¿Cuánto cuesta el retoque?");
    expect(contents).not.toContain("SECRETO DE OTRA EMPRESA");
    expect(contents).not.toContain("MENSAJE DE OTRA CONVERSACIÓN");
    expect(request.model).toBe(model);
    expect(request.instructions).toContain("agenda citas del salón");
  });

  it("no produce mensaje cuando la salida del modelo no cumple el schema", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "schema",
    });
    // El proveedor real con un binding que devuelve una respuesta vacía: la
    // validación ocurre antes de que el texto llegue a existir como mensaje.
    const provider = createModelProvider({
      AI: { run: async () => ({ response: "   " }) },
    });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "failed",
      failureCode: "MODEL_OUTPUT_INVALID",
      escalated: true,
    });
    expect((await outgoingMessages(conversationId)).results).toHaveLength(0);
    const run = await new AgentRunRepository(env.DB).findByTriggerMessage(
      organizationId,
      messageId,
    );
    expect(run).toMatchObject({
      status: "failed",
      failureCode: "MODEL_OUTPUT_INVALID",
      responseMessageId: null,
    });
    expect(await conversationRow(conversationId)).toMatchObject({
      attention_mode: "human",
      agent_id: agentId,
    });
    const history = await env.DB.prepare(
      `SELECT actor_type, previous_attention_mode, next_attention_mode
         FROM conversation_status_history
        WHERE conversation_id = ? AND actor_type = 'system'`,
    ).bind(conversationId).first<{
      actor_type: string;
      previous_attention_mode: string;
      next_attention_mode: string;
    }>();
    expect(history).toEqual({
      actor_type: "system",
      previous_attention_mode: "automatic",
      next_attention_mode: "human",
    });
  });

  it("registra el fallo del proveedor sin romper la conversación", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "fallo",
    });
    const provider = createModelProvider({
      AI: {
        run: async () => {
          throw new Error("upstream 500 con el prompt completo");
        },
      },
    });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "failed",
      failureCode: "MODEL_UNAVAILABLE",
    });
    const run = await new AgentRunRepository(env.DB).findByTriggerMessage(
      organizationId,
      messageId,
    );
    // El motivo se guarda como código: el cuerpo del proveedor puede citar el
    // prompt o el mensaje del contacto y no entra en la traza.
    expect(run?.failureCode).toBe("MODEL_UNAVAILABLE");
    expect(await conversationRow(conversationId)).toMatchObject({
      attention_mode: "human",
    });
    // La conversación sigue consultable y el mensaje del contacto intacto.
    const thread = await new ConversationRepository(env.DB).listMessages(
      organizationId,
      conversationId,
      { limit: 10 },
    );
    expect(thread.messages).toHaveLength(1);
  });

  it("no duplica la respuesta cuando el mismo mensaje dispara dos corridas", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "duplicada",
    });
    const provider = providerReturning("Claro que sí.");
    const outbound = queueRecording();

    const outcomes = await Promise.all([
      executeAgentRun({ db: env.DB, provider, outbound },
        { organizationId, conversationId, triggerMessageId: messageId }),
      executeAgentRun({ db: env.DB, provider, outbound },
        { organizationId, conversationId, triggerMessageId: messageId }),
    ]);

    expect(outcomes.filter((outcome) => outcome.result === "succeeded"))
      .toHaveLength(1);
    expect(outcomes).toContainEqual({
      result: "not_applicable",
      reason: "DUPLICATE_TRIGGER",
    });
    expect((await outgoingMessages(conversationId)).results).toHaveLength(1);
    expect(outbound.send).toHaveBeenCalledTimes(1);
    const runs = await env.DB.prepare(
      `SELECT COUNT(*) AS total FROM agent_runs WHERE trigger_message_id = ?`,
    ).bind(messageId).first<{ total: number }>();
    expect(runs?.total).toBe(1);
  });

  it("devuelve al equipo un mensaje que no es texto, sin llamar al modelo", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "imagen",
      text: null,
      messageType: "image",
    });
    const provider = providerReturning("No debería responder.");

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "skipped",
      failureCode: "UNSUPPORTED_MESSAGE_CONTENT",
      escalated: true,
    });
    expect(provider.requests).toHaveLength(0);
    expect((await outgoingMessages(conversationId)).results).toHaveLength(0);
    expect(await conversationRow(conversationId)).toMatchObject({
      attention_mode: "human",
    });
  });

  it("deja la conversación al equipo si el agente ya no puede responder", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "archivado",
    });
    // La versión se desactiva después de activar el agente: la conversación
    // conserva a quién eligieron, pero ya no hay configuración que ejecutar.
    const detail = await fetchWorker(`/api/agents/${agentId}`, {
      headers: { Cookie: sessionCookie },
    });
    const { agent } = (await detail.json()) as { agent: { version: number } };
    const unpublished = await fetchWorker(`/api/agents/${agentId}/publication`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        expectedVersion: agent.version,
        versionId: null,
        reason: "Pausar mientras revisamos",
      }),
    });
    expect(unpublished.status).toBe(200);

    const provider = providerReturning("No debería responder.");
    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "skipped",
      failureCode: "AGENT_NOT_RUNNABLE",
      runId: null,
      escalated: true,
    });
    expect(provider.requests).toHaveLength(0);
    expect(await conversationRow(conversationId)).toMatchObject({
      attention_mode: "human",
    });

    // Vuelve a publicarse para las pruebas siguientes.
    const restored = await fetchWorker(`/api/agents/${agentId}`, {
      headers: { Cookie: sessionCookie },
    });
    const { agent: current } = (await restored.json()) as {
      agent: { version: number; versions: { id: string }[] };
    };
    await fetchWorker(`/api/agents/${agentId}/publication`, {
      method: "PUT",
      headers: { "Content-Type": "application/json", Cookie: sessionCookie },
      body: JSON.stringify({
        expectedVersion: current.version,
        versionId: current.versions[0].id,
        reason: "Reactivar",
      }),
    });
  });

  it("entrega la respuesta por la salida existente, con su idempotencia", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "salida",
    });
    const outcome = await executeAgentRun(
      {
        db: env.DB,
        provider: providerReturning("Te esperamos el jueves."),
        outbound: queueRecording(),
      },
      { organizationId, conversationId, triggerMessageId: messageId },
    );
    expect(outcome.result).toBe("succeeded");
    const responseMessageId = outcome.result === "succeeded"
      ? outcome.responseMessageId
      : "";

    // La clave de idempotencia deriva del identificador de la corrida, así que
    // un reintento del envío reutiliza la misma y no produce un segundo mensaje.
    const delivery = await env.DB.prepare(
      `SELECT idempotency_key FROM outbound_message_deliveries WHERE message_id = ?`,
    ).bind(responseMessageId).first<{ idempotency_key: string }>();
    const runId = outcome.result === "succeeded" ? outcome.runId : "";
    expect(delivery?.idempotency_key).toBe(`${organizationId}:${runId}`);

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      success: true,
      data: { messageId: "z-agent-1", conversationId: null, sentAt: null },
    })));
    await expect(processOutboundQueueMessage(
      {
        DB: env.DB,
        CustomerSupportAgent: env.CustomerSupportAgent,
        ZERNIO_API_KEY: "test-only-zernio-key",
      },
      {
        kind: "sendTextMessage",
        organizationId,
        conversationId,
        messageId: responseMessageId,
        correlationId: crypto.randomUUID(),
      },
    )).resolves.toEqual({ action: "ack", result: "sent" });
    const sent = await env.DB.prepare(
      "SELECT status, external_message_id FROM messages WHERE id = ?",
    ).bind(responseMessageId).first<{
      status: string;
      external_message_id: string;
    }>();
    expect(sent).toEqual({ status: "sent", external_message_id: "z-agent-1" });
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("registra y escala cuando el entorno no declara inferencia", async () => {
    // El runtime real, con los bindings de prueba: no hay `AI`, así que la
    // corrida no puede ocurrir y la conversación vuelve al equipo en vez de
    // quedarse muda.
    const { conversationId, messageId } = await automaticConversation({
      external: "sin-binding",
    });
    const runtime = await getAgentByName(
      env.CustomerSupportAgent,
      `${organizationId}:${conversationId}`,
    );
    await runtime.acceptInboundMessage({
      organizationId,
      conversationId,
      messageId,
      occurredAt: "2026-08-18T10:00:00.000Z",
      bufferSeconds: 30,
    });
    await runtime.flushPendingMessages();

    const run = await new AgentRunRepository(env.DB).findByTriggerMessage(
      organizationId,
      messageId,
    );
    expect(run).toMatchObject({
      status: "failed",
      failureCode: "MODEL_UNAVAILABLE",
    });
    expect(await conversationRow(conversationId)).toMatchObject({
      attention_mode: "human",
    });
  });

  it("solo acepta el modo automático con un agente que pueda responder", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId,
      channelId,
      externalConversationId: "z-validacion",
      externalContactId: "wa-validacion",
      externalMessageId: "m-validacion",
      platformMessageId: "wamid-validacion",
      text: "Hola",
      occurredAt: "2026-08-18T10:00:00.000Z",
      correlationId: crypto.randomUUID(),
    });

    const withoutAgent = await patch(inbound.conversationId, {
      attentionMode: "automatic",
    });
    expect(withoutAgent.status).toBe(409);
    expect((await withoutAgent.json() as { error: { code: string } }).error.code)
      .toBe("AGENT_NOT_RUNNABLE");

    const draft = await patch(inbound.conversationId, {
      attentionMode: "automatic",
      agentId: draftAgentId,
    });
    expect(draft.status).toBe(409);

    const foreign = await patch(inbound.conversationId, {
      attentionMode: "automatic",
      agentId: crypto.randomUUID(),
    });
    expect(foreign.status).toBe(409);

    expect(await conversationRow(inbound.conversationId)).toMatchObject({
      attention_mode: "human",
      agent_id: null,
    });

    // `supervised` sigue reservado: el corte no lo habilita.
    const supervised = await patch(inbound.conversationId, {
      attentionMode: "supervised",
      agentId,
    });
    expect(supervised.status).toBe(400);
  });

  it("conserva el agente al devolver la conversación al equipo", async () => {
    const { conversationId } = await automaticConversation({
      external: "handoff",
    });
    expect(await conversationRow(conversationId)).toMatchObject({
      attention_mode: "automatic",
      agent_id: agentId,
    });

    const back = await patch(conversationId, { attentionMode: "human" });
    expect(back.status).toBe(200);
    expect(await conversationRow(conversationId)).toMatchObject({
      attention_mode: "human",
      agent_id: agentId,
    });

    // Una conversación que ya no responde sola no ejecuta ninguna corrida.
    const provider = providerReturning("No debería responder.");
    const message = await env.DB.prepare(
      `SELECT id FROM messages WHERE conversation_id = ? AND direction = 'incoming'`,
    ).bind(conversationId).first<{ id: string }>();
    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      {
        organizationId,
        conversationId,
        triggerMessageId: message!.id,
      },
    );
    expect(outcome).toEqual({
      result: "not_applicable",
      reason: "NOT_AUTOMATIC",
    });
    expect(provider.requests).toHaveLength(0);
  });
});
