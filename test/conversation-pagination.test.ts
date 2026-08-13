import { env } from "cloudflare:test";
import { exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

// La paginación existía en el servidor pero nadie la ejercitaba, y comparaba solo
// el timestamp contra un orden compuesto por `(timestamp, id)`. Con filas
// empatadas cortadas por el límite, el resto del grupo quedaba inalcanzable: una
// conversación desaparecía del inbox y un tramo del historial no se podía
// alcanzar, sin ningún error visible. El canal emite timestamps con precisión de
// segundos, así que el empate es el caso normal de una ráfaga.
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

const channelId = "cccccccc-cccc-4ccc-8ccc-cccccccccccc";
// Cuatro conversaciones: tres empatadas en `last_message_at` y una anterior.
const tiedAt = "2026-08-12T08:00:00Z";
const olderAt = "2026-08-12T07:00:00Z";
const conversationIds = [
  "11111111-1111-4111-8111-111111111111",
  "22222222-2222-4222-8222-222222222222",
  "33333333-3333-4333-8333-333333333333",
  "44444444-4444-4444-8444-444444444444",
];
// Cinco mensajes en la primera conversación, cuatro empatados en `occurred_at`.
const messageTiedAt = "2026-08-12T08:00:00Z";
const messageIds = [
  "aaaaaaaa-0000-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaaa-1111-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaaa-2222-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaaa-3333-4aaa-8aaa-aaaaaaaaaaaa",
  "aaaaaaaa-4444-4aaa-8aaa-aaaaaaaaaaaa",
];

let cookie = "";
let organizationId = "";

/** Recorre todas las páginas y devuelve los identificadores en orden de llegada. */
async function drain(
  path: string,
  pick: (payload: Record<string, unknown>) => Array<{ id: string }>,
): Promise<{ ids: string[]; requests: number }> {
  const ids: string[] = [];
  let cursor: string | null = null;
  let requests = 0;
  do {
    const query = cursor === null ? "" : `&cursor=${encodeURIComponent(cursor)}`;
    const response = await fetchWorker(`${path}${query}`, { headers: { cookie } });
    expect(response.status).toBe(200);
    const payload = (await response.json()) as Record<string, unknown>;
    ids.push(...pick(payload).map((item) => item.id));
    cursor = payload.nextCursor as string | null;
    requests += 1;
    // Un cursor que no avanza convertiría la prueba en un bucle infinito.
    expect(requests).toBeLessThan(20);
  } while (cursor !== null);
  return { ids, requests };
}

describe("paginación del inbox", () => {
  beforeAll(async () => {
    await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(owner),
    });
    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ email: owner.ownerEmail, password: owner.ownerPassword }),
    });
    cookie = login.headers.get("set-cookie") ?? "";

    const organization = await env.DB.prepare(
      "SELECT id FROM organizations WHERE slug = ?",
    ).bind(owner.organizationSlug).first<{ id: string }>();
    organizationId = organization!.id;
    const now = new Date().toISOString();

    const statements = [
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id, status,
         created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', 'account-1', 'active', ?, ?)`)
        .bind(channelId, organizationId, now, now),
    ];

    conversationIds.forEach((conversationId, index) => {
      const contactId = `dddddddd-${index}${index}${index}${index}-4ddd-8ddd-dddddddddddd`;
      statements.push(
        env.DB.prepare(`INSERT INTO contacts
          (id, organization_id, display_name, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?)`)
          .bind(contactId, organizationId, `Cliente ${index}`, now, now),
        env.DB.prepare(`INSERT INTO contact_identities
          (id, organization_id, contact_id, provider, external_id, created_at, updated_at)
          VALUES (?, ?, ?, 'whatsapp', ?, ?, ?)`)
          .bind(`eeeeeeee-${index}${index}${index}${index}-4eee-8eee-eeeeeeeeeeee`,
            organizationId, contactId, `wa-${index}`, now, now),
        env.DB.prepare(`INSERT INTO conversations
          (id, organization_id, channel_id, contact_id, external_conversation_id,
           status, attention_mode, version, last_message_at, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'open', 'human', 1, ?, ?, ?)`)
          .bind(conversationId, organizationId, channelId, contactId,
            `z-conv-${index}`, index === 3 ? olderAt : tiedAt, now, now),
      );
    });

    messageIds.forEach((messageId, index) => {
      statements.push(
        env.DB.prepare(`INSERT INTO messages
          (id, organization_id, conversation_id, direction, sender_type,
           message_type, text_content, status, correlation_id, occurred_at,
           created_at, updated_at)
          VALUES (?, ?, ?, 'incoming', 'customer', 'text', ?, 'received', ?, ?, ?, ?)`)
          .bind(messageId, organizationId, conversationIds[0], `Mensaje ${index}`,
            `ffffffff-${index}${index}${index}${index}-4fff-8fff-ffffffffffff`,
            index === 4 ? olderAt : messageTiedAt, now, now),
      );
    });

    await env.DB.batch(statements);
  });

  it("recorre las conversaciones empatadas sin perder ninguna", async () => {
    const { ids, requests } = await drain(
      "/api/conversations?status=open&limit=2",
      (payload) => payload.conversations as Array<{ id: string }>,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...conversationIds].sort());
    // Con límite 2 y cuatro filas: dos páginas completas y una tercera vacía no,
    // porque `nextCursor` ya es nulo en la que agota el conjunto.
    expect(requests).toBe(2);
  });

  it("recorre los mensajes empatados sin perder ninguno", async () => {
    const { ids } = await drain(
      `/api/conversations/${conversationIds[0]}/messages?limit=2`,
      (payload) => payload.messages as Array<{ id: string }>,
    );

    expect(new Set(ids).size).toBe(ids.length);
    expect([...ids].sort()).toEqual([...messageIds].sort());
  });

  it("anuncia el final con un cursor nulo", async () => {
    const full = await fetchWorker("/api/conversations?status=open&limit=100", {
      headers: { cookie },
    });
    await expect(full.json()).resolves.toMatchObject({ nextCursor: null });

    const partial = await fetchWorker("/api/conversations?status=open&limit=2", {
      headers: { cookie },
    });
    const payload = (await partial.json()) as { nextCursor: string | null };
    expect(payload.nextCursor).not.toBeNull();
  });

  it("rechaza un cursor mal formado sin tocar la consulta", async () => {
    for (const cursor of ["", "sin-separador", "|solo-id", `${tiedAt}|`, "x".repeat(200)]) {
      const response = await fetchWorker(
        `/api/conversations?status=open&cursor=${encodeURIComponent(cursor)}`,
        { headers: { cookie } },
      );
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_CURSOR" },
      });
    }
  });

  it("valida el límite y lo recorta en silencio por encima del máximo", async () => {
    for (const limit of ["0", "abc", "-3", "2.5"]) {
      const response = await fetchWorker(`/api/conversations?limit=${limit}`, {
        headers: { cookie },
      });
      expect(response.status).toBe(400);
      await expect(response.json()).resolves.toMatchObject({
        error: { code: "INVALID_LIMIT" },
      });
    }

    const clamped = await fetchWorker("/api/conversations?status=open&limit=5000", {
      headers: { cookie },
    });
    expect(clamped.status).toBe(200);
  });

  it("no filtra filas de otra organización con un cursor ajeno", async () => {
    // Un cursor es opaco y no autoriza: la consulta sigue acotada por la
    // organización de la sesión.
    const foreign = `${tiedAt}|00000000-0000-4000-8000-000000000000`;
    const response = await fetchWorker(
      `/api/conversations?status=open&cursor=${encodeURIComponent(foreign)}`,
      { headers: { cookie } },
    );
    expect(response.status).toBe(200);
    const payload = (await response.json()) as { conversations: Array<{ id: string }> };
    for (const conversation of payload.conversations) {
      expect(conversationIds).toContain(conversation.id);
    }
  });

  it("exige sesión autenticada", async () => {
    const response = await fetchWorker("/api/conversations?status=open");
    expect(response.status).toBe(401);
  });
});
