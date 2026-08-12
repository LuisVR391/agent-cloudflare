import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// El endpoint de adjuntos no tenía cobertura, y por eso un identificador sin
// decodificar sobrevivió: la interfaz lo escapa al construir el enlace, así que
// la búsqueda usaba el literal `%3A` y ningún adjunto conservado se encontraba.
const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const owner = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón Aurora",
  organizationSlug: "salon-aurora",
  ownerName: "Ana Propietaria",
  ownerEmail: "ana@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

const conversationId = "aaaaaaaa-aaaa-4aaa-8aaa-aaaaaaaaaaaa";
const messageId = "bbbbbbbb-bbbb-4bbb-8bbb-bbbbbbbbbbbb";
// La forma real: `${messageId}:${index}`, con un `:` que la URL escapa.
const attachmentId = `${messageId}:0`;
const bytes = new Uint8Array([137, 80, 78, 71]);

let cookie = "";

describe("descarga de adjuntos", () => {
  beforeAll(async () => {
    await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(owner),
    });
    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: owner.ownerEmail,
        password: owner.ownerPassword,
      }),
    });
    cookie = login.headers.get("set-cookie") ?? "";

    const organization = await env.DB.prepare(
      "SELECT id FROM organizations WHERE slug = ?",
    ).bind(owner.organizationSlug).first<{ id: string }>();
    const organizationId = organization!.id;
    const now = new Date().toISOString();
    const channelId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
    const contactId = "dddddddd-dddd-4ddd-8ddd-dddddddddddd";
    const key = `${organizationId}/conversations/${messageId}/0`;

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id, status,
         created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', 'account-1', 'active', ?, ?)`)
        .bind(channelId, organizationId, now, now),
      env.DB.prepare(`INSERT INTO contacts
        (id, organization_id, display_name, created_at, updated_at)
        VALUES (?, ?, 'Cliente', ?, ?)`)
        .bind(contactId, organizationId, now, now),
      env.DB.prepare(`INSERT INTO conversations
        (id, organization_id, channel_id, contact_id, external_conversation_id,
         status, attention_mode, version, last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, 'z-conv', 'open', 'human', 1, ?, ?, ?)`)
        .bind(conversationId, organizationId, channelId, contactId, now, now, now),
      env.DB.prepare(`INSERT INTO messages
        (id, organization_id, conversation_id, direction, sender_type,
         message_type, status, correlation_id, occurred_at, created_at, updated_at)
        VALUES (?, ?, ?, 'incoming', 'customer', 'image', 'received',
          'eeeeeeee-eeee-4eee-8eee-eeeeeeeeeeee', ?, ?, ?)`)
        .bind(messageId, organizationId, conversationId, now, now, now),
      env.DB.prepare(`INSERT INTO message_attachments
        (id, organization_id, message_id, attachment_type, content_type,
         byte_size, r2_key, status, created_at, updated_at)
        VALUES (?, ?, ?, 'image', 'image/png', ?, ?, 'stored', ?, ?)`)
        .bind(attachmentId, organizationId, messageId, bytes.byteLength, key, now, now),
      env.DB.prepare(`INSERT INTO message_attachments
        (id, organization_id, message_id, attachment_type, status,
         failure_reason, created_at, updated_at)
        VALUES (?, ?, ?, 'sticker', 'rejected', 'ATTACHMENT_TYPE_UNSUPPORTED', ?, ?)`)
        .bind(`${messageId}:1`, organizationId, messageId, now, now),
    ]);
    await env.MEDIA_BUCKET.put(key, bytes);
  });

  it("entrega el binario cuando el identificador viaja escapado en la URL", async () => {
    const response = await fetchWorker(
      `/api/conversations/${conversationId}/attachments/${encodeURIComponent(attachmentId)}`,
      { headers: { cookie } },
    );

    expect(response.status).toBe(200);
    expect(response.headers.get("Content-Type")).toBe("image/png");
    expect(response.headers.get("X-Content-Type-Options")).toBe("nosniff");
    expect(response.headers.get("Cache-Control")).toBe("private, no-store");
    await expect(response.arrayBuffer()).resolves.toEqual(bytes.buffer);
  });

  it("distingue un adjunto no conservado de uno inexistente", async () => {
    const noStored = await fetchWorker(
      `/api/conversations/${conversationId}/attachments/${encodeURIComponent(`${messageId}:1`)}`,
      { headers: { cookie } },
    );
    expect(noStored.status).toBe(409);
    await expect(noStored.json()).resolves.toMatchObject({
      error: { code: "ATTACHMENT_TYPE_UNSUPPORTED" },
    });

    const missing = await fetchWorker(
      `/api/conversations/${conversationId}/attachments/${encodeURIComponent(`${messageId}:9`)}`,
      { headers: { cookie } },
    );
    expect(missing.status).toBe(404);
  });

  it("exige sesión autenticada", async () => {
    const response = await fetchWorker(
      `/api/conversations/${conversationId}/attachments/${encodeURIComponent(attachmentId)}`,
    );
    expect(response.status).toBe(401);
  });
});
