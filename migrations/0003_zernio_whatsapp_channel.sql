-- Migración 0003: canal de WhatsApp mediante Zernio y recepción idempotente.
--
-- D1 conserva la relación confiable entre la cuenta externa, el canal y la
-- organización. Los secretos permanecen en Cloudflare Secrets y los payloads
-- completos del proveedor no se almacenan en esta tabla de recepción.

CREATE TABLE communication_channels (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  provider TEXT NOT NULL CHECK (provider IN ('whatsapp')),
  adapter TEXT NOT NULL CHECK (adapter IN ('zernio')),
  external_account_id TEXT NOT NULL,
  external_profile_id TEXT,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'disconnected')),
  disconnected_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX communication_channels_adapter_account_unique
  ON communication_channels (adapter, external_account_id);

CREATE UNIQUE INDEX communication_channels_organization_id_unique
  ON communication_channels (organization_id, id);

CREATE INDEX communication_channels_organization_status_idx
  ON communication_channels (organization_id, status);

CREATE TABLE inbound_webhook_events (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  channel_id TEXT NOT NULL,
  adapter TEXT NOT NULL CHECK (adapter IN ('zernio')),
  external_event_id TEXT NOT NULL,
  event_type TEXT NOT NULL CHECK (
    event_type IN (
      'message.received',
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

CREATE UNIQUE INDEX inbound_webhook_events_adapter_event_unique
  ON inbound_webhook_events (adapter, external_event_id);

CREATE INDEX inbound_webhook_events_organization_received_idx
  ON inbound_webhook_events (organization_id, received_at);

CREATE INDEX inbound_webhook_events_organization_status_idx
  ON inbound_webhook_events (organization_id, status);
