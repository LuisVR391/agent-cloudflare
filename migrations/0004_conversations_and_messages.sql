-- Migración 0004: historial canónico de conversaciones y mensajes de Fase 1.
-- D1 conserva la autoridad empresarial; el Durable Object solo coordina el
-- estado vivo. Los secretos y cuerpos binarios permanecen fuera de D1.

CREATE UNIQUE INDEX contacts_organization_id_unique
  ON contacts (organization_id, id);

ALTER TABLE communication_channels
  ADD COLUMN buffer_seconds INTEGER NOT NULL DEFAULT 8
    CHECK (buffer_seconds BETWEEN 0 AND 30);

CREATE TABLE conversations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  contact_id TEXT NOT NULL,
  external_conversation_id TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved')),
  attention_mode TEXT NOT NULL DEFAULT 'human'
    CHECK (attention_mode IN ('automatic', 'supervised', 'human', 'paused')),
  version INTEGER NOT NULL DEFAULT 1,
  last_message_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, channel_id)
    REFERENCES communication_channels (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX conversations_external_unique
  ON conversations (organization_id, channel_id, external_conversation_id);
CREATE UNIQUE INDEX conversations_organization_id_unique
  ON conversations (organization_id, id);
CREATE INDEX conversations_organization_activity_idx
  ON conversations (organization_id, status, last_message_at DESC, id DESC);

CREATE TABLE messages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  external_message_id TEXT,
  platform_message_id TEXT,
  client_request_id TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('incoming', 'outgoing')),
  sender_type TEXT NOT NULL CHECK (sender_type IN ('customer', 'staff', 'system')),
  sender_id TEXT,
  message_type TEXT NOT NULL CHECK (message_type IN ('text', 'audio', 'image', 'document')),
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

CREATE TABLE message_attachments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  attachment_type TEXT NOT NULL CHECK (attachment_type IN ('audio', 'image', 'document')),
  content_type TEXT NOT NULL,
  byte_size INTEGER NOT NULL CHECK (byte_size >= 0 AND byte_size <= 16777216),
  r2_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, message_id)
    REFERENCES messages (organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX message_attachments_r2_unique ON message_attachments (r2_key);
CREATE INDEX message_attachments_organization_message_idx
  ON message_attachments (organization_id, message_id);

CREATE TABLE message_status_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  conversation_external_id TEXT NOT NULL,
  message_external_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('delivered', 'read', 'failed')),
  occurred_at TEXT NOT NULL,
  reconciled_at TEXT,
  created_at TEXT NOT NULL
);

CREATE UNIQUE INDEX message_status_events_external_unique
  ON message_status_events (organization_id, external_event_id);
CREATE INDEX message_status_events_organization_message_idx
  ON message_status_events (organization_id, message_external_id, occurred_at);

CREATE TABLE outbound_message_deliveries (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  message_id TEXT NOT NULL,
  idempotency_key TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'sending', 'sent', 'failed', 'delivery_unknown')),
  attempt_count INTEGER NOT NULL DEFAULT 0,
  external_message_id TEXT,
  last_error_code TEXT,
  last_attempt_at TEXT,
  sent_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, message_id)
    REFERENCES messages (organization_id, id) ON DELETE CASCADE
);

CREATE UNIQUE INDEX outbound_deliveries_message_unique
  ON outbound_message_deliveries (organization_id, message_id);
CREATE UNIQUE INDEX outbound_deliveries_idempotency_unique
  ON outbound_message_deliveries (organization_id, idempotency_key);
CREATE INDEX outbound_deliveries_organization_status_idx
  ON outbound_message_deliveries (organization_id, status, updated_at);

CREATE TABLE conversation_status_history (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'system')),
  actor_id TEXT,
  previous_status TEXT,
  next_status TEXT,
  previous_attention_mode TEXT,
  next_attention_mode TEXT,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX conversation_status_history_organization_idx
  ON conversation_status_history (organization_id, conversation_id, occurred_at DESC);
