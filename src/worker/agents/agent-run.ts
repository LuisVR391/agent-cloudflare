import type { ConversationMessage } from "../domain/types";
import type { OutboundQueueMessage } from "../integrations/zernio/contracts";
import { AgentRepository } from "../repositories/agent-repository";
import { AgentRunRepository } from "../repositories/agent-run-repository";
import { AgentToolCallRepository } from "../repositories/agent-tool-call-repository";
import { ConversationRepository } from "../repositories/conversation-repository";
import {
  MODEL_REPLY_MAX_CHARACTERS,
  ModelProviderError,
  parseModelToolName,
  type ModelFailureCode,
  type ModelProvider,
  type ModelReply,
  type ModelToolCall,
  type ModelTurn,
} from "./model-provider";
import {
  findAgentTool,
  toModelToolDeclaration,
  type AgentToolContext,
  type AgentToolDefinition,
} from "./tool-catalog";

/**
 * Ejecuta la versión publicada del agente dentro de una conversación y deja
 * traza de lo ocurrido (ADR-0015).
 *
 * Vive fuera del Durable Object para poder ejercitarse con un proveedor y una
 * cola de prueba: el runtime aporta serialización y bindings, no reglas.
 */

/**
 * Cuánto historial entra al contexto. Acotado a propósito: el modelo no
 * necesita la conversación entera para responder al último mensaje, y cada
 * turno adicional es coste y superficie.
 */
export const AGENT_RUN_CONTEXT_MESSAGES = 20;

/** Techo de la respuesta, coherente con el límite que valida la salida. */
export const AGENT_RUN_MAX_OUTPUT_TOKENS = 512;

/**
 * Rondas de herramientas por corrida. Dos permiten encadenar una consulta que
 * depende de otra, y son hasta tres llamadas al modelo por mensaje: a la
 * tercera petición, la conversación pasa al equipo en vez de seguir gastando.
 */
export const AGENT_RUN_MAX_TOOL_ROUNDS = 2;

/**
 * Techo duro de llamadas de la corrida entera. Sin él, una sola ronda con
 * veinte llamadas costaría lo mismo que veinte rondas.
 */
export const AGENT_RUN_MAX_TOOL_CALLS = 4;

/**
 * Lo que el modelo recibe cuando un intento no prospera. Es estable y
 * redactado: nunca un detalle interno, un identificador ni el mensaje de una
 * excepción, que el modelo repetiría a la clienta.
 */
const TOOL_RESULT_REJECTED = JSON.stringify({ error: "no_permitido" });
const TOOL_RESULT_FAILED = JSON.stringify({ error: "no_disponible" });

/**
 * Lo que queda en la traza cuando el nombre que el modelo dijo invocar no es un
 * identificador. Es estable y no viene del modelo: `agent_tool_calls.tool_key`
 * es evidencia de qué se intentó, no tiene cota de longitud en el esquema, y un
 * texto elegido por el modelo dentro de esa columna contaminaría la evidencia y
 * cualquier lectura posterior. Que el nombre no valide ya es el dato relevante;
 * cuál era exactamente, no.
 */
const TOOL_KEY_INVALID = "__invalid_tool_name__";

/**
 * Motivos propios de la corrida, además de los que declara el proveedor. Son
 * códigos estables: la traza, la auditoría y los logs conservan el código y
 * nunca el contenido que lo provocó.
 */
export type AgentRunFailureCode =
  | ModelFailureCode
  | "AGENT_NOT_RUNNABLE"
  | "UNSUPPORTED_MESSAGE_CONTENT"
  | "OUTBOUND_QUEUE_UNAVAILABLE"
  | "TOOL_ROUNDS_EXCEEDED"
  | "TOOL_CALL_LIMIT_EXCEEDED";

export type AgentRunOutcome =
  /** La conversación no responde sola, o el disparador ya tuvo su corrida. */
  | { result: "not_applicable"; reason: "NOT_AUTOMATIC" | "DUPLICATE_TRIGGER" }
  | { result: "succeeded"; runId: string; responseMessageId: string }
  | {
      result: "unanswered";
      status: "failed" | "skipped";
      runId: string | null;
      failureCode: AgentRunFailureCode;
      escalated: boolean;
    };

/**
 * La cola de salida, declarada por lo único que la corrida usa de ella. El
 * binding completo cumple esta forma, y una cola de prueba no necesita
 * implementar el resto para ejercitar la corrida.
 */
