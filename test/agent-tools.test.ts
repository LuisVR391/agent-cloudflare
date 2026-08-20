import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it, vi } from "vitest";

import { executeAgentRun } from "../src/worker/agents/agent-run";
import {
  MODEL_REPLY_MAX_CHARACTERS,
  type ModelProvider,
  type ModelReply,
  type ModelRequest,
} from "../src/worker/agents/model-provider";
import { createModelProvider } from "../src/worker/agents/workers-ai-provider";
import type { OutboundQueueMessage } from "../src/worker/integrations/zernio/contracts";
import { AgentRunRepository } from "../src/worker/repositories/agent-run-repository";
import { ConversationRepository } from "../src/worker/repositories/conversation-repository";
import { ServiceRepository } from "../src/worker/repositories/service-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón con Herramientas",
  organizationSlug: "salon-con-herramientas",
  ownerName: "Ana Propietaria",
  ownerEmail: "owner-agent-tools@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

const otherOrganizationId = "99999999-9999-4999-8999-999999999999";
const model = "@cf/meta/llama-3.3-70b-instruct-fp8-fast";

/** Nombres y números que solo existen aquí: si aparecen en la traza, se ven. */
const serviceName = "Balayage de firma";
const foreignServiceName = "Servicio de otra empresa";
const contactExternalId = "wa-5215500000001";

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

/**
 * Proveedor de prueba: graba cada `ModelRequest` y devuelve el guion que se le
 * dio, una respuesta por llamada. Ninguna corrida de esta suite habla con un
 * modelo real, así que lo que se verifica es el contrato del backend.
 */
function providerScripted(...replies: ModelReply[]): ModelProvider & {
  requests: ModelRequest[];
} {
  const requests: ModelRequest[] = [];
  return {
    requests,
    async generate(request) {
      requests.push(request);
      const reply = replies[requests.length - 1];
      if (reply === undefined) {
        throw new Error(
          `El guion tiene ${replies.length} respuestas y se pidió la ${requests.length}.`,
        );
      }
      return reply;
    },
  };
}

/**
 * Lo que el binding de inferencia recibe y devuelve, en su forma cruda. El
 * `ModelProvider` de prueba entrega un `ModelReply` ya construido y se salta la
 * traducción entera; con un binding falso se ejercita lo que existe en
 * producción entre el modelo y la corrida: el anuncio de las funciones, el
 * turno `tool` de la segunda vuelta y la validación de la salida.
 */
type BindingInput = {
  messages: { role: string; content: string; name?: string }[];
  max_tokens: number;
  tools?: { type: string; function: { name: string } }[];
};

function bindingScripted(...outputs: unknown[]): {
  inputs: BindingInput[];
  run(model: string, input: BindingInput): Promise<unknown>;
} {
  const inputs: BindingInput[] = [];
  return {
    inputs,
    async run(_model, input) {
      inputs.push(input);
      const output = outputs[inputs.length - 1];
      if (output === undefined) {
        throw new Error(
          `El guion tiene ${outputs.length} salidas y se pidió la ${inputs.length}.`,
        );
      }
      return output;
    },
  };
}

/**
 * Las salidas crudas que `@cf/meta/llama-3.3-70b-instruct-fp8-fast` devolvió el
 * 2026-08-20 en una corrida real con las dos herramientas anunciadas. Se copian
 * verbatim porque la suite pasaba con formas inventadas mientras la corrida
 * real fallaba: ninguna de las que se guionizaron coincidía con esta.
 *
 * Lo relevante es dónde llega la petición. El proveedor la deja unas veces en
 * `tool_calls` y otras en `response`, ya deserializada, cuando el modelo la
 * escribió como contenido; y en el segundo caso `tool_calls` llega vacío y
 * `finish_reason` es `stop`, indistinguible de una respuesta de texto si solo
 * se mira el nombre del campo.
 */
const WORKERS_AI_ENVELOPE = {
  created: 1787209846,
  ec_transfer_params: null,
  id: "chatcmpl-ee221dda-2da0-4081-929e-1ee03ee17d85",
  kv_transfer_params: null,
  metrics: null,
  model: "@cf/meta/llama-3.3-70b-json",
  object: "chat.completion",
  prompt_logprobs: null,
  prompt_text: null,
  prompt_token_ids: null,
  service_tier: null,
  usage: {
    prompt_tokens: 507,
    completion_tokens: 22,
    total_tokens: 529,
    prompt_tokens_details: { cached_tokens: 0 },
    neurons: 18.026226043701172,
  },
};

/** La forma que rompía la corrida: la petición viaja dentro de `response`. */
const WORKERS_AI_TOOL_CALL_IN_RESPONSE = {
  ...WORKERS_AI_ENVELOPE,
  choices: [
    {
      finish_reason: "stop",
      index: 0,
      logprobs: null,
      message: {
        annotations: null,
        audio: null,
        content:
          '{"type": "function", "function": {"name": "list_services", "parameters": {}}}',
        function_call: null,
        reasoning: null,
        refusal: null,
        role: "assistant",
      },
      routed_experts: null,
      stop_reason: 128008,
      token_ids: null,
    },
  ],
  response: { function: { name: "list_services", parameters: {} }, type: "function" },
  tool_calls: [],
};

/** La forma que el proveedor sí reconoce, en la misma corrida. */
const WORKERS_AI_TOOL_CALL_IN_TOOL_CALLS = {
  ...WORKERS_AI_ENVELOPE,
  choices: [
    {
      finish_reason: "tool_calls",
      index: 0,
      logprobs: null,
      message: {
        annotations: null,
        audio: null,
        content: null,
        function_call: null,
        reasoning: null,
        refusal: null,
        role: "assistant",
        tool_calls: [
          {
            function: { arguments: "{}", name: "list_services" },
            id: "chatcmpl-tool-a516d2e1197b3125",
            type: "function",
          },
        ],
      },
      routed_experts: null,
      stop_reason: 128008,
      token_ids: null,
    },
  ],
  response: null,
  tool_calls: [{ arguments: {}, name: "list_services" }],
};

