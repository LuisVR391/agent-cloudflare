import { Agent } from "agents";

import { executeAgentRun } from "./agents/agent-run";
import { createModelProvider } from "./agents/workers-ai-provider";

/**
 * Modos que el runtime opera hoy. `supervised` sigue reservado por el contrato
 * aceptado y no se habilita hasta el corte que introduce la aprobación humana.
 */
type RuntimeAttentionMode = "automatic" | "human" | "paused";

export type CustomerSupportState = {
  status: "ready";
  channel: "whatsapp";
  messagesReceived: number;
  lastMessageAt: string | null;
  organizationId: string | null;
  conversationId: string | null;
  attentionMode: RuntimeAttentionMode;
  pendingMessageIds: string[];
  lastProcessedMessageId: string | null;
  /**
   * Una corrida en curso. Es lo que impide que un mensaje que llega mientras el
   * modelo responde dispare una segunda corrida; la garantía dura sigue siendo
   * el índice único de `agent_runs` por mensaje disparador.
   */
  agentRunInFlight: boolean;
};

/** Cuánto espera un flush que encontró una corrida en curso. */
const AGENT_RUN_RETRY_SECONDS = 2;

export class CustomerSupportAgent extends Agent<
  Env,
  CustomerSupportState
> {
  initialState: CustomerSupportState = {
    status: "ready",
    channel: "whatsapp",
    messagesReceived: 0,
    lastMessageAt: null,
    organizationId: null,
    conversationId: null,
    attentionMode: "human",
    pendingMessageIds: [],
    lastProcessedMessageId: null,
    agentRunInFlight: false,
  };

  async acceptInboundMessage(input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    occurredAt: string;
    bufferSeconds: number;
  }): Promise<void> {
    this.#assertScope(input.organizationId, input.conversationId);
    const pendingMessageIds = this.state.pendingMessageIds.includes(input.messageId)
      ? this.state.pendingMessageIds
      : [...this.state.pendingMessageIds, input.messageId];
    this.setState({
      ...this.state,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messagesReceived:
        this.state.messagesReceived +
        (pendingMessageIds === this.state.pendingMessageIds ? 0 : 1),
      lastMessageAt: input.occurredAt,
      pendingMessageIds,
    });
    await this.schedule(
      Math.max(0, Math.min(input.bufferSeconds, 30)),
      "flushPendingMessages",
    );
    this.broadcast(
      JSON.stringify({
        type: "conversation.changed",
        conversationId: input.conversationId,
        messageId: input.messageId,
        occurredAt: input.occurredAt,
      }),
    );
  }

  /**
   * Vence el buffer: el último mensaje agrupado es el que dispara la corrida.
   *
   * Si el modo o el agente no permiten responder, la corrida no ocurre y el
   * cursor avanza igual, como hasta ahora. Quien decide es D1 y no la
   * proyección del runtime: un Durable Object recreado empieza con el estado
   * inicial, y confiar en él dejaría muda una conversación que sí responde.
   */
  async flushPendingMessages(): Promise<void> {
    const triggerMessageId = this.state.pendingMessageIds.at(-1) ?? null;
    if (this.state.agentRunInFlight) {
      await this.schedule(AGENT_RUN_RETRY_SECONDS, "flushPendingMessages");
      return;
    }
    const { organizationId, conversationId } = this.state;
    this.setState({
      ...this.state,
      pendingMessageIds: [],
      lastProcessedMessageId:
        triggerMessageId ?? this.state.lastProcessedMessageId,
    });
    if (!triggerMessageId || !organizationId || !conversationId) return;

    this.setState({ ...this.state, agentRunInFlight: true });
    try {
      const outcome = await executeAgentRun(
        {
          db: this.env.DB,
          provider: createModelProvider(this.env),
          outbound: this.env.OUTBOUND_MESSAGES ?? null,
        },
        { organizationId, conversationId, triggerMessageId },
      );
      if (outcome.result === "unanswered" && outcome.escalated) {
        await this.updateAttentionMode("human");
      }
    } finally {
      this.setState({ ...this.state, agentRunInFlight: false });
      if (this.state.pendingMessageIds.length > 0) {
        await this.schedule(0, "flushPendingMessages");
      }
    }
  }

  async updateAttentionMode(mode: RuntimeAttentionMode): Promise<void> {
    this.setState({ ...this.state, attentionMode: mode });
    if (this.state.conversationId) {
      this.broadcast(
        JSON.stringify({
          type: "conversation.mode.changed",
          conversationId: this.state.conversationId,
          attentionMode: mode,
          occurredAt: new Date().toISOString(),
        }),
      );
    }
  }

  async notifyMessageChanged(input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    occurredAt: string;
  }): Promise<void> {
    this.#assertScope(input.organizationId, input.conversationId);
    this.setState({
      ...this.state,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
    });
    this.broadcast(
      JSON.stringify({
        type: "conversation.message.changed",
        conversationId: input.conversationId,
        messageId: input.messageId,
        occurredAt: input.occurredAt,
      }),
    );
  }

  #assertScope(organizationId: string, conversationId: string): void {
    if (
      (this.state.organizationId &&
        this.state.organizationId !== organizationId) ||
      (this.state.conversationId &&
        this.state.conversationId !== conversationId)
    ) {
      throw new Error("CONVERSATION_RUNTIME_SCOPE_MISMATCH");
    }
  }
}
