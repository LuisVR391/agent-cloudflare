#!/usr/bin/env node
// Simula un mensaje entrante de WhatsApp contra el servidor de desarrollo.
//
// El panel local nace vacío: sin un canal en D1 el webhook responde
// `UNKNOWN_CHANNEL`, y sin conversaciones no hay nada que validar en el inbox,
// los contactos ni lo que venga después. Este script cubre ese hueco enviando
// un evento firmado por el mismo camino que el proveedor real —webhook, cola,
// Durable Object y D1—, en vez de insertar filas a mano.
//
// Es herramienta de desarrollo: no forma parte del Worker desplegado, no
// declara bindings y solo habla con `localhost`.

import { createHmac } from "node:crypto";
import { execFileSync } from "node:child_process";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const repositoryRoot = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  "..",
);
const DATABASE = "agent-cloudflare-db";
const CHANNEL_ID = "c0000000-0000-4000-8000-000000000001";
const DEFAULT_ACCOUNT = "local-account-1";

function usage() {
  console.log(`Uso: npm run dev:inbound -- [opciones]

  --text <mensaje>          Texto del mensaje entrante
  --phone <número>          Teléfono del remitente
  --conversation <id>       Hilo al que pertenece; repetirlo continúa el mismo
  --event <id>              Identificador del evento; repetirlo prueba la deduplicación
  --origin <url>            Servidor local (por defecto http://localhost:5190)

Requiere \`npm run dev\` en marcha y la instalación inicial completada en /setup.`);
}

function parseArguments(argv) {
  const options = new Map();
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!flag.startsWith("--")) continue;
    if (flag === "--help") return null;
    options.set(flag.slice(2), argv[index + 1]);
    index += 1;
  }
  return options;
}

/**
 * Solo localhost. Firmar eventos falsos contra staging o producción
 * inventaría conversaciones en una base real, así que no es una comprobación
 * de comodidad.
 */
function requireLocalOrigin(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`El origen \`${value}\` no es una URL válida.`);
  }
  if (url.hostname !== "localhost" && url.hostname !== "127.0.0.1") {
    throw new Error(
      `Este script solo apunta a localhost; \`${url.hostname}\` no lo es.`,
    );
  }
  return url.origin;
}

/**
 * Lee el secreto del webhook sin exponerlo: se usa para firmar y nunca se
 * imprime, ni siquiera en un mensaje de error.
 */
function webhookSecret() {
  const file = path.join(repositoryRoot, ".dev.vars");
  if (!existsSync(file)) {
    throw new Error(
      "Falta `.dev.vars`. Cópialo de `.dev.vars.example` y define ZERNIO_WEBHOOK_SECRET.",
    );
  }
  const secret = readFileSync(file, "utf8")
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.startsWith("ZERNIO_WEBHOOK_SECRET="))
    .map((line) =>
      line.slice("ZERNIO_WEBHOOK_SECRET=".length).replace(/^["']|["']$/g, ""),
    )
    .at(0);
  if (!secret) {
    throw new Error("`.dev.vars` no define ZERNIO_WEBHOOK_SECRET.");
  }
  return secret;
}

// `--local` es fijo: la ejecución remota de D1 desde un script del repositorio
// está prohibida y no debe depender de un argumento.
function queryLocalDatabase(sql) {
  const output = execFileSync(
    "npx",
    ["wrangler", "d1", "execute", DATABASE, "--local", "--json", "--command", sql],
    { cwd: repositoryRoot, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] },
  );
  const start = output.indexOf("[");
  if (start < 0) return [];
  return JSON.parse(output.slice(start)).at(0)?.results ?? [];
}

function resolveOrganization() {
  const rows = queryLocalDatabase(
    "SELECT id, display_name FROM organizations ORDER BY created_at LIMIT 1",
  );
  if (rows.length === 0) {
    throw new Error(
      "La base local no tiene organizaciones. Completa /setup antes de sembrar mensajes.",
    );
  }
  return rows[0];
}

/**
 * El canal es lo que permite al webhook resolver organización y hilo. Se crea
 * con `buffer_seconds` en 0 para que el mensaje aparezca sin esperar la
 * ventana de agrupación que usa el canal real.
 */
function ensureChannel(organizationId, accountId) {
  const existing = queryLocalDatabase(
    `SELECT id FROM communication_channels WHERE adapter = 'zernio'
      AND external_account_id = '${accountId}'`,
  );
  if (existing.length > 0) return { id: existing[0].id, created: false };

  queryLocalDatabase(
    `INSERT INTO communication_channels
       (id, organization_id, provider, adapter, external_account_id,
        display_name, status, buffer_seconds, created_at, updated_at)
     VALUES ('${CHANNEL_ID}', '${organizationId}', 'whatsapp', 'zernio',
       '${accountId}', 'WhatsApp local', 'active', 0,
       strftime('%Y-%m-%dT%H:%M:%fZ','now'), strftime('%Y-%m-%dT%H:%M:%fZ','now'))`,
  );
  return { id: CHANNEL_ID, created: true };
}

function buildEvent({ accountId, conversationId, eventId, text, phone }) {
  const now = new Date().toISOString();
  return {
    id: eventId,
    event: "message.received",
    timestamp: now,
    account: {
      id: accountId,
      accountId,
      platform: "whatsapp",
      username: "salon-local",
      displayName: "WhatsApp local",
    },
    conversation: {
      id: conversationId,
      platformConversationId: `wa-${conversationId}`,
      status: "active",
    },
    message: {
      id: `${eventId}-message`,
      conversationId,
      platform: "whatsapp",
      platformMessageId: `wamid-${eventId}`,
      direction: "incoming",
      text,
      attachments: [],
      sender: { id: `wa-sender-${phone}`, phoneNumber: phone },
      sentAt: now,
      isRead: false,
    },
  };
}

async function main() {
  const options = parseArguments(process.argv.slice(2));
  if (options === null) {
    usage();
    return;
  }

  const origin = requireLocalOrigin(
    options.get("origin") ?? "http://localhost:5190",
  );
  const accountId = options.get("account") ?? DEFAULT_ACCOUNT;
  const suffix = String(Date.now());
  const conversationId = options.get("conversation") ?? `local-conversation-${suffix}`;
  const eventId = options.get("event") ?? `local-event-${suffix}`;
  const text = options.get("text") ?? "Hola, ¿tienen espacio hoy?";
  const phone = options.get("phone") ?? "+52 55 1234 5678";

  const secret = webhookSecret();
  const organization = resolveOrganization();
  const channel = ensureChannel(organization.id, accountId);
  if (channel.created) {
    console.log(`Canal local creado para ${organization.display_name}.`);
  }

  const body = JSON.stringify(
    buildEvent({ accountId, conversationId, eventId, text, phone }),
  );
  const signature = createHmac("sha256", secret).update(body).digest("hex");

  const response = await fetch(`${origin}/webhooks/zernio`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      "x-zernio-signature": signature,
      "x-zernio-event-id": eventId,
    },
    body,
  });

  if (response.status === 202) {
    console.log(`Mensaje aceptado en el hilo ${conversationId}.`);
    return;
  }
  if (response.status === 200) {
    console.log(`Evento ${eventId} ya recibido; la deduplicación lo ignoró.`);
    return;
  }
  console.error(`El webhook respondió ${response.status}: ${await response.text()}`);
  process.exitCode = 1;
}

try {
  await main();
} catch (error) {
  console.error(error instanceof Error ? error.message : error);
  process.exitCode = 1;
}