/**
 * La misma forma reconocida, con la función que se le pida. Sirve para el
 * modelo que pide una herramienta que **no** se le anunció: el nombre pasa la
 * validación del proveedor —es un identificador acotado— y quién decide el
 * rechazo es el conjunto anunciado, ya dentro de la corrida.
 */
function workersAiToolCall(name: string) {
  const [choice] = WORKERS_AI_TOOL_CALL_IN_TOOL_CALLS.choices;
  return {
    ...WORKERS_AI_TOOL_CALL_IN_TOOL_CALLS,
    choices: [
      {
        ...choice,
        message: {
          ...choice.message,
          tool_calls: choice.message.tool_calls.map((toolCall) => ({
            ...toolCall,
            function: { ...toolCall.function, name },
          })),
        },
      },
    ],
    tool_calls: [{ arguments: {}, name }],
  };
}

/** La respuesta de texto, que el proveedor solo da si no se anuncian tools. */
function workersAiText(text: string) {
  return {
    ...WORKERS_AI_ENVELOPE,
    choices: [
      {
        finish_reason: "stop",
        index: 0,
        logprobs: null,
        message: {
          annotations: null,
          audio: null,
          content: text,
          function_call: null,
          reasoning: null,
          refusal: null,
          role: "assistant",
        },
        routed_experts: null,
        stop_reason: 128008,
        token_ids: null,
      },
    ],
    response: text,
    tool_calls: [],
  };
}

/** Lo que el modelo pide, en la forma que el contrato ya normalizó. */
function callTo(name: string, args: unknown = {}): ModelReply {
  return {
    kind: "toolCalls",
    calls: [{ id: `call-${name}`, name, arguments: args }],
  };
}

function queueRecording() {
  return {
    send: vi.fn(async (_message: OutboundQueueMessage) => undefined),
  };
}

