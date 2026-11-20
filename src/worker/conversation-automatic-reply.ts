import {
  AGENT_RUN_CONTEXT_MESSAGES,
  executeAgentRun,
  finishAgentRun,
  type AgentRunFailureCode,
} from "./agents/agent-run";
import type { ModelProvider } from "./agents/model-provider";
import type { OutboundQueueMessage } from "./integrations/zernio/contracts";
import { ConversationRepository } from "./repositories/conversation-repository";

type AutomaticReplyOutcome =
  | { result: "not_applicable"; reason: "NOT_AUTOMATIC" | "DUPLICATE_TRIGGER" }
  | { result: "succeeded"; runId: string; responseMessageId: string }
  | {
      result: "unanswered";
      status: "failed" | "skipped";
      runId: string | null;
      failureCode: AgentRunFailureCode;
      escalated: boolean;
    };

export async function coordinateAutomaticReply(
  deps: {
    db: D1Database;
    provider: ModelProvider | null;
    outbound: {
      send(message: OutboundQueueMessage, options?: { contentType?: "json" }): Promise<unknown>;
    } | null;
  },
  input: {
    organizationId: string;
    conversationId: string;
    triggerMessageId: string;
  },
): Promise<AutomaticReplyOutcome> {
  const conversations = new ConversationRepository(deps.db);
  const eligible = await conversations.findAutomaticReplyContext(input);
  if (!eligible) return { result: "not_applicable", reason: "NOT_AUTOMATIC" };

  const context = { ...input, ...eligible };
  const execution = await executeAgentRun({
    db: deps.db,
    provider: deps.provider,
    loadHistory: async () => {
      const { messages } = await conversations.listMessages(
        input.organizationId,
        input.conversationId,
        { limit: AGENT_RUN_CONTEXT_MESSAGES },
      );
      return messages.map(({ direction, messageType, text }) => ({ direction, messageType, text }));
    },
  }, context);
  if (execution.result === "not_applicable") return execution;
  if (execution.result === "unanswered") {
    const escalated = await conversations.escalateToHuman(context);
    return { ...execution, escalated };
  }

  const { runId, text } = execution;
  const outgoing = await conversations.createAutomaticReply({ ...context, runId, text });
  if (!outgoing) {
    const failureCode = "ATTENTION_CHANGED";
    await finishAgentRun(deps.db, context, runId, { status: "failed", failureCode });
    return { result: "unanswered", status: "failed", runId, failureCode, escalated: false };
  }

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
    await conversations.markEnqueueFailed(input.organizationId, outgoing.messageId);
    const failureCode = "OUTBOUND_QUEUE_UNAVAILABLE";
    await finishAgentRun(deps.db, context, runId, {
      status: "failed",
      failureCode,
      responseMessageId: outgoing.messageId,
    });
    const escalated = await conversations.escalateToHuman(context);
    return { result: "unanswered", status: "failed", runId, failureCode, escalated };
  }

  await finishAgentRun(deps.db, context, runId, {
    status: "succeeded",
    responseMessageId: outgoing.messageId,
  });
  return { result: "succeeded", runId, responseMessageId: outgoing.messageId };
}
