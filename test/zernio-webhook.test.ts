import { createHmac } from "node:crypto";
import { env } from "cloudflare:workers";
import { beforeEach, describe, expect, it } from "vitest";

import type { InboundQueueMessage } from "../src/worker/integrations/zernio/contracts";
import { processInboundQueueMessage } from "../src/worker/integrations/zernio/inbound-queue";
import { handleZernioWebhook } from "../src/worker/integrations/zernio/webhook";
import { createRepositories } from "../src/worker/repositories";

const secret = "test-only-zernio-webhook-secret";

class CapturingQueue implements Queue<InboundQueueMessage> {
  readonly messages: InboundQueueMessage[] = [];
  fail = false;

  async metrics(): Promise<QueueMetrics> {
    return { backlogCount: this.messages.length, backlogBytes: 0 };
  }

  async send(message: InboundQueueMessage): Promise<QueueSendResponse> {
    if (this.fail) throw new Error("queue unavailable");
    this.messages.push(message);
    return {
      metadata: {
        metrics: { backlogCount: this.messages.length, backlogBytes: 0 },
      },
    };
  }

  async sendBatch(
    messages: Iterable<MessageSendRequest<InboundQueueMessage>>,
  ): Promise<QueueSendBatchResponse> {
    for (const message of messages) await this.send(message.body);
    return {
      metadata: {
        metrics: { backlogCount: this.messages.length, backlogBytes: 0 },
      },
    };
  }
}

function messageEvent(eventId = crypto.randomUUID()) {
  return {
    id: eventId,
    event: "message.received",
    message: {
      id: `message-${eventId}`,
      conversationId: "conversation-123",
      platform: "whatsapp",
      platformMessageId: "wamid.123",
      direction: "incoming",
      text: "Hola",
      attachments: [],
      sender: {
        id: "5215550001111",
        phoneNumber: "+5215550001111",
        businessScopedUserId: "bsuid-123",
      },
      sentAt: "2026-08-10T18:00:00Z",
      isRead: false,
    },
    conversation: {
      id: "conversation-123",
      platformConversationId: "platform-conversation-123",
      status: "active",
    },
    account: {
      id: externalAccountId,
      accountId: externalAccountId,
      profileId: "zernio-profile-123",
      platform: "whatsapp",
      username: "+5215653506430",
    },
    timestamp: "2026-08-10T18:00:01Z",
  };
}

function signedRequest(payload: unknown, signatureSecret = secret): Request {
  const body = JSON.stringify(payload);
  const signature = createHmac("sha256", signatureSecret)
    .update(body)
    .digest("hex");
  return new Request("https://example.com/webhooks/zernio", {
    method: "POST",
    headers: {
      "content-type": "application/json",
      "x-zernio-signature": signature,
      "x-zernio-event-id": (payload as { id: string }).id,
    },
    body,
  });
}

let organizationId: string;
let channelId: string;
let externalAccountId: string;

beforeEach(async () => {
  externalAccountId = "zernio-account-" + crypto.randomUUID();
  const repositories = createRepositories(env.DB);
  const organization = await repositories.organizations.create({
    slug: `zernio-${crypto.randomUUID()}`,
    displayName: "Salón Zernio",
  });
  const channel = await repositories.communicationChannels.create(
    organization.id,
    {
      provider: "whatsapp",
      adapter: "zernio",
      externalAccountId,
      externalProfileId: "zernio-profile-123",
    },
  );
  organizationId = organization.id;
  channelId = channel.id;
});

