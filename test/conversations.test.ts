import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRepository } from "../src/worker/repositories/conversation-repository";
import type {
  InboundQueueMessage,
  OutboundQueueMessage,
} from "../src/worker/integrations/zernio/contracts";
import {
  handleInboundQueue,
  processInboundQueueMessage,
} from "../src/worker/integrations/zernio/inbound-queue";
import {
  handleOutboundQueue,
  processOutboundQueueMessage,
} from "../src/worker/integrations/zernio/outbound-queue";
import { persistInboundAttachments } from "../src/worker/integrations/zernio/media";
import { ZernioClient, type ZernioFetch } from "../src/worker/integrations/zernio/client";

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

  it("marca enviado y reconcilia cuando WhatsApp omite conversationId y sentAt", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId, channelId, externalConversationId: "z-conversation-whatsapp",
      externalContactId: "wa-contact-whatsapp", externalMessageId: "z-message-whatsapp",
      platformMessageId: "wamid-inbound-whatsapp", text: "Hola", occurredAt,
      correlationId: "90909090-9090-4090-8090-909090909090",
    });
    const outgoing = await repository.createOutgoing({
      organizationId,
      conversationId: inbound.conversationId,
      actorId: "staff-1",
      clientRequestId: "91919191-9191-4191-8191-919191919191",
      text: "Respuesta desde el inbox",
      correlationId: "92929292-9292-4292-8292-929292929292",
    });
    // Forma real de Zernio en WhatsApp: `conversationId` es de Twitter y
    // `sentAt` de Bluesky, así que ambos llegan nulos.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      success: true,
      data: {
        messageId: "6a7c02f342e22321dc12dbd0",
        conversationId: null,
        sentAt: null,
      },
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
        conversationId: inbound.conversationId,
        messageId: outgoing.messageId,
        correlationId: outgoing.correlationId,
      },
    )).resolves.toEqual({ action: "ack", result: "sent" });

    const afterSend = await env.DB.prepare(`SELECT m.status AS message_status,
      m.external_message_id, d.status AS delivery_status, d.last_error_code,
      d.sent_at
      FROM messages m JOIN outbound_message_deliveries d
        ON d.organization_id = m.organization_id AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        message_status: string;
        external_message_id: string;
        delivery_status: string;
        last_error_code: string | null;
        sent_at: string | null;
      }>();
    expect(afterSend).toMatchObject({
      message_status: "sent",
      external_message_id: "6a7c02f342e22321dc12dbd0",
      delivery_status: "sent",
      last_error_code: null,
    });
    expect(afterSend?.sent_at).not.toBeNull();

    for (const status of ["sent", "delivered", "read"] as const) {
      await processInboundQueueMessage(env, {
        kind: "messageStatus",
        eventId: `whatsapp-status-${status}`,
        correlationId: "93939393-9393-4393-8393-939393939393",
        organizationId,
        channelId,
        externalAccountId: "account-beautyplace",
        externalConversationId: "z-conversation-whatsapp",
        externalMessageId: "6a7c02f342e22321dc12dbd0",
        platformMessageId: "wamid-outbound-whatsapp",
        status,
        occurredAt: `2026-08-12T05:21:5${status === "sent" ? 7 : status === "delivered" ? 8 : 9}.000Z`,
      });
    }

    await expect(env.DB.prepare(
      "SELECT status FROM messages WHERE organization_id = ? AND id = ?",
    ).bind(organizationId, outgoing.messageId).first<{ status: string }>())
      .resolves.toEqual({ status: "read" });
    vi.unstubAllGlobals();
  });

  it("reconcilia cuando el envío devuelve el id de plataforma y el webhook el de Zernio", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId, channelId, externalConversationId: "z-conversation-cross-id",
      externalContactId: "wa-contact-cross-id", externalMessageId: "z-message-cross-id",
      platformMessageId: "wamid-inbound-cross-id", text: "Hola", occurredAt,
      correlationId: "94949494-9494-4494-8494-949494949494",
    });
    const outgoing = await repository.createOutgoing({
      organizationId,
      conversationId: inbound.conversationId,
      actorId: "staff-1",
      clientRequestId: "95959595-9595-4595-8595-959595959595",
      text: "Respuesta",
      correlationId: "96969696-9696-4696-8696-969696969696",
    });
    // En WhatsApp la respuesta de envío devuelve el wamid, mientras los webhooks
    // identifican el mensaje por el id interno de Zernio y llevan el wamid aparte.
    const wamid = "wamid.HBgNNTIxNzcxMzQ5MzQ3NRUCABEYFENFRDk2NkU4AA==";
    const zernioMessageId = "6a7c082eb5b00e22498d1456";
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      success: true,
      data: { messageId: wamid, conversationId: null, sentAt: null },
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
        conversationId: inbound.conversationId,
        messageId: outgoing.messageId,
        correlationId: outgoing.correlationId,
      },
    )).resolves.toEqual({ action: "ack", result: "sent" });

    for (const status of ["sent", "delivered", "read"] as const) {
      await processInboundQueueMessage(env, {
        kind: "messageStatus",
        eventId: `cross-id-${status}`,
        correlationId: "97979797-9797-4797-8797-979797979797",
        organizationId,
        channelId,
        externalAccountId: "account-beautyplace",
        externalConversationId: "z-conversation-cross-id",
        externalMessageId: zernioMessageId,
        platformMessageId: wamid,
        status,
        occurredAt: `2026-08-12T05:44:1${status === "sent" ? 6 : status === "delivered" ? 7 : 8}.000Z`,
      });
    }

    const state = await env.DB.prepare(`SELECT status, external_message_id,
      platform_message_id FROM messages WHERE organization_id = ? AND id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        status: string;
        external_message_id: string;
        platform_message_id: string;
      }>();
    expect(state).toEqual({
      status: "read",
      external_message_id: zernioMessageId,
      platform_message_id: wamid,
    });
    const pending = await env.DB.prepare(`SELECT COUNT(*) AS pending
      FROM message_status_events
      WHERE organization_id = ? AND platform_message_id = ? AND reconciled_at IS NULL`)
      .bind(organizationId, wamid).first<{ pending: number }>();
    expect(pending?.pending).toBe(0);
    vi.unstubAllGlobals();
  });

  it("reconcilia estados fuera de orden recibidos antes de la respuesta", async () => {
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId,
      channelId,
      externalConversationId: "z-conversation-out-of-order",
      externalContactId: "wa-contact-out-of-order",
      externalMessageId: "z-message-out-of-order",
      platformMessageId: "wamid-inbound-out-of-order",
      text: "Consulta",
      occurredAt,
      correlationId: "81818181-8181-4181-8181-818181818181",
    });
    const outgoing = await repository.createOutgoing({
      organizationId,
      conversationId: inbound.conversationId,
      actorId: "staff-1",
      clientRequestId: "82828282-8282-4282-8282-828282828282",
      text: "Respuesta",
      correlationId: "83838383-8383-4383-8383-838383838383",
    });
    const statuses = [
      { eventId: "status-read-first", status: "read" as const,
        occurredAt: "2026-08-10T18:02:03.000Z" },
      { eventId: "status-delivered-second", status: "delivered" as const,
        occurredAt: "2026-08-10T18:02:02.000Z" },
      { eventId: "status-sent-last", status: "sent" as const,
        occurredAt: "2026-08-10T18:02:01.000Z" },
    ];
    for (const status of statuses) {
      await processInboundQueueMessage(env, {
        kind: "messageStatus",
        eventId: status.eventId,
        correlationId: "84848484-8484-4484-8484-848484848484",
        organizationId,
        channelId,
        externalAccountId: "account-beautyplace",
        externalConversationId: "z-conversation-out-of-order",
        externalMessageId: "z-outbound-out-of-order",
        platformMessageId: "wamid-outbound-out-of-order",
        status: status.status,
        occurredAt: status.occurredAt,
      });
    }

    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(Response.json({
      success: true,
      data: {
        messageId: "z-outbound-out-of-order",
        conversationId: "z-conversation-out-of-order",
        sentAt: "2026-08-10T18:02:01.000Z",
      },
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
        conversationId: inbound.conversationId,
        messageId: outgoing.messageId,
        correlationId: outgoing.correlationId,
      },
    )).resolves.toEqual({ action: "ack", result: "sent" });

    const state = await env.DB.prepare(`SELECT m.status AS message_status,
      m.external_message_id, m.platform_message_id,
      d.status AS delivery_status, d.last_error_code
      FROM messages m JOIN outbound_message_deliveries d
        ON d.organization_id = m.organization_id AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        message_status: string;
        external_message_id: string;
        platform_message_id: string;
        delivery_status: string;
        last_error_code: string | null;
      }>();
    expect(state).toEqual({
      message_status: "read",
      external_message_id: "z-outbound-out-of-order",
      platform_message_id: "wamid-outbound-out-of-order",
      delivery_status: "sent",
      last_error_code: null,
    });
    const events = await env.DB.prepare(`SELECT status, reconciled_at
      FROM message_status_events WHERE organization_id = ?
        AND message_external_id = ? ORDER BY status`)
      .bind(organizationId, "z-outbound-out-of-order")
      .all<{ status: string; reconciled_at: string | null }>();
    expect(events.results).toHaveLength(3);
    expect(events.results.every((event) => event.reconciled_at !== null)).toBe(true);
    expect(fetch).toHaveBeenCalledTimes(1);
    vi.unstubAllGlobals();
  });

  it("confirma en Queue un estado válido no vinculado después de persistirlo", async () => {
    const consoleInfo = vi.spyOn(console, "info").mockImplementation(() => undefined);
    const ack = vi.fn();
    const retry = vi.fn();
    const eventId = "status-unmatched-queue";

    await handleInboundQueue({
      queue: "inbound-test",
      messages: [{
        id: "queue-status-unmatched",
        timestamp: new Date(),
        body: {
          kind: "messageStatus",
          eventId,
          correlationId: "85858585-8585-4585-8585-858585858585",
          organizationId,
          channelId,
          externalAccountId: "account-beautyplace",
          externalConversationId: "unknown-conversation",
          externalMessageId: "unknown-message",
          platformMessageId: "unknown-platform-message",
          status: "read",
          occurredAt: "2026-08-10T18:03:00.000Z",
        },
        attempts: 1,
        ack,
        retry,
      }],
    } as unknown as MessageBatch<InboundQueueMessage>, env);

    expect(ack).toHaveBeenCalledOnce();
    expect(retry).not.toHaveBeenCalled();
    const persisted = await env.DB.prepare(`SELECT channel_id, reconciled_at
      FROM message_status_events
      WHERE organization_id = ? AND external_event_id = ?`)
      .bind(organizationId, eventId)
      .first<{ channel_id: string; reconciled_at: string | null }>();
    expect(persisted).toEqual({ channel_id: channelId, reconciled_at: null });
    expect(consoleInfo).toHaveBeenCalledWith(expect.stringContaining('"result":"unmatched"'));
    consoleInfo.mockRestore();
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
      d.status AS delivery_status, d.external_message_id,
      d.last_error_code, d.attempt_count
      FROM messages m JOIN outbound_message_deliveries d
        ON d.organization_id = m.organization_id AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        message_status: string;
        delivery_status: string;
        external_message_id: string;
        last_error_code: string;
        attempt_count: number;
      }>();
    expect(state).toEqual({
      message_status: "delivery_unknown",
      delivery_status: "delivery_unknown",
      external_message_id: "z-outbound-mismatch",
      last_error_code: "ZERNIO_CONVERSATION_MISMATCH",
      attempt_count: 1,
    });

    await processInboundQueueMessage(env, {
      kind: "messageStatus",
      eventId: "status-wrong-conversation",
      correlationId: "61616161-6161-4161-8161-616161616161",
      organizationId,
      channelId,
      externalAccountId: "account-beautyplace",
      externalConversationId: "another-conversation",
      externalMessageId: "z-outbound-mismatch",
      platformMessageId: "wamid-outbound-mismatch",
      status: "read",
      occurredAt: "2026-08-11T12:00:01.000Z",
    });
    const afterWrongConversation = await env.DB.prepare(
      "SELECT status FROM messages WHERE organization_id = ? AND id = ?",
    ).bind(organizationId, outgoing.messageId).first<{ status: string }>();
    expect(afterWrongConversation?.status).toBe("delivery_unknown");

    await processInboundQueueMessage(env, {
      kind: "messageStatus",
      eventId: "status-correct-conversation",
      correlationId: "62626262-6262-4262-8262-626262626262",
      organizationId,
      channelId,
      externalAccountId: "account-beautyplace",
      externalConversationId: "z-conversation-unknown",
      externalMessageId: "z-outbound-mismatch",
      platformMessageId: "wamid-outbound-mismatch",
      status: "read",
      occurredAt: "2026-08-11T12:00:02.000Z",
    });
    const recovered = await env.DB.prepare(`SELECT m.status AS message_status,
      m.external_message_id, m.platform_message_id,
      d.status AS delivery_status, d.last_error_code
      FROM messages m JOIN outbound_message_deliveries d
        ON d.organization_id = m.organization_id AND d.message_id = m.id
      WHERE m.organization_id = ? AND m.id = ?`)
      .bind(organizationId, outgoing.messageId)
      .first<{
        message_status: string;
        external_message_id: string;
        platform_message_id: string;
        delivery_status: string;
        last_error_code: string | null;
      }>();
    expect(recovered).toEqual({
      message_status: "read",
      external_message_id: "z-outbound-mismatch",
      platform_message_id: "wamid-outbound-mismatch",
      delivery_status: "sent",
      last_error_code: null,
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

  it("copia el adjunto autenticado y rechaza un host ajeno sin enviar la credencial", async () => {
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
    // El endpoint de medios streamea el binario, así que no declara
    // `Content-Length`: exigirlo rechazaría toda descarga legítima.
    const fetchMock = vi.fn<ZernioFetch>(async () =>
      new Response(new Uint8Array([1, 2, 3]), {
        headers: { "Content-Type": "image/png" },
      }),
    );
    const client = new ZernioClient("test-only-zernio-key", { fetch: fetchMock });

    await expect(persistInboundAttachments({
      client, db: env.DB, bucket, organizationId,
      externalAccountId: "account-beautyplace", messageId: inbound.messageId,
      attachments: [{
        type: "image",
        url: "https://zernio.com/api/v1/whatsapp/media/media-1",
        filename: "recibo-agosto.png",
      }],
    })).resolves.toEqual([{ status: "stored" }]);

    const [url, init] = fetchMock.mock.calls[0];
    expect(init?.headers).toMatchObject({
      Authorization: "Bearer test-only-zernio-key",
    });
    expect(new URL(String(url)).searchParams.get("accountId"))
      .toBe("account-beautyplace");

    const stored = await env.DB.prepare(`SELECT r2_key, byte_size, status,
      attachment_type FROM message_attachments
      WHERE organization_id = ? AND message_id = ?`)
      .bind(organizationId, inbound.messageId)
      .first<{ r2_key: string; byte_size: number; status: string; attachment_type: string }>();
    expect(stored).toMatchObject({ byte_size: 3, status: "stored", attachment_type: "image" });
    expect(objects.get(stored!.r2_key)?.byteLength).toBe(3);

    // El nombre declarado por el canal se conservaba en D1 pero no se leía, así
    // que el inbox no podía identificar el archivo más allá de su tipo.
    const withAttachment = await repository.listMessages(
      organizationId, inbound.conversationId, { limit: 50 },
    );
    expect(withAttachment.at(-1)?.attachments).toEqual([
      expect.objectContaining({
        type: "image",
        status: "stored",
        contentType: "image/png",
        byteSize: 3,
        filename: "recibo-agosto.png",
      }),
    ]);

    // Un host ajeno al proveedor nunca debe recibir la credencial: la URL llega
    // dentro del payload del webhook, que es entrada no confiable.
    const foreignFetch = vi.fn<ZernioFetch>();
    await expect(persistInboundAttachments({
      client: new ZernioClient("test-only-zernio-key", { fetch: foreignFetch }),
      db: env.DB, bucket, organizationId,
      externalAccountId: "account-beautyplace", messageId: inbound.messageId,
      attachments: [{ type: "image", url: "https://atacante.example.com/media/1" }],
    })).resolves.toEqual([{ status: "rejected", reason: "ATTACHMENT_HOST_REJECTED" }]);
    expect(foreignFetch).not.toHaveBeenCalled();
  });

  it("entrega el mensaje al inbox aunque su adjunto no pueda conservarse", async () => {
    // El criterio de salida de Fase 1 exige que un mensaje real aparezca en el
    // inbox. Antes, un adjunto irrecuperable propagaba su error, impedía
    // notificar al runtime y mandaba el evento a la DLQ: el mensaje existía en
    // D1 pero nunca llegaba a verse.
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(
      new Response("", { status: 400 }),
    ));
    await processInboundQueueMessage(
      {
        DB: env.DB,
        CustomerSupportAgent: env.CustomerSupportAgent,
        MEDIA_BUCKET: env.MEDIA_BUCKET,
        ZERNIO_API_KEY: "test-only-zernio-key",
      },
      {
        kind: "messageReceived",
        eventId: "event-media-blocking",
        correlationId: "dddddddd-dddd-4ddd-8ddd-dddddddddddd",
        organizationId,
        channelId,
        externalAccountId: "account-beautyplace",
        externalConversationId: "z-conversation-blocking",
        externalMessageId: "z-message-blocking",
        platformMessageId: "wamid-blocking",
        externalContactId: "wa-contact-blocking",
        text: null,
        attachments: [{
          type: "image",
          url: "https://zernio.com/api/v1/whatsapp/media/expirado",
        }],
        occurredAt: "2026-08-12T08:00:00.000Z",
      },
    );

    const repository = new ConversationRepository(env.DB);
    const conversations = await repository.list(organizationId, { limit: 30 });
    const conversation = conversations.find(
      (item) => item.lastMessageAt === "2026-08-12T08:00:00.000Z",
    );
    expect(conversation).toBeDefined();
    const messages = await repository.listMessages(
      organizationId, conversation!.id, { limit: 50 },
    );
    expect(messages).toHaveLength(1);
    expect(messages[0]).toMatchObject({ status: "received", messageType: "image" });
    expect(messages[0].attachments).toEqual([
      expect.objectContaining({
        type: "image",
        status: "rejected",
        failureReason: "ATTACHMENT_UNAVAILABLE_400",
        contentType: null,
        byteSize: null,
      }),
    ]);
    vi.unstubAllGlobals();
  });

  it("registra el adjunto irrecuperable y el tipo no soportado sin reintentar", async () => {
    const bucket = { put: vi.fn() } as unknown as R2Bucket;
    const repository = new ConversationRepository(env.DB);
    const inbound = await repository.upsertInbound({
      organizationId, channelId, externalConversationId: "z-conversation-media-2",
      externalContactId: "wa-contact-media-2", externalMessageId: "z-message-media-2",
      platformMessageId: "wamid-media-2", text: null, messageType: "sticker", occurredAt,
      correlationId: "cccccccc-cccc-4ccc-8ccc-cccccccccccc",
    });
    // `400` es la respuesta permanente cuando WhatsApp ya descartó el medio.
    const client = new ZernioClient("test-only-zernio-key", {
      fetch: async () => new Response("", { status: 400 }),
    });

    await expect(persistInboundAttachments({
      client, db: env.DB, bucket, organizationId,
      externalAccountId: "account-beautyplace", messageId: inbound.messageId,
      attachments: [
        { type: "image", url: "https://zernio.com/api/v1/whatsapp/media/expirado" },
        { type: "sticker", url: "https://zernio.com/api/v1/whatsapp/media/sticker" },
      ],
    })).resolves.toEqual([
      { status: "rejected", reason: "ATTACHMENT_UNAVAILABLE_400" },
      { status: "rejected", reason: "ATTACHMENT_TYPE_UNSUPPORTED" },
    ]);

    const rows = await env.DB.prepare(`SELECT attachment_type, status, failure_reason,
      r2_key FROM message_attachments WHERE organization_id = ? AND message_id = ?
      ORDER BY id`).bind(organizationId, inbound.messageId).all<{
        attachment_type: string; status: string; failure_reason: string; r2_key: string | null;
      }>();
    expect(rows.results).toEqual([
      { attachment_type: "image", status: "rejected", failure_reason: "ATTACHMENT_UNAVAILABLE_400", r2_key: null },
      { attachment_type: "sticker", status: "rejected", failure_reason: "ATTACHMENT_TYPE_UNSUPPORTED", r2_key: null },
    ]);
    expect(bucket.put).not.toHaveBeenCalled();
  });
});