export type OutboundDispatcher = {
  send(
    message: OutboundQueueMessage,
    options?: { contentType?: "json" },
  ): Promise<unknown>;
};

export type AgentRunDependencies = {
  db: D1Database;
  /** Nulo cuando el entorno no declara inferencia; se registra y se escala. */
  provider: ModelProvider | null;
  /** La salida ya existente de Fase 1. No se abre un camino paralelo. */
  outbound: OutboundDispatcher | null;
};

/**
 * Un mensaje sin texto entra al contexto como marcador de lo que el contacto
 * envió. Su contenido vive en R2 con sus permisos, y la referencia temporal del
 * canal no sale de la recepción: nada de eso puede viajar a un proveedor.
 */
const contentMarkers: Record<string, string> = {
  image: "[el contacto envió una imagen]",
  video: "[el contacto envió un video]",
  audio: "[el contacto envió un audio]",
  file: "[el contacto envió un archivo]",
  sticker: "[el contacto envió un sticker]",
  share: "[el contacto compartió un contenido]",
  unsupported: "[el contacto envió un contenido no soportado]",
};

function toTurn(message: ConversationMessage): ModelTurn | null {
  const text = message.text?.trim();
  if (message.direction === "incoming") {
    return {
      role: "user",
      content:
        text ||
        contentMarkers[message.messageType] ||
        contentMarkers.unsupported,
    };
  }
  // Un saliente sin texto no existe hoy y no describe nada que el modelo pueda
  // continuar; omitirlo es más honesto que inventarle contenido.
  return text ? { role: "assistant", content: text } : null;
}

/**
 * Lo que ninguna herramienta del catálogo expone, y que por tanto el agente
 * sigue sin poder afirmar. Es la parte del marco que sobrevive a que queden
 * rondas o no: horarios de atención, disponibilidad y promociones no tienen
 * dueño en ningún esquema entregado, así que no hay ronda que pueda
 * consultarlos (ADR-0017 §8).
 */
const UNCONSULTABLE_RULE =
  `No afirmes horarios de atención, disponibilidad ni promociones: ninguna`
  + ` herramienta te los da y no puedes consultarlos. Si te los piden, dilo y`
  + ` ofrece que una persona del equipo lo confirme.`;

/**
 * En qué estado de herramientas llega la corrida a **esta** llamada. Son tres y
 * no dos, y confundir los dos últimos es lo que hacía que el modelo recibiera
 * el precio consultado y la orden de no afirmarlo en el mismo request:
 *
 * - `none`: esta corrida no consultó nada y ya no va a consultarlo. O no tenía
 *   ninguna herramienta autorizada, o las que tenía no devolvieron ni un
 *   resultado. En ambos casos el modelo está donde ha estado siempre —sin
 *   ningún dato del negocio—, y el marco conserva la prohibición entera.
 * - `offered`: esta llamada anuncia herramientas y queda ronda para ejecutarlas.
 * - `spent`: alguna herramienta ya devolvió resultado y no quedan rondas. Los
 *   resultados están en el hilo, así que prohibir afirmarlos sería pedirle que
 *   ignore lo que el propio backend le acaba de dar.
 *
 * El tercero lo elige haber **obtenido dato**, no haber gastado el presupuesto.
 * Un rechazo y un fallo dejan en el hilo un error redactado, que no es materia
 * con la que responder: elegir `spent` por haber gastado las rondas levantaría
 * la prohibición sobre precios justo en la corrida que no consultó nada.
 */
type ToolFraming = "none" | "offered" | "spent";

/**
 * El marco que el backend impone alrededor de las instrucciones publicadas. El
 * modelo no puede modificarlo: organización, conversación y límites los fija
 * quien llama, no lo que el contacto escriba.
 *
 * La segunda regla acota lo que el agente puede afirmar del negocio, y se acota
 * con lo que la corrida realmente puede consultar. Con herramientas anunciadas,
 * el catálogo y la cita del contacto dejan de ser materia de invención y pasan
 * a consultarse; lo que ninguna herramienta expone conserva su prohibición. Sin
 * herramientas autorizadas, la regla queda entera. No es un control de
 * seguridad —un prompt nunca lo es— sino la respuesta honesta a lo que el
 * agente no puede saber.
 *
 * Se construye **por llamada** y no una vez por corrida, porque lo que la
 * corrida puede consultar cambia dentro de ella: la llamada que ya no anuncia
 * ninguna herramienta tampoco puede invitar a usarlas, y la que ya recibió los
 * resultados tiene que responder con ellos (ADR-0017 §8).
 */
