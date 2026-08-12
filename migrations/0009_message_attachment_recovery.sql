-- Migración 0009: adjuntos recuperables y tipos reales del canal.
--
-- `message_attachments` solo registraba copias exitosas, así que un medio
-- perdido no dejaba rastro y no existía recuperación operativa posible. Ahora
-- conserva el estado del intento y el motivo del rechazo, y sus columnas de
-- contenido admiten nulos porque un adjunto puede existir sin bytes copiados.
--
-- Los tipos de ambos CHECK se amplían a los que el proveedor emite realmente
-- (`image`, `video`, `audio`, `file`, `sticker`, `share`) más `unsupported`
-- para lo que no reconocemos. `document` no existe en el canal y desaparece
-- tras convertir las filas previas a `file`.
--
-- SQLite no permite alterar un CHECK, de modo que ambas tablas se recrean.
-- La migración es aplicable desde una base vacía y conserva los datos previos.

PRAGMA foreign_keys = OFF;

CREATE TABLE messages_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  external_message_id TEXT,
  platform_message_id TEXT,
  client_request_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'staff', 'system')),
  sender_id TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN
    ('text', 'image', 'video', 'audio', 'file', 'sticker', 'share', 'unsupported')),
  text_content TEXT,
  status TEXT NOT NULL
    CHECK (status IN ('received', 'queued', 'sent', 'delivered', 'read', 'failed', 'delivery_unknown')),
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE CASCADE
);

INSERT INTO messages_new
  SELECT id, organization_id, conversation_id, external_message_id,
    platform_message_id, client_request_id, direction, sender_type, sender_id,
    CASE message_type WHEN 'document' THEN 'file' ELSE message_type END,
    text_content, status, correlation_id, occurred_at, created_at, updated_at
  FROM messages;

DROP TABLE messages;
ALTER TABLE messages_new RENAME TO messages;

CREATE UNIQUE INDEX messages_external_unique
  ON messages (organization_id, conversation_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
CREATE UNIQUE INDEX messages_client_request_unique
  ON messages (organization_id, client_request_id)
  WHERE client_request_id IS NOT NULL;
CREATE UNIQUE INDEX messages_organization_id_unique
  ON messages (organization_id, id);
CREATE INDEX messages_organization_conversation_idx
  ON messages (organization_id, conversation_id, occurred_at DESC, id DESC);
-- Añadido en `0006`; recrear la tabla lo habría perdido silenciosamente y con
-- él la búsqueda por identificador de plataforma que usa la reconciliación.
CREATE INDEX messages_organization_platform_idx
  ON messages (organization_id, conversation_id, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

CREATE TABLE message_attachments_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN
    ('image', 'video', 'audio', 'file', 'sticker', 'share', 'unsupported')),
  content_type TEXT,
  byte_size INTEGER CHECK (byte_size IS NULL OR (byte_size >= 0 AND byte_size <= 16777216)),
  r2_key TEXT,
  status TEXT NOT NULL DEFAULT 'stored' CHECK (status IN ('stored', 'rejected')),
  failure_reason TEXT,
  external_media_id TEXT,
  filename TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, message_id)
    REFERENCES messages (organization_id, id) ON DELETE CASCADE
);

INSERT INTO message_attachments_new
  (id, organization_id, message_id, attachment_type, content_type, byte_size,
   r2_key, status, failure_reason, external_media_id, filename, created_at,
   updated_at)
  SELECT id, organization_id, message_id,
    CASE attachment_type WHEN 'document' THEN 'file' ELSE attachment_type END,
    content_type, byte_size, r2_key, 'stored', NULL, NULL, NULL, created_at,
    created_at
  FROM message_attachments;

DROP TABLE message_attachments;
ALTER TABLE message_attachments_new RENAME TO message_attachments;

-- Único solo entre copias reales: un adjunto rechazado no ocupa clave en R2.
CREATE UNIQUE INDEX message_attachments_r2_unique
  ON message_attachments (r2_key) WHERE r2_key IS NOT NULL;
CREATE INDEX message_attachments_organization_message_idx
  ON message_attachments (organization_id, message_id);

PRAGMA foreign_keys = ON;
