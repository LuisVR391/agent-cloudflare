-- Migración 0005: reconciliación explícita del evento message.sent.
--
-- SQLite no permite ampliar un CHECK existente. Las tablas se reconstruyen
-- conservando sus filas e índices para admitir la nueva transición sin editar
-- migraciones que ya pudieron aplicarse.

CREATE TABLE inbound_webhook_events_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('zernio')),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'message.received',
      'message.sent',
      'message.delivered',
      'message.read',
      'message.failed',
      'account.disconnected'
    )
  ),
  status TEXT NOT NULL DEFAULT 'received'
    CHECK (status IN ('received', 'enqueued', 'processed', 'failed')),
  correlation_id TEXT NOT NULL,
  received_at TEXT NOT NULL,
  enqueued_at TEXT,
  processed_at TEXT,
  failure_code TEXT,
  FOREIGN KEY (organization_id, channel_id)
    REFERENCES communication_channels (organization_id, id) ON DELETE CASCADE
);

INSERT INTO inbound_webhook_events_new
SELECT * FROM inbound_webhook_events;

DROP TABLE inbound_webhook_events;
ALTER TABLE inbound_webhook_events_new RENAME TO inbound_webhook_events;

CREATE UNIQUE INDEX inbound_webhook_events_adapter_event_unique
  ON inbound_webhook_events (adapter, external_event_id);
CREATE INDEX inbound_webhook_events_organization_received_idx
  ON inbound_webhook_events (organization_id, received_at);
CREATE INDEX inbound_webhook_events_organization_status_idx
  ON inbound_webhook_events (organization_id, status);

CREATE TABLE message_status_events_new (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  external_event_id TEXT NOT NULL,
  conversation_external_id TEXT NOT NULL,
  message_external_id TEXT NOT NULL,
  status TEXT NOT NULL CHECK (status IN ('sent', 'delivered', 'read', 'failed')),
  occurred_at TEXT NOT NULL,
  reconciled_at TEXT,
  created_at TEXT NOT NULL
);

INSERT INTO message_status_events_new
SELECT * FROM message_status_events;

DROP TABLE message_status_events;
ALTER TABLE message_status_events_new RENAME TO message_status_events;

CREATE UNIQUE INDEX message_status_events_external_unique
  ON message_status_events (organization_id, external_event_id);
CREATE INDEX message_status_events_organization_message_idx
  ON message_status_events (organization_id, message_external_id, occurred_at);
