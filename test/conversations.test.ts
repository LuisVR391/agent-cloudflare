import { env } from "cloudflare:test";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { ConversationRepository } from "../src/worker/repositories/conversation-repository";
import { processOutboundQueueMessage } from "../src/worker/integrations/zernio/outbound-queue";
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
    await expect(repository.createOutgoing(request)).resolves.toEqual(first);
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
      { DB: env.DB, ZERNIO_API_KEY: "test-only-zernio-key" },
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
    expect(fetch).toHaveBeenCalledTimes(1);
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
