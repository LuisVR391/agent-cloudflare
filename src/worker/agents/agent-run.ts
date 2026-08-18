import type { ConversationMessage } from "../domain/types";
import type { OutboundQueueMessage } from "../integrations/zernio/contracts";
import { AgentRepository } from "../repositories/agent-repository";
import { AgentRunRepository } from "../repositories/agent-run-repository";
import { ConversationRepository } from "../repositories/conversation-repository";
import {
  MODEL_REPLY_MAX_CHARACTERS,
  ModelProviderError,
  type ModelFailureCode,
  type ModelProvider,
  type ModelTurn,
} from "./model-provider";

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
 * Motivos propios de la corrida, además de los que declara el proveedor. Son
 * códigos estables: la traza, la auditoría y los logs conservan el código y
 * nunca el contenido que lo provocó.
 */
export type AgentRunFailureCode =
  | ModelFailureCode
  | "AGENT_NOT_RUNNABLE"
  | "UNSUPPORTED_MESSAGE_CONTENT"
  | "OUTBOUND_QUEUE_UNAVAILABLE";

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

export type AgentRunDependencies = {
  db: D1Database;
  /** Nulo cuando el entorno no declara inferencia; se registra y se escala. */
  provider: ModelProvider | null;
  /** La salida ya existente de Fase 1. No se abre un camino paralelo. */
  outbound: Queue<OutboundQueueMessage> | null;
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
  const role = message.direction === "incoming" ? "user" : "assistant";
  const text = message.text?.trim();
  if (text) return { role, content: text };
  // Un saliente sin texto no existe hoy y no describe nada que el modelo pueda
  // continuar; omitirlo es más honesto que inventarle contenido.
  if (message.direction !== "incoming") return null;
  return {
    role,
    content: contentMarkers[message.messageType] ?? contentMarkers.unsupported,
  };
}

/**
 * El marco que el backend impone alrededor de las instrucciones publicadas. El
 * modelo no puede modificarlo: organización, conversación y límites los fija
 * quien llama, no lo que el contacto escriba.
 */
function buildInstructions(version: {
  instructions: string;
  playbook: string | null;
}): string {
  return [
    version.instructions,
    version.playbook ? `Playbook:\n${version.playbook}` : null,
    `Responde con un solo mensaje de WhatsApp, en el idioma del contacto y con`
      + ` un máximo de ${MODEL_REPLY_MAX_CHARACTERS} caracteres.`,
  ].filter((part): part is string => part !== null).join("\n\n");
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

  let reply: Awaited<ReturnType<ModelProvider["generate"]>>;
  try {
    reply = await deps.provider.generate({
      model: version.model,
      instructions: buildInstructions(version),
      turns,
      maxOutputTokens: AGENT_RUN_MAX_OUTPUT_TOKENS,
    });
  } catch (caught) {
    const failureCode = caught instanceof ModelProviderError
      ? caught.code
      : "MODEL_UNAVAILABLE";
    return unanswered("failed", failureCode);
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
