import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRepository } from "../src/worker/repositories/conversation-repository";
import type { OutboundQueueMessage } from "../src/worker/integrations/zernio/contracts";
import { processInboundQueueMessage } from "../src/worker/integrations/zernio/inbound-queue";
import {
  handleOutboundQueue,
  processOutboundQueueMessage,
} from "../src/worker/integrations/zernio/outbound-queue";
import { persistInboundAttachments } from "../src/worker/integrations/zernio/media";

const organizationId = "11111111-1111-4111-8111-111111111111";
const otherOrganizationId = "22222222-2222-4222-8222-222222222222";
const channelId = "33333333-3333-4333-8333-333333333333";
const occurredAt = "2026-08-10T18:00:00.000Z";

describe.sequential("conversaciones canónicas", () => {
  beforeEach(async () => {
    const now = new Date().toISOString();
    await env.DB.prepare("DELETE FROM organizations").run();
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, 'beautyplace', 'Beautyplace', 'active', ?, ?)`)
        .bind(organizationId, now, now),
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, 'otro-salon', 'Otro salón', 'active', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         display_name, status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', 'account-beautyplace',
          'WhatsApp principal', 'active', ?, ?)`)
        .bind(channelId, organizationId, now, now),
    ]);
  });

  it("persiste una sola conversación y mensaje ante reintentos", async () => {
    const repository = new ConversationRepository(env.DB);
    const input = {
      organizationId,
      channelId,
      externalConversationId: "z-conversation-1",
      externalContactId: "wa-contact-1",
      externalMessageId: "z-message-1",
      platformMessageId: "wamid-1",
      text: "Hola, quiero información",
      occurredAt,
      correlationId: "44444444-4444-4444-8444-444444444444",
    };
    const first = await repository.upsertInbound(input);
    const repeated = await repository.upsertInbound(input);
    expect(repeated).toEqual(first);
    await expect(repository.list(organizationId, { limit: 30 })).resolves.toHaveLength(1);
    await expect(repository.list(otherOrganizationId, { limit: 30 })).resolves.toEqual([]);
    await expect(repository.listMessages(organizationId, first.conversationId, { limit: 50 }))
      .resolves.toMatchObject([{ id: first.messageId, text: input.text, status: "received" }]);
    const counts = await env.DB.prepare(`SELECT
      (SELECT COUNT(*) FROM contacts WHERE organization_id = ?) AS contacts,
      (SELECT COUNT(*) FROM messages WHERE organization_id = ?) AS messages`)
      .bind(organizationId, organizationId).first<{ contacts: number; messages: number }>();
    expect(counts).toEqual({ contacts: 1, messages: 1 });
  });

  it("crea una respuesta idempotente y reconcilia el envío", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId, channelId, externalConversationId: "z-conversation-2",
      externalContactId: "wa-contact-2", externalMessageId: "z-message-2",
      platformMessageId: "wamid-2", text: "¿Tienen citas?", occurredAt,
      correlationId: "55555555-5555-4555-8555-555555555555",
    });
    const request = {
      organizationId, conversationId: inbound.conversationId,
      actorId: "staff-1", clientRequestId: "66666666-6666-4666-8666-666666666666",
      text: "Sí, ¿qué día prefieres?", correlationId: "77777777-7777-4777-8777-777777777777",
    };
    const first = await repository.createOutgoing(request);
    await expect(repository.createOutgoing(request)).resolves.toEqual({
      ...first,
      created: false,
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      success: true,
      data: {
        messageId: "z-outbound-1",
        conversationId: "z-conversation-2",
        sentAt: "2026-08-10T18:01:00.000Z",
        message: request.text,
      },
    })));
    await processOutboundQueueMessage(
      { DB: env.DB, CustomerSupportAgent: env.CustomerSupportAgent, ZERNIO_API_KEY: "test-only-zernio-key" },
      {
        kind: "sendTextMessage",
        organizationId,
        conversationId: inbound.conversationId,
        messageId: first.messageId,
        correlationId: request.correlationId,
      },
    );
    const sent = await env.DB.prepare(
      "SELECT status, external_message_id FROM messages WHERE organization_id = ? AND id = ?",
    ).bind(organizationId, first.messageId)
      .first<{ status: string; external_message_id: string }>();
    expect(sent).toEqual({ status: "sent", external_message_id: "z-outbound-1" });
    const sentEventId = "70707070-7070-4070-8070-707070707070";
    await processInboundQueueMessage(env, {
      kind: "messageStatus",
      eventId: sentEventId,
      correlationId: "80808080-8080-4080-8080-808080808080",
      organizationId,
      channelId,
      externalAccountId: "account-beautyplace",
      externalConversationId: "z-conversation-2",
      externalMessageId: "z-outbound-1",
      platformMessageId: "wamid-outbound-1",
      status: "sent",
      occurredAt: "2026-08-10T18:01:01.000Z",
    });
    const reconciled = await env.DB.prepare(
      `SELECT status, reconciled_at FROM message_status_events
       WHERE organization_id = ? AND external_event_id = ?`,
    ).bind(organizationId, sentEventId)
      .first<{ status: string; reconciled_at: string | null }>();
    expect(reconciled?.status).toBe("sent");
    expect(reconciled?.reconciled_at).not.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("persiste un rechazo definitivo sin dejar el mensaje en cola", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId,
      channelId,
      externalConversationId: "z-conversation-rejected",
      externalContactId: "wa-contact-rejected",
      externalMessageId: "z-message-rejected",
      platformMessageId: "wamid-rejected",
      text: "¿Puedo reservar?",
      occurredAt,
      correlationId: "10101010-1010-4010-8010-101010101010",
    });
    const outgoing = await repository.createOutgoing({
      organizationId,
      conversationId: inbound.conversationId,
      actorId: "staff-1",
      clientRequestId: "20202020-2020-4020-8020-202020202020",
      text: "Claro.",
      correlationId: "30303030-3030-4030-8030-303030303030",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      Response.json({ error: "provider detail" }, { status: 422 }),
    ));

    const result = await processOutboundQueueMessage(
      {
        DB: env.DB,
        CustomerSupportAgent: env.CustomerSupportAgent,
        ZERNIO_API_KEY: "test-only-zernio-key",
      },
      {
        kind: "sendTextMessage",
        organizationId,
        conversationId: inbound.conversationId,
        messageId: outgoing.messageId,
        correlationId: outgoing.correlationId,
      },
    );

    expect(result).toEqual({
      action: "ack",
      result: "failed",
      errorCode: "ZERNIO_HTTP_422",
    });
    const state = await env.DB.prepare(`SELECT m.status AS message_status,
      d.status AS delivery_status, d.last_error_code
      FROM messages m JOIN outbound_message_deliveries d
        ON d.organization_id = m.organization_id AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        message_status: string;
        delivery_status: string;
        last_error_code: string;
      }>();
    expect(state).toEqual({
      message_status: "failed",
      delivery_status: "failed",
      last_error_code: "ZERNIO_HTTP_422",
    });

    const consoleError = vi.spyOn(console, "error").mockImplementation(() => undefined);
    const ack = vi.fn();
    const retry = vi.fn();
    await handleOutboundQueue({
      queue: "outbound-test",
      messages: [{
        id: "queue-message-rejected",
        timestamp: new Date(),
        body: {
          kind: "sendTextMessage",
          organizationId,
          conversationId: inbound.conversationId,
          messageId: outgoing.messageId,
          correlationId: outgoing.correlationId,
        },
        attempts: 1,
        ack,
        retry,
      }],
    } as unknown as MessageBatch<OutboundQueueMessage>, {
      DB: env.DB,
      CustomerSupportAgent: env.CustomerSupportAgent,
      ZERNIO_API_KEY: "test-only-zernio-key",
    });
    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    expect(consoleError).toHaveBeenCalled();
    expect(JSON.stringify(consoleError.mock.calls)).not.toContain("provider detail");
    consoleError.mockRestore();
    vi.unstubAllGlobals();
  });

  it("conserva delivery_unknown cuando la aceptación no puede confirmarse", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId,
      channelId,
      externalConversationId: "z-conversation-unknown",
      externalContactId: "wa-contact-unknown",
      externalMessageId: "z-message-unknown",
      platformMessageId: "wamid-unknown",
      text: "Hola",
      occurredAt,
      correlationId: "40404040-4040-4040-8040-404040404040",
    });
    const outgoing = await repository.createOutgoing({
      organizationId,
      conversationId: inbound.conversationId,
      actorId: "staff-1",
      clientRequestId: "50505050-5050-4050-8050-505050505050",
      text: "Hola de vuelta.",
      correlationId: "60606060-6060-4060-8060-606060606060",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      success: true,
      data: {
        messageId: "z-outbound-mismatch",
        conversationId: "another-conversation",
        sentAt: "2026-08-11T12:00:00.000Z",
      },
    })));

    const result = await processOutboundQueueMessage(
      {
        DB: env.DB,
        CustomerSupportAgent: env.CustomerSupportAgent,
        ZERNIO_API_KEY: "test-only-zernio-key",
      },
      {
        kind: "sendTextMessage",
        organizationId,
        conversationId: inbound.conversationId,
        messageId: outgoing.messageId,
        correlationId: outgoing.correlationId,
      },
    );

    expect(result).toEqual({
      action: "ack",
      result: "delivery_unknown",
      errorCode: "ZERNIO_CONVERSATION_MISMATCH",
    });
    const state = await env.DB.prepare(`SELECT m.status AS message_status,
      d.status AS delivery_status, d.last_error_code, d.attempt_count
      FROM messages m JOIN outbound_message_deliveries d
        ON d.organization_id = m.organization_id AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        message_status: string;
        delivery_status: string;
        last_error_code: string;
        attempt_count: number;
      }>();
    expect(state).toEqual({
      message_status: "delivery_unknown",
      delivery_status: "delivery_unknown",
      last_error_code: "ZERNIO_CONVERSATION_MISMATCH",
      attempt_count: 1,
    });
    vi.unstubAllGlobals();
  });

  it("reutiliza idempotencia al reintentar y no reenvía después de sent", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId,
      channelId,
      externalConversationId: "z-conversation-retry",
      externalContactId: "wa-contact-retry",
      externalMessageId: "z-message-retry",
      platformMessageId: "wamid-retry",
      text: "Hola",
      occurredAt,
      correlationId: "11111111-aaaa-4111-8111-111111111111",
    });
    const outgoing = await repository.createOutgoing({
      organizationId,
      conversationId: inbound.conversationId,
      actorId: "staff-1",
      clientRequestId: "22222222-aaaa-4222-8222-222222222222",
      text: "Respuesta",
      correlationId: "33333333-aaaa-4333-8333-333333333333",
    });
    const fetchMock = vi.fn()
      .mockRejectedValueOnce(new TypeError("Illegal invocation: private detail"))
      .mockResolvedValueOnce(Response.json({
        success: true,
        data: {
          messageId: "z-outbound-retry",
          conversationId: "z-conversation-retry",
          sentAt: "2026-08-11T18:05:00.000Z",
        },
      }));
    vi.stubGlobal("fetch", fetchMock);
    const queueMessage = {
      kind: "sendTextMessage" as const,
      organizationId,
      conversationId: inbound.conversationId,
      messageId: outgoing.messageId,
      correlationId: outgoing.correlationId,
    };
    const outboundEnv = {
      DB: env.DB,
      CustomerSupportAgent: env.CustomerSupportAgent,
      ZERNIO_API_KEY: "test-only-zernio-key",
    };

    await expect(processOutboundQueueMessage(outboundEnv, queueMessage))
      .resolves.toEqual({
        action: "retry",
        result: "delivery_unknown",
        errorCode: "ZERNIO_TRANSPORT_ILLEGAL_INVOCATION",
      });
    await expect(processOutboundQueueMessage(outboundEnv, queueMessage))
      .resolves.toEqual({ action: "ack", result: "sent" });
    await expect(processOutboundQueueMessage(outboundEnv, queueMessage))
      .resolves.toEqual({ action: "ack", result: "sent" });

    expect(fetchMock).toHaveBeenCalledTimes(2);
    const idempotencyKeys = fetchMock.mock.calls.map(([, init]) =>
      (init?.headers as Record<string, string>)["Idempotency-Key"]
    );
    expect(new Set(idempotencyKeys)).toHaveLength(1);
    const state = await env.DB.prepare(`SELECT status, attempt_count,
      idempotency_key, external_message_id, last_error_code
      FROM outbound_message_deliveries
      WHERE organization_id = ? AND message_id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        status: string;
        attempt_count: number;
        idempotency_key: string;
        external_message_id: string;
        last_error_code: string | null;
      }>();
    expect(state).toEqual({
      status: "sent",
      attempt_count: 2,
      idempotency_key: idempotencyKeys[0],
      external_message_id: "z-outbound-retry",
      last_error_code: null,
    });
    vi.unstubAllGlobals();
  });

  it("aplica control optimista al pausar y resolver", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId, channelId, externalConversationId: "z-conversation-3",
      externalContactId: "wa-contact-3", externalMessageId: "z-message-3",
      platformMessageId: "wamid-3", text: "Hola", occurredAt,
      correlationId: "88888888-8888-4888-8888-888888888888",
    });
    const conversation = await repository.find(organizationId, inbound.conversationId);
    expect(conversation).not.toBeNull();
    const updated = await repository.updateState({
      organizationId, conversationId: inbound.conversationId,
      expectedVersion: conversation!.version, status: "resolved", attentionMode: "paused",
      actorId: "staff-1", correlationId: "99999999-9999-4999-8999-999999999999",
    });
    expect(updated).toMatchObject({ status: "resolved", attentionMode: "paused" });
    await expect(repository.updateState({
      organizationId, conversationId: inbound.conversationId,
      expectedVersion: conversation!.version, status: "open",
      actorId: "staff-1", correlationId: "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa",
    })).resolves.toBeNull();
  });

  it("valida y conserva adjuntos sin persistir la URL externa", async () => {
    const objects = new Map<string, ArrayBuffer>();
    const bucket = {
      put: vi.fn(async (key: string, value: ArrayBuffer) => {
        objects.set(key, value);
        return {} as R2Object;
      }),
    } as unknown as R2Bucket;
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId, channelId, externalConversationId: "z-conversation-media",
      externalContactId: "wa-contact-media", externalMessageId: "z-message-media",
      platformMessageId: "wamid-media", text: null, messageType: "image", occurredAt,
      correlationId: "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb",
    });
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(new Response(new Uint8Array([1, 2, 3]), {
      headers: { "Content-Type": "image/png", "Content-Length": "3" },
    })));
    await persistInboundAttachments({
      db: env.DB, bucket, organizationId, messageId: inbound.messageId,
      attachments: [{ type: "image", url: "https://media.example.com/image.png" }],
    });
    const attachment = await env.DB.prepare(`SELECT r2_key, byte_size
      FROM message_attachments WHERE organization_id = ? AND message_id = ?`)
      .bind(organizationId, inbound.messageId)
      .first<{ r2_key: string; byte_size: number }>();
    expect(attachment?.byte_size).toBe(3);
    expect(objects.get(attachment!.r2_key)?.byteLength).toBe(3);
    await expect(persistInboundAttachments({
      db: env.DB, bucket, organizationId, messageId: inbound.messageId,
      attachments: [{ type: "image", url: "http://127.0.0.1/private" }],
    })).rejects.toThrow("ATTACHMENT_URL_REJECTED");
    vi.unstubAllGlobals();
  });
});