function buildInstructions(
  version: { instructions: string; playbook: string | null },
  options: { framing: ToolFraming },
): string {
  const businessRule: Record<ToolFraming, string> = {
    offered: `Consulta con las herramientas disponibles lo que necesites antes`
      + ` de responder, y responde con lo que devuelvan. ${UNCONSULTABLE_RULE}`,
    spent: `Responde ahora con lo que las herramientas ya te devolvieron en`
      + ` esta conversación: no queda ninguna consulta pendiente y no vas a`
      + ` recibir más resultados. ${UNCONSULTABLE_RULE}`,
    none: `No afirmes servicios, precios, promociones ni horarios disponibles que no`
      + ` estén escritos arriba: no puedes consultarlos. Si te los piden, dilo y`
      + ` ofrece que una persona del equipo lo confirme.`,
  };
  return [
    version.instructions,
    version.playbook ? `Playbook:\n${version.playbook}` : null,
    businessRule[options.framing],
    `Responde con un solo mensaje de WhatsApp, en el idioma del contacto y con`
      + ` un máximo de ${MODEL_REPLY_MAX_CHARACTERS} caracteres.`,
  ].filter((part): part is string => part !== null).join("\n\n");
}

/**
 * Qué declaró la versión publicada que no se le anunció al modelo, y por qué.
 * No hay fila en `agent_tool_calls` porque no hubo intento del modelo: es la
 * reconciliación entre declaraciones históricas y el catálogo vigente que
 * ADR-0014 dejó pendiente para este corte.
 */
function logDeclarationIgnored(fields: {
  reason: "UNKNOWN_TOOL" | "AUDIENCE_MISMATCH" | "SUBJECT_UNRESOLVED";
  toolKey: string;
  correlationId: string;
  conversationId: string;
  runId: string;
}): void {
  console.warn(
    JSON.stringify({ event: "agent.tool.declaration_ignored", ...fields }),
  );
}

function log(
  result: string,
  fields: {
    correlationId: string;
    conversationId: string;
    runId?: string | null;
    failureCode?: AgentRunFailureCode;
  },
): void {
  const payload = JSON.stringify({
    event: "agent.run",
    result,
    ...fields,
  });
  if (result === "succeeded") {
    console.info(payload);
    return;
  }
  console.error(payload);
}

