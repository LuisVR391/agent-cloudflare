import type { BetterAuthRateLimitStorage, RateLimit } from "better-auth";

type RateLimitRow = {
  request_count: number;
  last_request: number;
};

async function hashKey(secret: string, key: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(key));

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}

export function createRateLimitStorage(
  db: D1Database,
  secret: string,
): BetterAuthRateLimitStorage {
  return {
    async get(key): Promise<RateLimit | null> {
      const keyHash = await hashKey(secret, key);
      const row = await db
        .prepare(
          `SELECT request_count, last_request
           FROM auth_rate_limits
           WHERE key_hash = ?`,
        )
        .bind(keyHash)
        .first<RateLimitRow>();

      return row
        ? { key, count: row.request_count, lastRequest: row.last_request }
        : null;
    },

    async set(key, value): Promise<void> {
      const keyHash = await hashKey(secret, key);
      await db
        .prepare(
          `INSERT INTO auth_rate_limits (key_hash, request_count, last_request)
           VALUES (?, ?, ?)
           ON CONFLICT (key_hash) DO UPDATE SET
             request_count = excluded.request_count,
             last_request = excluded.last_request`,
        )
        .bind(keyHash, value.count, value.lastRequest)
        .run();
    },

    async consume(key, rule) {
      const keyHash = await hashKey(secret, key);
      const now = Date.now();
      const cutoff = now - rule.window * 1_000;
      const row = await db
        .prepare(
          `INSERT INTO auth_rate_limits (key_hash, request_count, last_request)
           VALUES (?, 1, ?)
           ON CONFLICT (key_hash) DO UPDATE SET
             request_count = CASE
               WHEN auth_rate_limits.last_request < ? THEN 1
               ELSE auth_rate_limits.request_count + 1
             END,
             last_request = CASE
               WHEN auth_rate_limits.last_request < ? THEN excluded.last_request
               ELSE auth_rate_limits.last_request
             END
           RETURNING request_count, last_request`,
        )
        .bind(keyHash, now, cutoff, cutoff)
        .first<RateLimitRow>();

      if (!row) {
        throw new Error("No se pudo registrar el límite de autenticación.");
      }

      return {
        allowed: row.request_count <= rule.max,
        retryAfter:
          row.request_count <= rule.max
            ? null
            : Math.max(
                1,
                Math.ceil(
                  (row.last_request + rule.window * 1_000 - now) / 1_000,
                ),
              ),
      };
    },
  };
}
