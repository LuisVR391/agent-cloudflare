import { Agent } from "agents";

export type CustomerSupportState = {
  status: "ready";
  channel: "whatsapp";
  messagesReceived: number;
  lastMessageAt: string | null;
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
  };
}