export async function executeAgentRun(
  deps: AgentRunDependencies,
  input: {
    organizationId: string;
    conversationId: string;
    triggerMessageId: string;
  },
): Promise<AgentRunOutcome> {
  const conversations = new ConversationRepository(deps.db);
  const runs = new AgentRunRepository(deps.db);

  // La decisión de responder se lee de D1, no de la proyección del runtime: la
  // fuente de verdad del modo y del agente asignado es la conversación.
  const conversation = await conversations.find(
    input.organizationId,
    input.conversationId,
  );
  const trigger = await conversations.findMessage(
    input.organizationId,
    input.conversationId,
    input.triggerMessageId,
  );
  if (
    !conversation ||
    !trigger ||
    conversation.status !== "open" ||
    conversation.attentionMode !== "automatic" ||
    !conversation.agent
  ) {
    return { result: "not_applicable", reason: "NOT_AUTOMATIC" };
  }

  const agentId = conversation.agent.id;
  const correlationId = trigger.correlationId;

  const escalate = async (): Promise<boolean> =>
    conversations.escalateToHuman({
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      correlationId,
    });

  const version = await new AgentRepository(deps.db).findRunnableVersion(
    input.organizationId,
    agentId,
  );
  if (!version) {
    // Sin versión publicada no hay traza posible —una corrida sin versión no
    // explicaría con qué configuración se respondió—, así que el rastro queda
    // en la auditoría y la conversación vuelve al equipo.
    const escalated = await escalate();
    await runs.recordAudit({
      organizationId: input.organizationId,
      agentId,
      runId: null,
      result: "failed",
      correlationId,
    });
    log("unanswered", {
      correlationId,
      conversationId: input.conversationId,
      runId: null,
      failureCode: "AGENT_NOT_RUNNABLE",
    });
    return {
      result: "unanswered",
      status: "skipped",
      runId: null,
      failureCode: "AGENT_NOT_RUNNABLE",
      escalated,
    };
  }

  const runId = await runs.start({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    agentId,
    agentVersionId: version.versionId,
    triggerMessageId: input.triggerMessageId,
    correlationId,
    startedAt: new Date().toISOString(),
  });
  if (!runId) {
    return { result: "not_applicable", reason: "DUPLICATE_TRIGGER" };
  }

  const unanswered = async (
    status: "failed" | "skipped",
    failureCode: AgentRunFailureCode,
    responseMessageId?: string,
  ): Promise<AgentRunOutcome> => {
    await runs.close({
      organizationId: input.organizationId,
      runId,
      status,
      failureCode,
      finishedAt: new Date().toISOString(),
      responseMessageId,
    });
    const escalated = await escalate();
    await runs.recordAudit({
      organizationId: input.organizationId,
      agentId,
      runId,
      result: "failed",
      correlationId,
    });
    log("unanswered", {
      correlationId,
      conversationId: input.conversationId,
      runId,
      failureCode,
    });
    return { result: "unanswered", status, runId, failureCode, escalated };
  };

  // Un mensaje sin texto no se contesta a ciegas: alguien del equipo tiene que
  // mirar la imagen o escuchar el audio. Es la regla que el corte fija para lo
  // que no es texto, y por eso no llega a invocar al modelo.
  if (!trigger.text?.trim()) {
    return unanswered("skipped", "UNSUPPORTED_MESSAGE_CONTENT");
  }
  if (!deps.provider) {
    return unanswered("failed", "MODEL_UNAVAILABLE");
  }

  const history = await conversations.listMessages(
    input.organizationId,
    input.conversationId,
    { limit: AGENT_RUN_CONTEXT_MESSAGES },
  );
  const turns = history.messages
    .map(toTurn)
    .filter((turn): turn is ModelTurn => turn !== null);

  // La secuencia de autorización, en el orden de la guía §14.2: la organización
  // y la conversación salen del contexto de la corrida, el contacto se leyó en
  // D1, y solo entonces se mira qué declaró la versión publicada. Una clave que
  // el catálogo no reconoce no se anuncia y no deja fila: no hubo intento del
  // modelo, solo una declaración que dejó de existir.
  const offered: AgentToolDefinition[] = [];
  for (const declared of version.tools) {
    const ignored = (
      reason: "UNKNOWN_TOOL" | "AUDIENCE_MISMATCH" | "SUBJECT_UNRESOLVED",
    ) =>
      logDeclarationIgnored({
        reason,
        toolKey: declared,
        correlationId,
        conversationId: input.conversationId,
        runId,
      });

    const tool = findAgentTool(declared);
    if (tool === undefined) {
      ignored("UNKNOWN_TOOL");
      continue;
    }
    if (tool.audience !== "contact") {
      ignored("AUDIENCE_MISMATCH");
      continue;
    }
    // Sin contacto demostrado no hay sujeto al que acotar la consulta, así que
    // la herramienta no se anuncia: falla cerrada antes de existir. La columna
    // es obligatoria, y por eso mismo la comprobación es barata.
    if (!conversation.contactId) {
      ignored("SUBJECT_UNRESOLVED");
      continue;
    }
    offered.push(tool);
  }

  const declarations = offered.map(toModelToolDeclaration);
  const toolContext: AgentToolContext = {
    db: deps.db,
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    // El sujeto de la consulta es el contacto de esta conversación, leído en
    // D1. Ningún argumento del modelo lo sustituye.
    contactId: conversation.contactId,
    agentId,
    runId,
    correlationId,
  };
  const toolCalls = new AgentToolCallRepository(deps.db);

  /**
   * Ejecuta un intento y devuelve lo que el modelo recibirá. Cada rama deja su
   * fila y su entrada de auditoría antes de responder, incluidas las que no
   * ejecutan nada: un rechazo también es una decisión que alguien tiene que
   * poder revisar.
   *
   * `produced` distingue el contenido que trae datos del CRM del que solo trae
   * un error redactado. Lo necesita el marco de la última llamada, que no puede
   * invitar a responder «con lo que las herramientas devolvieron» cuando
   * ninguna devolvió nada.
   */
  const settleToolCall = async (
    call: ModelToolCall,
    sequence: number,
  ): Promise<{ content: string; produced: boolean }> => {
    const record = (
      result: "succeeded" | "rejected" | "failed",
      failureCode: string | null,
      toolKey: string,
    ) =>
      toolCalls.record({
        organizationId: input.organizationId,
        runId,
        agentId,
        sequence,
        // El nombre puede venir del modelo. `parseModelReply` ya lo valida del
        // lado del proveedor, pero el límite de confianza se aplica donde se
        // escribe: un proveedor que construya `ModelReply` por su cuenta no
        // pasa por esa validación, y esto es lo último antes de D1.
        toolKey: parseModelToolName(toolKey) ?? TOOL_KEY_INVALID,
        result,
        failureCode,
        correlationId,
      });

    // Lo que se acepta es el conjunto anunciado, no el catálogo: una
    // herramienta que existe pero que esta versión no declaró tampoco se
    // ejecuta.
    const tool = offered.find((candidate) => candidate.key === call.name);
    if (tool === undefined) {
      await record("rejected", "TOOL_NOT_OFFERED", call.name);
      return { content: TOOL_RESULT_REJECTED, produced: false };
    }
    // Ninguna herramienta del corte recibe argumentos, así que un proveedor que
    // omita el campo —o que lo emita como `null`— no está proponiendo nada
    // distinto de un objeto vacío, y la llamada es legítima. Lo que no se
    // completa es un argumento ausente de una herramienta que sí lo pida: el
    // schema estricto decide, no este operador.
    const args = tool.argsSchema.safeParse(call.arguments ?? {});
    if (!args.success) {
      // No se degrada ni se completa con valores por omisión: unos argumentos
      // que no validan —o una clave que la herramienta no declara— no describen
      // la consulta que se iba a hacer.
      await record("rejected", "TOOL_ARGUMENTS_INVALID", tool.key);
      return { content: TOOL_RESULT_REJECTED, produced: false };
    }
    try {
      const result = await tool.run(toolContext, args.data);
      await record("succeeded", null, tool.key);
      return { content: JSON.stringify(result), produced: true };
    } catch {
      // El detalle no viaja a ninguna parte: puede citar la consulta o la fila
      // que la produjo, y el modelo lo repetiría a la clienta.
      await record("failed", "TOOL_EXECUTION_FAILED", tool.key);
      console.error(JSON.stringify({
        event: "agent.tool",
        result: "failed",
        failureCode: "TOOL_EXECUTION_FAILED",
        toolKey: tool.key,
        correlationId,
        conversationId: input.conversationId,
        runId,
      }));
      return { content: TOOL_RESULT_FAILED, produced: false };
    }
  };

  let rounds = 0;
  let executed = 0;
  /**
   * Si alguna llamada de **esta** corrida devolvió datos del CRM. No lo dice
   * haber ejecutado ni haber gastado las rondas: un rechazo y un fallo también
   * empujan un turno `tool` al hilo, pero lo que llevan es un error redactado.
   */
  let produced = false;
  let reply: ModelReply;
  for (;;) {
    // Las herramientas se anuncian mientras quede una ronda para ejecutarlas.
    // Gastada la última, anunciarlas solo invita a una petición que la corrida
    // ya no puede honrar, y la conversación acabaría en el equipo sin haber
    // respondido nada. Es la misma regla de todo el corte —no se anuncia lo que
    // no se puede autorizar— aplicada un paso antes: la llamada que tiene que
    // responder se hace sin herramientas.
    const roundsSpent = rounds >= AGENT_RUN_MAX_TOOL_ROUNDS;
    const announced = roundsSpent ? [] : declarations;
    try {
      reply = await deps.provider.generate({
        model: version.model,
        // El marco se construye con lo que **esta** llamada anuncia de verdad:
        // pedirle que consulte con las herramientas disponibles en la llamada
        // que ya no lleva ninguna es empujarlo a pedir lo que no existe, y esa
        // petición cuesta la respuesta entera. Y la corrida que ya obtuvo el
        // dato lo tiene en el hilo: prohibirle afirmarlo sería darle el dato y
        // la orden de no usarlo en el mismo request.
        instructions: buildInstructions(version, {
          framing: announced.length > 0
            ? "offered"
            // Sin ronda que gastar, lo que decide es si alguna herramienta
            // devolvió algo. Una corrida cuyas llamadas se fueron todas en
            // rechazos o fallos no consultó nada —el hilo solo trae errores
            // redactados—, así que conserva el marco entero igual que la que
            // nunca tuvo herramientas autorizadas.
            : produced
              ? "spent"
              : "none",
        }),
        turns,
        maxOutputTokens: AGENT_RUN_MAX_OUTPUT_TOKENS,
        ...(announced.length === 0 ? {} : { tools: announced }),
      });
    } catch (caught) {
      // Pedir una herramienta en la llamada que fue sin ellas *porque la
      // corrida gastó sus rondas* no es una salida inválida: es la tercera
      // petición de ADR-0017 §7. El desenlace no cambia —falla cerrado, escala
      // y deja traza—, pero el código sí: quien lea la traza tiene que poder
      // distinguir un modelo que devolvió basura de uno que agotó su
      // presupuesto. Que la corrida no tuviera ninguna herramienta autorizada
      // sigue siendo salida inválida, y por eso se exige `offered`.
      if (
        caught instanceof ModelProviderError &&
        caught.reason === "TOOL_CALL_NOT_OFFERED" &&
        roundsSpent &&
        offered.length > 0
      ) {
        return unanswered("failed", "TOOL_ROUNDS_EXCEEDED");
      }
      const failureCode = caught instanceof ModelProviderError
        ? caught.code
        : "MODEL_UNAVAILABLE";
      return unanswered("failed", failureCode);
    }
    if (reply.kind === "text") break;

    // Una corrida sin ninguna herramienta autorizada no tiene nada que
    // ejecutar, venga la petición del proveedor que venga: es salida inválida y
    // no la tercera petición de una corrida que sí las tenía.
    if (offered.length === 0) {
      return unanswered("failed", "MODEL_OUTPUT_INVALID");
    }
    // La misma condición que dejó esta llamada sin herramientas, alcanzable
    // por un proveedor que construya la respuesta sin validar la salida.
    if (roundsSpent) {
      return unanswered("failed", "TOOL_ROUNDS_EXCEEDED");
    }
    if (executed + reply.calls.length > AGENT_RUN_MAX_TOOL_CALLS) {
      // Se corta antes de ejecutar nada de esta ronda: la corrida ya no va a
      // responder, y consultar por un resultado que nadie leerá es gasto.
      return unanswered("failed", "TOOL_CALL_LIMIT_EXCEEDED");
    }
    rounds += 1;
    turns.push({ role: "assistant", content: "", toolCalls: reply.calls });
    for (const call of reply.calls) {
      executed += 1;
      const settled = await settleToolCall(call, executed);
      produced ||= settled.produced;
      turns.push({
        role: "tool",
        name: call.name,
        toolCallId: call.id,
        content: settled.content,
      });
    }
  }

  // La respuesta viaja por la salida existente, con su clave de idempotencia:
  // el identificador de la corrida es estable, así que un reintento no produce
  // un segundo envío.
  const outgoing = await conversations.createOutgoing({
    organizationId: input.organizationId,
    conversationId: input.conversationId,
    actorId: agentId,
    senderType: "system",
    clientRequestId: runId,
    text: reply.text,
    correlationId,
  });

  try {
    if (!deps.outbound) throw new Error("OUTBOUND_QUEUE_MISSING");
    await deps.outbound.send({
      kind: "sendTextMessage",
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messageId: outgoing.messageId,
      correlationId: outgoing.correlationId,
    }, { contentType: "json" });
  } catch {
    await conversations.markEnqueueFailed(
      input.organizationId,
      outgoing.messageId,
    );
    return unanswered(
      "failed",
      "OUTBOUND_QUEUE_UNAVAILABLE",
      outgoing.messageId,
    );
  }

  await runs.complete({
    organizationId: input.organizationId,
    runId,
    responseMessageId: outgoing.messageId,
    finishedAt: new Date().toISOString(),
  });
  await runs.recordAudit({
    organizationId: input.organizationId,
    agentId,
    runId,
    result: "allowed",
    correlationId,
  });
  log("succeeded", {
    correlationId,
    conversationId: input.conversationId,
    runId,
  });
  return {
    result: "succeeded",
    runId,
    responseMessageId: outgoing.messageId,
  };
}