describe("POST /webhooks/zernio", () => {
  it("verifica, persiste y encola un mensaje entrante", async () => {
    const queue = new CapturingQueue();
    const payload = messageEvent();
    const response = await handleZernioWebhook(signedRequest(payload), {
      DB: env.DB,
      INBOUND_MESSAGES: queue,
      ZERNIO_WEBHOOK_SECRET: secret,
    });

    expect(response.status).toBe(202);
    expect(queue.messages).toHaveLength(1);
    expect(queue.messages[0]).toMatchObject({
      kind: "messageReceived",
      organizationId,
      channelId,
      externalContactId: "bsuid-123",
      text: "Hola",
    });

    const receipt = await env.DB.prepare(
      `SELECT organization_id, channel_id, status
       FROM inbound_webhook_events WHERE external_event_id = ?`,
    )
      .bind(payload.id)
      .first<{ organization_id: string; channel_id: string; status: string }>();
    expect(receipt).toEqual({
      organization_id: organizationId,
      channel_id: channelId,
      status: "enqueued",
    });
  });

  it("deduplica entregas repetidas por el ID estable", async () => {
    const queue = new CapturingQueue();
    const payload = messageEvent();
    const webhookEnv = {
      DB: env.DB,
      INBOUND_MESSAGES: queue,
      ZERNIO_WEBHOOK_SECRET: secret,
    };

    expect((await handleZernioWebhook(signedRequest(payload), webhookEnv)).status).toBe(202);
    expect((await handleZernioWebhook(signedRequest(payload), webhookEnv)).status).toBe(200);
    expect(queue.messages).toHaveLength(1);
  });

  it("rechaza firma inválida sin persistir ni encolar", async () => {
    const queue = new CapturingQueue();
    const payload = messageEvent();
    const response = await handleZernioWebhook(
      signedRequest(payload, "wrong-secret"),
      {
        DB: env.DB,
        INBOUND_MESSAGES: queue,
        ZERNIO_WEBHOOK_SECRET: secret,
      },
    );

    expect(response.status).toBe(401);
    expect(queue.messages).toHaveLength(0);
    const row = await env.DB.prepare(
      `SELECT id FROM inbound_webhook_events WHERE external_event_id = ?`,
    )
      .bind(payload.id)
      .first();
    expect(row).toBeNull();
  });

  it("falla cerrado para una cuenta no vinculada", async () => {
    const queue = new CapturingQueue();
    const payload = messageEvent();
    payload.account.id = "unknown-account";
    payload.account.accountId = "unknown-account";
    const response = await handleZernioWebhook(signedRequest(payload), {
      DB: env.DB,
      INBOUND_MESSAGES: queue,
      ZERNIO_WEBHOOK_SECRET: secret,
    });

    expect(response.status).toBe(422);
    expect(queue.messages).toHaveLength(0);
  });

  it("acepta webhook.test sin requerir un canal", async () => {
    const queue = new CapturingQueue();
    const payload = {
      id: crypto.randomUUID(),
      event: "webhook.test",
      message: "Test webhook delivery",
      timestamp: "2026-08-10T18:00:00Z",
    };
    const response = await handleZernioWebhook(signedRequest(payload), {
      DB: env.DB,
      INBOUND_MESSAGES: queue,
      ZERNIO_WEBHOOK_SECRET: secret,
    });

    expect(response.status).toBe(204);
    expect(queue.messages).toHaveLength(0);
  });

  it("deja el evento reintentable cuando Queue no está disponible", async () => {
    const queue = new CapturingQueue();
    queue.fail = true;
    const payload = messageEvent();
    const response = await handleZernioWebhook(signedRequest(payload), {
      DB: env.DB,
      INBOUND_MESSAGES: queue,
      ZERNIO_WEBHOOK_SECRET: secret,
    });

    expect(response.status).toBe(503);
    const row = await env.DB.prepare(
      `SELECT status, failure_code FROM inbound_webhook_events
       WHERE external_event_id = ?`,
    )
      .bind(payload.id)
      .first<{ status: string; failure_code: string }>();
    expect(row).toEqual({ status: "failed", failure_code: "QUEUE_UNAVAILABLE" });
  });
});

describe("consumidor de entrada", () => {
  it("marca procesado el evento aceptado", async () => {
    const queue = new CapturingQueue();
    const payload = messageEvent();
    await handleZernioWebhook(signedRequest(payload), {
      DB: env.DB,
      INBOUND_MESSAGES: queue,
      ZERNIO_WEBHOOK_SECRET: secret,
    });

    await processInboundQueueMessage(env, queue.messages[0]);
    const row = await env.DB.prepare(
      `SELECT status, processed_at FROM inbound_webhook_events
       WHERE external_event_id = ?`,
    )
      .bind(payload.id)
      .first<{ status: string; processed_at: string | null }>();
    expect(row?.status).toBe("processed");
    expect(row?.processed_at).not.toBeNull();
  });
});