describe.sequential("herramientas autorizadas del agente", () => {
  let sessionCookie: string;
  let organizationId: string;
  let membershipId: string;
  let channelId: string;
  /** Declara `list_services`. */
  let servicesAgentId: string;
  /** Declara las dos herramientas del catálogo. */
  let fullAgentId: string;
  /** Declara `list_services` y una clave que el catálogo no reconoce. */
  let legacyAgentId: string;
  /** No declara ninguna. */
  let bareAgentId: string;
  let serviceId: string;

  const call = (path: string, init: RequestInit = {}) =>
    fetchWorker(path, {
      ...init,
      headers: {
        "Content-Type": "application/json",
        cookie: sessionCookie,
        ...(init.headers ?? {}),
      },
    });

  /** Crea el agente por el camino real y publica su primera versión. */
  async function createAgent(name: string, tools: string[]): Promise<string> {
    const created = await call("/api/agents", {
      method: "POST",
      body: JSON.stringify({ name }),
    });
    const { agent } = (await created.json()) as {
      agent: { id: string; version: number };
    };
    const version = await call(`/api/agents/${agent.id}/versions`, {
      method: "POST",
      body: JSON.stringify({
        expectedVersion: agent.version,
        instructions: "Atiende con calidez y agenda citas del salón.",
        model,
        tools,
      }),
    });
    expect(version.status).toBe(201);
    const detail = (await version.json()) as {
      agent: { version: number; versions: { id: string }[] };
    };
    const published = await call(`/api/agents/${agent.id}/publication`, {
      method: "PUT",
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
    agent: string;
    text?: string;
  }): Promise<{
    conversationId: string;
    messageId: string;
    contactId: string;
    correlationId: string;
  }> {
    const correlationId = crypto.randomUUID();
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId,
      channelId,
      externalConversationId: `z-${input.external}`,
      externalContactId:
        input.external === "propia" ? contactExternalId : `wa-${input.external}`,
      externalMessageId: `m-${input.external}`,
      platformMessageId: `wamid-${input.external}`,
      text: input.text ?? "¿Qué servicios tienen?",
      messageType: "text",
      occurredAt: "2026-08-19T10:00:00.000Z",
      correlationId,
    });
    const version = await env.DB.prepare(
      "SELECT version FROM conversations WHERE id = ?",
    ).bind(inbound.conversationId).first<{ version: number }>();
    const activated = await call(`/api/conversations/${inbound.conversationId}`, {
      method: "PATCH",
      body: JSON.stringify({
        expectedVersion: version!.version,
        attentionMode: "automatic",
        agentId: input.agent,
      }),
    });
    expect(activated.status).toBe(200);
    const conversation = await env.DB.prepare(
      "SELECT contact_id FROM conversations WHERE id = ?",
    ).bind(inbound.conversationId).first<{ contact_id: string }>();
    return {
      conversationId: inbound.conversationId,
      messageId: inbound.messageId,
      contactId: conversation!.contact_id,
      correlationId,
    };
  }

  function toolCallRows(runId: string) {
    return env.DB.prepare(
      `SELECT id, organization_id, run_id, sequence, tool_key, result,
              failure_code, correlation_id, occurred_at
         FROM agent_tool_calls
        WHERE organization_id = ? AND run_id = ?
        ORDER BY sequence`,
    ).bind(organizationId, runId).all<Record<string, unknown>>();
  }

  function toolAuditRows(correlationId: string) {
    return env.DB.prepare(
      `SELECT id, organization_id, actor_type, actor_id, action, resource_type,
              resource_id, result, correlation_id, occurred_at
         FROM audit_logs
        WHERE correlation_id = ? AND action = 'conversation.agent.tool'
        ORDER BY occurred_at, id`,
    ).bind(correlationId).all<Record<string, unknown>>();
  }

  function outgoingMessages(conversationId: string) {
    return env.DB.prepare(
      `SELECT id, text_content, status FROM messages
        WHERE conversation_id = ? AND direction = 'outgoing'`,
    ).bind(conversationId).all<{ id: string; text_content: string }>();
  }

  async function runIdOf(messageId: string): Promise<string> {
    const run = await new AgentRunRepository(env.DB).findByTriggerMessage(
      organizationId,
      messageId,
    );
    return run!.id;
  }

  async function seedService(input: {
    organizationId: string;
    name: string;
    durationMinutes: number;
    priceAmountCents: number | null;
    status?: "active" | "archived";
  }): Promise<string> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO services
      (id, organization_id, name, normalized_name, duration_minutes,
       price_amount_cents, price_currency, status, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        input.organizationId,
        input.name,
        input.name.toLocaleLowerCase("es"),
        input.durationMinutes,
        input.priceAmountCents,
        input.priceAmountCents === null ? null : "MXN",
        input.status ?? "active",
        now,
        now,
      ).run();
    return id;
  }

  async function seedAppointment(input: {
    contactId: string;
    startsAt: string;
    status: string;
  }): Promise<string> {
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    await env.DB.prepare(`INSERT INTO appointments
      (id, organization_id, contact_id, service_id, starts_at, ends_at, status,
       created_by_membership_id, created_at, updated_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
      .bind(
        id,
        organizationId,
        input.contactId,
        serviceId,
        input.startsAt,
        new Date(Date.parse(input.startsAt) + 3_600_000).toISOString(),
        input.status,
        membershipId,
        now,
        now,
      ).run();
    return id;
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

    const membership = await env.DB.prepare(
      `SELECT id FROM memberships WHERE organization_id = ?`,
    ).bind(organizationId).first<{ id: string }>();
    membershipId = membership!.id;

    const now = new Date().toISOString();
    channelId = crypto.randomUUID();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, 'otro-salon-tools', 'Otro salón', 'active', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', 'account-tools', 'active', ?, ?)`)
        .bind(channelId, organizationId, now, now),
    ]);

    serviceId = await seedService({
      organizationId,
      name: serviceName,
      durationMinutes: 120,
      priceAmountCents: 185_000,
    });
    await seedService({
      organizationId,
      name: "Corte retirado",
      durationMinutes: 30,
      priceAmountCents: 40_000,
      status: "archived",
    });
    // El catálogo de la organización ajena, que ninguna corrida de esta debe
    // ver.
    await seedService({
      organizationId: otherOrganizationId,
      name: foreignServiceName,
      durationMinutes: 60,
      priceAmountCents: 999_900,
    });

    servicesAgentId = await createAgent("Catálogo", ["list_services"]);
    fullAgentId = await createAgent("Recepción", [
      "list_services",
      "get_own_appointment",
    ]);
    bareAgentId = await createAgent("Sin herramientas", []);
    legacyAgentId = await createAgent("Heredado", ["list_services"]);

    // Una declaración escrita cuando el campo era texto libre: la versión ya
    // está publicada y es inmutable, así que la fila entra directo, como
    // existiría en una base real.
    const legacyVersion = await env.DB.prepare(
      `SELECT id FROM agent_versions
        WHERE organization_id = ? AND agent_id = ? AND status = 'published'`,
    ).bind(organizationId, legacyAgentId).first<{ id: string }>();
    await env.DB.prepare(`INSERT INTO agent_version_tools
      (organization_id, agent_version_id, tool_key, declared_at)
      VALUES (?, ?, 'agenda.crear', ?)`)
      .bind(organizationId, legacyVersion!.id, now).run();
  });

  it("anuncia al modelo la herramienta que la versión publicada declaró", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "anuncia",
      agent: servicesAgentId,
    });
    const provider = providerScripted({ kind: "text", text: "Con gusto." });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    const [request] = provider.requests;
    expect(request.tools).toEqual([
      {
        name: "list_services",
        description: expect.stringContaining("servicios activos del salón"),
        parameters: { type: "object", properties: {}, required: [] },
      },
    ]);
    // El marco se acota a lo que sí puede consultar, y conserva la prohibición
    // sobre lo que ninguna herramienta expone.
    expect(request.instructions).toContain("Consulta con las herramientas");
    expect(request.instructions).toContain("No afirmes horarios de atención");
  });

  it("no anuncia herramientas a una versión que no declaró ninguna", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "sin-declarar",
      agent: bareAgentId,
    });
    const provider = providerScripted({ kind: "text", text: "Lo consulto." });

    await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    const [request] = provider.requests;
    expect(request.tools).toBeUndefined();
    expect(request.instructions).toContain("No afirmes servicios, precios");
    expect(request.instructions).not.toContain("Consulta con las herramientas");
  });

  it("ignora una clave declarada que el catálogo no reconoce", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "heredada",
      agent: legacyAgentId,
    });
    const provider = providerScripted({ kind: "text", text: "Enseguida." });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    // La corrida continúa con la herramienta que sí existe.
    expect(outcome.result).toBe("succeeded");
    expect(provider.requests[0].tools?.map((tool) => tool.name)).toEqual([
      "list_services",
    ]);
    // No hubo intento del modelo, así que no hay fila que registrar.
    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results).toHaveLength(0);
  });

  it("ejecuta la herramienta, responde con su resultado y cierra la corrida", async () => {
    const { conversationId, messageId, correlationId } =
      await automaticConversation({
        external: "ejecuta",
        agent: servicesAgentId,
      });
    const provider = providerScripted(
      callTo("list_services"),
      { kind: "text", text: `El ${serviceName} dura 2 horas.` },
    );
    const outbound = queueRecording();

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    // La segunda llamada lleva el resultado de la herramienta, con el catálogo
    // real de la organización de la corrida.
    const second = provider.requests[1];
    const toolTurn = second.turns.at(-1);
    expect(toolTurn).toMatchObject({ role: "tool", name: "list_services" });
    expect(JSON.parse((toolTurn as { content: string }).content)).toEqual({
      services: [
        {
          name: serviceName,
          durationMinutes: 120,
          price: "1850.00 MXN",
        },
      ],
    });

    const messages = await outgoingMessages(conversationId);
    expect(messages.results).toHaveLength(1);
    expect(messages.results[0].text_content).toContain(serviceName);
    expect(outbound.send).toHaveBeenCalledTimes(1);

    const runId = await runIdOf(messageId);
    const status = await env.DB.prepare(
      `SELECT status, failure_code FROM agent_runs WHERE id = ?`,
    ).bind(runId).first<{ status: string; failure_code: string | null }>();
    expect(status).toEqual({ status: "succeeded", failure_code: null });

    const rows = await toolCallRows(runId);
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      run_id: runId,
      sequence: 1,
      tool_key: "list_services",
      result: "succeeded",
      failure_code: null,
      correlation_id: correlationId,
    });
    const audit = await toolAuditRows(correlationId);
    expect(audit.results).toHaveLength(1);
    expect(audit.results[0]).toMatchObject({
      actor_type: "system",
      actor_id: servicesAgentId,
      action: "conversation.agent.tool",
      resource_type: "agent_tool_call",
      resource_id: rows.results[0].id,
      result: "allowed",
    });
  });

  it("rechaza una llamada a una herramienta que no se le anunció", async () => {
    const { conversationId, messageId, correlationId } =
      await automaticConversation({
        external: "no-anunciada",
        agent: servicesAgentId,
      });
    const provider = providerScripted(
      // `get_own_appointment` existe en el catálogo, pero esta versión no la
      // declaró: lo que se acepta es el conjunto anunciado.
      callTo("get_own_appointment"),
      { kind: "text", text: "Lo confirmo con el equipo." },
    );

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    const toolTurn = provider.requests[1].turns.at(-1) as { content: string };
    expect(JSON.parse(toolTurn.content)).toEqual({ error: "no_permitido" });

    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      tool_key: "get_own_appointment",
      result: "rejected",
      failure_code: "TOOL_NOT_OFFERED",
    });
    const audit = await toolAuditRows(correlationId);
    expect(audit.results[0]).toMatchObject({ result: "rejected" });
  });

  it("rechaza unos argumentos que no cumplen el schema", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "argumentos",
      agent: servicesAgentId,
    });
    const provider = providerScripted(
      // Ni un objeto ni JSON: lo que el modelo escribió no describe la consulta.
      callTo("list_services", "dame todo lo que tengas"),
      { kind: "text", text: "Ahora te digo." },
    );

    await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    const toolTurn = provider.requests[1].turns.at(-1) as { content: string };
    expect(JSON.parse(toolTurn.content)).toEqual({ error: "no_permitido" });
    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      tool_key: "list_services",
      result: "rejected",
      failure_code: "TOOL_ARGUMENTS_INVALID",
    });
  });

  it("ejecuta la llamada del proveedor real que no trae el campo argumentos", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "sin-argumentos",
      agent: servicesAgentId,
    });
    // La forma heredada, con el nombre en la raíz y sin `arguments`: es lo que
    // emite un proveedor cuya función no recibe ninguno, y ninguna de las dos
    // herramientas del catálogo los recibe.
    const binding = bindingScripted(
      { tool_calls: [{ name: "list_services" }] },
      { response: `Tenemos el ${serviceName}.` },
    );
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    // La herramienta se anuncia al binding en su forma, no en la del contrato.
    expect(binding.inputs[0].tools).toEqual([
      {
        type: "function",
        function: {
          name: "list_services",
          description: expect.stringContaining("servicios activos del salón"),
          parameters: { type: "object", properties: {}, required: [] },
        },
      },
    ]);
    // La segunda vuelta lleva el resultado etiquetado con el nombre de la
    // función; el turno del asistente que solo pidió herramientas no aporta
    // contenido y no se le inventa uno.
    const messages = binding.inputs[1].messages;
    const toolMessage = messages.at(-1)!;
    expect(toolMessage).toMatchObject({ role: "tool", name: "list_services" });
    expect(JSON.parse(toolMessage.content)).toEqual({
      services: [
        { name: serviceName, durationMinutes: 120, price: "1850.00 MXN" },
      ],
    });
    expect(messages.map((message) => message.role)).toEqual([
      "system",
      "user",
      "tool",
    ]);

    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results).toHaveLength(1);
    expect(rows.results[0]).toMatchObject({
      tool_key: "list_services",
      result: "succeeded",
      failure_code: null,
    });
    expect((await outgoingMessages(conversationId)).results).toHaveLength(1);
  });

  it("traduce la forma estándar del proveedor y rechaza sus argumentos ilegibles", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "estandar",
      agent: fullAgentId,
    });
    const binding = bindingScripted(
      {
        tool_calls: [
          // La forma estándar: función anidada y argumentos como texto JSON.
          { id: "call-1", function: { name: "list_services", arguments: "{}" } },
          // Sin argumentos que transportar, el proveedor puede emitir `null`.
          {
            id: "call-2",
            function: { name: "get_own_appointment", arguments: null },
          },
          // Un texto que no es JSON no se corrige ni se completa: se conserva
          // para que el schema del catálogo lo rechace, en vez de invalidar la
          // respuesta entera y perder las dos llamadas buenas.
          {
            id: "call-3",
            function: { name: "list_services", arguments: "dame todo" },
          },
        ],
      },
      { response: "Eso ofrecemos." },
    );
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    const resultados = binding.inputs[1].messages.slice(-3);
    expect(resultados.map((message) => message.name)).toEqual([
      "list_services",
      "get_own_appointment",
      "list_services",
    ]);
    expect(JSON.parse(resultados[1].content)).toEqual({ appointment: null });
    expect(JSON.parse(resultados[2].content)).toEqual({
      error: "no_permitido",
    });

    const rows = await toolCallRows(await runIdOf(messageId));
    expect(
      rows.results.map((row) => [row.result, row.failure_code]),
    ).toEqual([
      ["succeeded", null],
      ["succeeded", null],
      ["rejected", "TOOL_ARGUMENTS_INVALID"],
    ]);
  });

  it("recorre la corrida con las tres salidas reales de Workers AI", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "forma-real",
      agent: servicesAgentId,
      text: "¿Cuánto cuesta el balayage?",
    });
    const binding = bindingScripted(
      WORKERS_AI_TOOL_CALL_IN_RESPONSE,
      WORKERS_AI_TOOL_CALL_IN_TOOL_CALLS,
      workersAiText(`El ${serviceName} cuesta 1850.00 MXN y dura 120 minutos.`),
    );
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    // Las dos primeras llamadas anuncian la herramienta; la tercera ya no tiene
    // ronda con la que ejecutar nada, y anunciarla solo pediría una salida que
    // la corrida no podría honrar.
    expect(binding.inputs[0].tools).toHaveLength(1);
    expect(binding.inputs[1].tools).toHaveLength(1);
    expect(binding.inputs[2].tools).toBeUndefined();
    // El precio real del servicio llega al modelo por el turno `tool`.
    const resultado = binding.inputs[2].messages.at(-1)!;
    expect(resultado).toMatchObject({ role: "tool", name: "list_services" });
    expect(JSON.parse(resultado.content)).toEqual({
      services: [
        { name: serviceName, durationMinutes: 120, price: "1850.00 MXN" },
      ],
    });

    const rows = await toolCallRows(await runIdOf(messageId));
    expect(
      rows.results.map((row) => [row.sequence, row.tool_key, row.result]),
    ).toEqual([
      [1, "list_services", "succeeded"],
      [2, "list_services", "succeeded"],
    ]);
    const salientes = await outgoingMessages(conversationId);
    expect(salientes.results).toHaveLength(1);
    expect(salientes.results[0].text_content).toContain("1850.00 MXN");
  });

  it("falla cerrado ante una salida real sin texto y sin petición", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "forma-real-vacia",
      agent: servicesAgentId,
    });
    // El sobre del proveedor, con la respuesta vacía y sin ninguna petición: no
    // hay nada que ejecutar ni nada que enviar. Una respuesta de texto vacía no
    // se rellena ni se convierte en otra cosa.
    const binding = bindingScripted({
      ...WORKERS_AI_ENVELOPE,
      response: "",
      tool_calls: [],
    });
    const provider = createModelProvider({ AI: binding });

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
    expect((await toolCallRows(await runIdOf(messageId))).results)
      .toHaveLength(0);
    expect((await outgoingMessages(conversationId)).results).toHaveLength(0);
  });

  it("falla cerrado ante un contenido que no es texto ni petición", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "forma-real-ajena",
      agent: servicesAgentId,
    });
    // Un objeto en `response` solo se lee como petición si describe una: leer
    // cualquier otro como respuesta lo acabaría enviando a la clienta.
    const binding = bindingScripted({
      ...WORKERS_AI_ENVELOPE,
      response: { pensamiento: "no sé qué contestar" },
      tool_calls: [],
    });
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "failed",
      failureCode: "MODEL_OUTPUT_INVALID",
    });
    expect((await outgoingMessages(conversationId)).results).toHaveLength(0);
  });

  it("no envía a la clienta la petición que el proveedor dejó sin abrir", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "peticion-en-cadena",
      agent: servicesAgentId,
      text: "¿Cuánto cuesta el balayage?",
    });
    // El mismo contenido que el sobre medido trae en `choices[0].message
    // .content`, pero con `response` sin deserializar. Leerlo como respuesta
    // mandaría `{"type":"function",…}` a WhatsApp en vez de consultar.
    const escrita = WORKERS_AI_TOOL_CALL_IN_RESPONSE.choices[0].message.content;
    const binding = bindingScripted(
      { ...WORKERS_AI_ENVELOPE, response: escrita, tool_calls: [] },
      workersAiText(`El ${serviceName} cuesta 1850.00 MXN.`),
    );
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    // Lo primero es que la petición no acabe en WhatsApp: es el desenlace que
    // el corte existe para impedir.
    const salientes = await outgoingMessages(conversationId);
    expect(salientes.results).toHaveLength(1);
    expect(salientes.results[0].text_content).not.toContain("list_services");
    expect(salientes.results[0].text_content).not.toContain("function");
    // Y sigue el camino de la petición redactada, con los mismos límites y la
    // misma traza: es el mismo hecho por otro envoltorio.
    expect(outcome.result).toBe("succeeded");
    expect(salientes.results[0].text_content).toContain("1850.00 MXN");
    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results.map((row) => [row.tool_key, row.result])).toEqual([
      ["list_services", "succeeded"],
    ]);
  });

  it("envía intacta una respuesta legítima que empieza por llave", async () => {
    // La regla es estrecha a propósito: se rechaza lo que parsea **y** casa con
    // la forma de una petición. Un texto que parece un objeto —o que incluso lo
    // es— sigue siendo la respuesta del agente y viaja tal cual.
    const casos = [
      { external: "llave-json", text: '{"horario": "de 10 a 19"}' },
      { external: "llave-suelta", text: "{Hola! Te espero el jueves}" },
    ];
    for (const caso of casos) {
      const { conversationId, messageId } = await automaticConversation({
        external: caso.external,
        agent: bareAgentId,
      });
      const binding = bindingScripted(workersAiText(caso.text));
      const provider = createModelProvider({ AI: binding });

      const outcome = await executeAgentRun(
        { db: env.DB, provider, outbound: queueRecording() },
        { organizationId, conversationId, triggerMessageId: messageId },
      );

      expect(outcome.result).toBe("succeeded");
      const salientes = await outgoingMessages(conversationId);
      expect(salientes.results).toHaveLength(1);
      expect(salientes.results[0].text_content).toBe(caso.text);
    }
  });

  it("falla cerrado ante una respuesta más larga de lo que el canal acepta", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "forma-real-larga",
      agent: bareAgentId,
    });
    const binding = bindingScripted({
      ...WORKERS_AI_ENVELOPE,
      response: "a".repeat(MODEL_REPLY_MAX_CHARACTERS + 1),
      tool_calls: [],
    });
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    // No se recorta: un mensaje truncado hacia una clienta es peor que ninguno.
    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "failed",
      failureCode: "MODEL_OUTPUT_INVALID",
    });
    expect((await outgoingMessages(conversationId)).results).toHaveLength(0);
  });

  it("falla cerrado si el proveedor devuelve llamadas sin herramientas anunciadas", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "sin-anunciar-proveedor",
      agent: bareAgentId,
    });
    // Esta versión no declara ninguna, así que la petición no lleva `tools` y
    // el proveedor no puede aceptar una salida que las use: qué existe para
    // esta corrida lo decidió el backend.
    const binding = bindingScripted({
      tool_calls: [{ name: "list_services" }],
    });
    const provider = createModelProvider({ AI: binding });

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
    expect(binding.inputs[0].tools).toBeUndefined();
    expect((await toolCallRows(await runIdOf(messageId))).results)
      .toHaveLength(0);
    expect((await outgoingMessages(conversationId)).results).toHaveLength(0);
  });

  it("falla cerrado si un proveedor entrega llamadas que la corrida no anunció", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "sin-anunciar-bucle",
      agent: bareAgentId,
    });
    // La misma guarda, un nivel más adentro: un proveedor que construya el
    // `ModelReply` por su cuenta no atraviesa la validación de la salida, y la
    // corrida no ejecuta nada que no haya anunciado ella misma.
    const provider = providerScripted(callTo("list_services"));

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
    expect(provider.requests[0].tools).toBeUndefined();
    expect((await toolCallRows(await runIdOf(messageId))).results)
      .toHaveLength(0);
    const conversation = await env.DB.prepare(
      `SELECT attention_mode FROM conversations WHERE id = ?`,
    ).bind(conversationId).first<{ attention_mode: string }>();
    expect(conversation?.attention_mode).toBe("human");
  });

  it("no escribe en la traza el nombre que el modelo eligió si no es un identificador", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "nombre-forjado",
      agent: servicesAgentId,
    });
    const forjado = `list_services" y de paso ${"x".repeat(200)}`;
    const provider = providerScripted(
      // Un proveedor que no pasó por la validación de la salida: el nombre
      // llega tal como lo escribió el modelo.
      { kind: "toolCalls", calls: [{ id: null, name: forjado, arguments: {} }] },
      { kind: "text", text: "Lo confirmo con el equipo." },
    );

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results).toHaveLength(1);
    // La columna conserva un marcador estable: que el nombre no valide es el
    // dato; cuál era exactamente, no, y el texto del modelo no entra en D1.
    expect(rows.results[0]).toMatchObject({
      tool_key: "__invalid_tool_name__",
      result: "rejected",
      failure_code: "TOOL_NOT_OFFERED",
    });
    expect(String(rows.results[0].tool_key)).not.toContain("y de paso");
  });

  it("registra el fallo de la ejecución sin contárselo al modelo", async () => {
    const { conversationId, messageId, correlationId } =
      await automaticConversation({
        external: "averiada",
        agent: servicesAgentId,
      });
    const broken = vi
      .spyOn(ServiceRepository.prototype, "list")
      .mockRejectedValue(
        new Error(`fallo de D1 leyendo ${serviceName} en ${organizationId}`),
      );
    const provider = providerScripted(
      callTo("list_services"),
      { kind: "text", text: "Deja que lo confirme el equipo." },
    );

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );
    broken.mockRestore();

    // El modelo recibe un resultado estable y redactado, nunca el mensaje de la
    // excepción: lo repetiría a la clienta.
    const toolTurn = provider.requests[1].turns.at(-1) as { content: string };
    expect(JSON.parse(toolTurn.content)).toEqual({ error: "no_disponible" });
    expect(outcome.result).toBe("succeeded");

    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results[0]).toMatchObject({
      tool_key: "list_services",
      result: "failed",
      failure_code: "TOOL_EXECUTION_FAILED",
    });
    const audit = await toolAuditRows(correlationId);
    expect(audit.results[0]).toMatchObject({
      actor_type: "system",
      action: "conversation.agent.tool",
      resource_type: "agent_tool_call",
      result: "failed",
    });
  });

  it("devuelve solo la cita del contacto de esa conversación", async () => {
    const propia = await automaticConversation({
      external: "propia",
      agent: fullAgentId,
      text: "¿Cuándo es mi cita?",
    });
    const ajena = await automaticConversation({
      external: "vecina",
      agent: fullAgentId,
      text: "Hola",
    });
    const inTwoDays = new Date(Date.now() + 172_800_000).toISOString();
    const inFiveDays = new Date(Date.now() + 432_000_000).toISOString();
    const yesterday = new Date(Date.now() - 86_400_000).toISOString();
    await seedAppointment({
      contactId: propia.contactId,
      startsAt: inTwoDays,
      status: "confirmed",
    });
    // Una cita cancelada del mismo contacto no es «la próxima», y una del otro
    // contacto de la misma organización no es suya.
    await seedAppointment({
      contactId: propia.contactId,
      startsAt: yesterday,
      status: "cancelled",
    });
    await seedAppointment({
      contactId: ajena.contactId,
      startsAt: inFiveDays,
      status: "confirmed",
    });

    const provider = providerScripted(
      {
        kind: "toolCalls",
        calls: [
          // El modelo propone el contacto de la otra clienta. El schema es
          // estricto, así que la llamada no se degrada a una consulta limpia:
          // el argumento no llega al handler y el intento queda rechazado, que
          // es lo que lo distingue de una consulta normal en la traza.
          {
            id: "call-ajena",
            name: "get_own_appointment",
            arguments: { contactId: ajena.contactId },
          },
          // La misma herramienta como se pide bien: sin argumentos, porque el
          // sujeto sale del contexto de la corrida.
          { id: "call-propia", name: "get_own_appointment", arguments: {} },
        ],
      },
      { kind: "text", text: "Te esperamos." },
    );
    await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      {
        organizationId,
        conversationId: propia.conversationId,
        triggerMessageId: propia.messageId,
      },
    );

    const [inyectado, limpio] = provider.requests[1].turns.slice(-2) as {
      content: string;
    }[];
    expect(JSON.parse(inyectado.content)).toEqual({ error: "no_permitido" });
    // El identificador ajeno no cambia el dato devuelto: la consulta limpia
    // sigue devolviendo la cita del contacto de esta conversación, y la cita de
    // la otra clienta no aparece por ningún camino.
    expect(JSON.parse(limpio.content)).toEqual({
      appointment: {
        serviceName,
        startsAt: inTwoDays,
        endsAt: new Date(Date.parse(inTwoDays) + 3_600_000).toISOString(),
        status: "confirmed",
      },
    });
    expect(limpio.content).not.toContain(inFiveDays);

    const rows = await toolCallRows(await runIdOf(propia.messageId));
    expect(rows.results).toHaveLength(2);
    expect(rows.results[0]).toMatchObject({
      tool_key: "get_own_appointment",
      result: "rejected",
      failure_code: "TOOL_ARGUMENTS_INVALID",
    });
    expect(rows.results[1]).toMatchObject({
      tool_key: "get_own_appointment",
      result: "succeeded",
      failure_code: null,
    });
    // Cada intento deja su entrada, ligada a su fila: el rechazado y el limpio
    // no comparten evidencia.
    const audit = await toolAuditRows(propia.correlationId);
    expect(audit.results).toHaveLength(2);
    const auditadas = new Map(
      audit.results.map((row) => [row.resource_id, row.result]),
    );
    expect(auditadas.get(rows.results[0].id)).toBe("rejected");
    expect(auditadas.get(rows.results[1].id)).toBe("allowed");
  });

  it("no devuelve el catálogo de otra organización", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "aislada",
      agent: servicesAgentId,
    });
    const provider = providerScripted(
      callTo("list_services"),
      { kind: "text", text: "Eso ofrecemos." },
    );

    await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    const toolTurn = provider.requests[1].turns.at(-1) as { content: string };
    const { services } = JSON.parse(toolTurn.content) as {
      services: { name: string }[];
    };
    expect(services.map((service) => service.name)).toEqual([serviceName]);
    expect(toolTurn.content).not.toContain(foreignServiceName);
  });

  it("no conserva argumentos ni resultados en la traza ni en la auditoría", async () => {
    const { conversationId, messageId, correlationId } =
      await automaticConversation({
        external: "redactada",
        agent: fullAgentId,
        text: "¿Cuánto cuesta?",
      });
    const provider = providerScripted(
      {
        kind: "toolCalls",
        calls: [
          { id: "call-1", name: "list_services", arguments: {} },
          {
            id: "call-2",
            name: "get_own_appointment",
            // Con un argumento que arrastra lo que la clienta escribió.
            arguments: { nota: `${contactExternalId} pregunta por el retoque` },
          },
        ],
      },
      { kind: "text", text: "Con gusto." },
    );

    await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    const rows = await toolCallRows(await runIdOf(messageId));
    const audit = await toolAuditRows(correlationId);
    expect(rows.results).toHaveLength(2);
    expect(audit.results).toHaveLength(2);
    // Se recorren todas las columnas de ambas tablas: ni el nombre del
    // servicio, ni el identificador del contacto, ni la nota del modelo tienen
    // dónde quedarse.
    const stored = [...rows.results, ...audit.results]
      .flatMap((row) => Object.values(row))
      .map((value) => String(value))
      .join(" | ");
    expect(stored).not.toContain(serviceName);
    expect(stored).not.toContain(contactExternalId);
    expect(stored).not.toContain("retoque");
    expect(stored).not.toContain("1850.00");
  });

  it("responde igual cuando la organización no tiene servicios activos", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "vacia",
      agent: servicesAgentId,
    });
    await env.DB.prepare(
      `UPDATE services SET status = 'archived' WHERE organization_id = ?`,
    ).bind(organizationId).run();

    const provider = providerScripted(
      callTo("list_services"),
      { kind: "text", text: "Todavía no tengo el catálogo cargado." },
    );
    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    const toolTurn = provider.requests[1].turns.at(-1) as { content: string };
    expect(JSON.parse(toolTurn.content)).toEqual({ services: [] });
    expect(outcome.result).toBe("succeeded");
    const status = await env.DB.prepare(
      `SELECT status FROM agent_runs WHERE id = ?`,
    ).bind(await runIdOf(messageId)).first<{ status: string }>();
    expect(status?.status).toBe("succeeded");

    await env.DB.prepare(
      `UPDATE services SET status = 'active'
        WHERE organization_id = ? AND id = ?`,
    ).bind(organizationId, serviceId).run();
  });

  it("devuelve la conversación al equipo tras la tercera ronda de herramientas", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "rondas",
      agent: servicesAgentId,
    });
    // El proveedor real y las salidas crudas del modelo, no un `ModelReply` ya
    // construido: la tercera llamada va sin herramientas, así que atraviesa
    // `parseModelReply` con `toolsOffered: false` y es ahí donde se decide el
    // código. Guionizar la respuesta ya normalizada saltaba esa validación
    // entera y afirmaba un desenlace que el proveedor real no produce.
    const binding = bindingScripted(
      WORKERS_AI_TOOL_CALL_IN_TOOL_CALLS,
      WORKERS_AI_TOOL_CALL_IN_RESPONSE,
      // Sin herramientas anunciadas, este modelo vuelve a escribir la función
      // dentro del texto: es la avidez que motivó la última corrección.
      WORKERS_AI_TOOL_CALL_IN_RESPONSE,
    );
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    // Agotar el presupuesto de rondas y devolver basura son dos causas
    // distintas, y la traza tiene que distinguirlas: la corrida cierra con el
    // código del presupuesto y no con el de la salida inválida.
    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "failed",
      failureCode: "TOOL_ROUNDS_EXCEEDED",
      escalated: true,
    });
    const runId = await runIdOf(messageId);
    const run = await env.DB.prepare(
      `SELECT status, failure_code FROM agent_runs WHERE id = ?`,
    ).bind(runId).first<{ status: string; failure_code: string }>();
    expect(run).toMatchObject({
      status: "failed",
      failure_code: "TOOL_ROUNDS_EXCEEDED",
    });
    // Tres llamadas al modelo y dos rondas ejecutadas: la tercera no se
    // ejecuta, y esa tercera llamada no anuncia ninguna herramienta.
    expect(binding.inputs).toHaveLength(3);
    expect(binding.inputs[0].tools).toHaveLength(1);
    expect(binding.inputs[1].tools).toHaveLength(1);
    expect(binding.inputs[2].tools).toBeUndefined();
    const rows = await toolCallRows(runId);
    expect(rows.results.map((row) => row.sequence)).toEqual([1, 2]);
    expect((await outgoingMessages(conversationId)).results).toHaveLength(0);

    const conversation = await env.DB.prepare(
      `SELECT attention_mode FROM conversations WHERE id = ?`,
    ).bind(conversationId).first<{ attention_mode: string }>();
    expect(conversation?.attention_mode).toBe("human");
    const history = await env.DB.prepare(
      `SELECT previous_attention_mode, next_attention_mode
         FROM conversation_status_history
        WHERE conversation_id = ? AND actor_type = 'system'`,
    ).bind(conversationId).first<{
      previous_attention_mode: string;
      next_attention_mode: string;
    }>();
    expect(history).toEqual({
      previous_attention_mode: "automatic",
      next_attention_mode: "human",
    });
  });

  it("acota el marco del prompt a lo que cada llamada anuncia de verdad", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "marco-por-llamada",
      agent: servicesAgentId,
      text: "¿Cuánto cuesta el balayage?",
    });
    const binding = bindingScripted(
      WORKERS_AI_TOOL_CALL_IN_TOOL_CALLS,
      WORKERS_AI_TOOL_CALL_IN_TOOL_CALLS,
      workersAiText(`El ${serviceName} cuesta 1850.00 MXN.`),
    );
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    const marco = (index: number) => {
      const [system] = binding.inputs[index].messages;
      expect(system.role).toBe("system");
      return system.content;
    };
    // Mientras quede ronda, el marco invita a consultar.
    expect(marco(0)).toContain("Consulta con las herramientas");
    expect(marco(1)).toContain("Consulta con las herramientas");
    // La tercera no lleva herramientas, así que tampoco invita a usarlas: el
    // marco no puede empujar al modelo a pedir lo que ya no existe.
    expect(binding.inputs[2].tools).toBeUndefined();
    expect(marco(2)).not.toContain("Consulta con las herramientas");
    // Pero esa misma llamada trae el precio que la herramienta devolvió, así
    // que el marco no puede prohibir afirmarlo: sería darle el dato y la orden
    // de no usarlo en el mismo request. Pide responder con lo consultado.
    const resultado = binding.inputs[2].messages.at(-1)!;
    expect(resultado).toMatchObject({ role: "tool", name: "list_services" });
    expect(resultado.content).toContain("1850.00 MXN");
    expect(marco(2)).not.toContain("No afirmes servicios, precios");
    expect(marco(2)).toContain("lo que las herramientas ya te devolvieron");
    // Lo que ninguna herramienta expone conserva su prohibición en las tres
    // llamadas: ninguna ronda podía consultarlo (ADR-0017 §8).
    for (const index of [0, 1, 2]) {
      expect(marco(index)).toContain(
        "No afirmes horarios de atención, disponibilidad ni promociones",
      );
    }
    expect((await outgoingMessages(conversationId)).results).toHaveLength(1);
  });

  it("conserva la prohibición cuando las dos rondas se fueron en rechazos", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "marco-sin-datos",
      agent: servicesAgentId,
      text: "¿Cuánto cuesta el balayage?",
    });
    // El agente declara `list_services` y el modelo insiste con otra: existe en
    // el catálogo, pero esta versión no la declaró, así que no se le anunció y
    // no se ejecuta. Las dos rondas se gastan sin consultar nada.
    const binding = bindingScripted(
      workersAiToolCall("get_own_appointment"),
      workersAiToolCall("get_own_appointment"),
      workersAiText("Déjame confirmarlo con una persona del equipo."),
    );
    const provider = createModelProvider({ AI: binding });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome.result).toBe("succeeded");
    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results.map((row) => [row.result, row.failure_code])).toEqual([
      ["rejected", "TOOL_NOT_OFFERED"],
      ["rejected", "TOOL_NOT_OFFERED"],
    ]);

    // Lo que el hilo lleva a la tercera llamada no es un dato del negocio: son
    // dos errores redactados. No hay nada con lo que responder.
    expect(binding.inputs).toHaveLength(3);
    expect(binding.inputs[2].tools).toBeUndefined();
    const resultados = binding.inputs[2].messages.filter(
      (message) => message.role === "tool",
    );
    expect(resultados).toHaveLength(2);
    for (const resultado of resultados) {
      expect(JSON.parse(resultado.content)).toEqual({ error: "no_permitido" });
    }

    const marco = (index: number) => {
      const [system] = binding.inputs[index].messages;
      expect(system.role).toBe("system");
      return system.content;
    };
    // El marco de esa tercera llamada es el de siempre, entero: gastar el
    // presupuesto no es haber consultado, y levantar aquí la prohibición sobre
    // precios dejaría al agente inventándolos justo en la corrida que no
    // obtuvo ni un dato.
    expect(marco(2)).toContain("No afirmes servicios, precios");
    expect(marco(2)).not.toContain("lo que las herramientas ya te devolvieron");
    expect(marco(2)).not.toContain("Consulta con las herramientas");
    // Mientras quedaba ronda sí se invitaba a consultar: lo que cambia es el
    // desenlace de esta corrida, no la regla de las llamadas anteriores.
    expect(marco(0)).toContain("Consulta con las herramientas");
    expect(marco(1)).toContain("Consulta con las herramientas");
  });

  it("devuelve la conversación al equipo al pasarse del límite de llamadas", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "llamadas",
      agent: servicesAgentId,
    });
    const provider = providerScripted({
      kind: "toolCalls",
      calls: Array.from({ length: 5 }, (_value, index) => ({
        id: `call-${index}`,
        name: "list_services",
        arguments: {},
      })),
    });

    const outcome = await executeAgentRun(
      { db: env.DB, provider, outbound: queueRecording() },
      { organizationId, conversationId, triggerMessageId: messageId },
    );

    expect(outcome).toMatchObject({
      result: "unanswered",
      status: "failed",
      failureCode: "TOOL_CALL_LIMIT_EXCEEDED",
      escalated: true,
    });
    // No se ejecuta nada de la ronda que se pasa: la corrida ya no responde.
    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results).toHaveLength(0);
    const conversation = await env.DB.prepare(
      `SELECT attention_mode FROM conversations WHERE id = ?`,
    ).bind(conversationId).first<{ attention_mode: string }>();
    expect(conversation?.attention_mode).toBe("human");
  });

  it("no duplica la traza cuando el mismo mensaje dispara dos corridas", async () => {
    const { conversationId, messageId } = await automaticConversation({
      external: "concurrente",
      agent: servicesAgentId,
    });
    const provider = providerScripted(
      callTo("list_services"),
      { kind: "text", text: "Con gusto." },
    );
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
    const runs = await env.DB.prepare(
      `SELECT count(*) AS total FROM agent_runs WHERE trigger_message_id = ?`,
    ).bind(messageId).first<{ total: number }>();
    expect(runs?.total).toBe(1);
    const rows = await toolCallRows(await runIdOf(messageId));
    expect(rows.results).toHaveLength(1);
    expect((await outgoingMessages(conversationId)).results).toHaveLength(1);
  });
});
