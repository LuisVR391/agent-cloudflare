import { Agent } from "agents";

export type CustomerSupportState = {
  status: "ready";
  channel: "whatsapp";
  messagesReceived: number;
  lastMessageAt: string | null;
  organizationId: string | null;
  conversationId: string | null;
  attentionMode: "human" | "paused";
  pendingMessageIds: string[];
  lastProcessedMessageId: string | null;
};

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
  };

  async acceptInboundMessage(input: {
    organizationId: string;
    conversationId: string;
    messageId: string;
    occurredAt: string;
    bufferSeconds: number;
  }): Promise<void> {
    if (
      (this.state.organizationId && this.state.organizationId !== input.organizationId) ||
      (this.state.conversationId && this.state.conversationId !== input.conversationId)
    ) {
      throw new Error("CONVERSATION_RUNTIME_SCOPE_MISMATCH");
    }
    const pendingMessageIds = this.state.pendingMessageIds.includes(input.messageId)
      ? this.state.pendingMessageIds
      : [...this.state.pendingMessageIds, input.messageId];
    this.setState({
      ...this.state,
      organizationId: input.organizationId,
      conversationId: input.conversationId,
      messagesReceived: this.state.messagesReceived + (pendingMessageIds === this.state.pendingMessageIds ? 0 : 1),
      lastMessageAt: input.occurredAt,
      pendingMessageIds,
    });
    await this.schedule(Math.max(0, Math.min(input.bufferSeconds, 30)), "flushPendingMessages");
    this.broadcast(JSON.stringify({
      type: "conversation.changed",
      conversationId: input.conversationId,
      messageId: input.messageId,
      occurredAt: input.occurredAt,
    }));
  }

  async flushPendingMessages(): Promise<void> {
    const lastProcessedMessageId = this.state.pendingMessageIds.at(-1) ?? this.state.lastProcessedMessageId;
    this.setState({ ...this.state, pendingMessageIds: [], lastProcessedMessageId });
  }

  async updateAttentionMode(mode: "human" | "paused"): Promise<void> {
    this.setState({ ...this.state, attentionMode: mode });
    if (this.state.conversationId) {
      this.broadcast(JSON.stringify({
        type: "conversation.mode.changed",
        conversationId: this.state.conversationId,
        attentionMode: mode,
        occurredAt: new Date().toISOString(),
      }));
    }
  }
}
