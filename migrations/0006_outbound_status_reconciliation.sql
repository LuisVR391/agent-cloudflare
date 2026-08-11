-- Migración 0006: conserva los identificadores opacos necesarios para
-- reconciliar webhooks aunque Queues los entregue antes que la respuesta de
-- envío. D1 continúa siendo la fuente canónica del resultado empresarial.

ALTER TABLE message_status_events
  ADD COLUMN channel_id TEXT;

ALTER TABLE message_status_events
  ADD COLUMN platform_message_id TEXT;

UPDATE message_status_events
SET channel_id = (
  SELECT iwe.channel_id
  FROM inbound_webhook_events iwe
  WHERE iwe.organization_id = message_status_events.organization_id
    AND iwe.external_event_id = message_status_events.external_event_id
  LIMIT 1
)
WHERE channel_id IS NULL;

UPDATE message_status_events
SET platform_message_id = (
  SELECT m.platform_message_id
  FROM messages m
  JOIN conversations c ON c.organization_id = m.organization_id
    AND c.id = m.conversation_id
  WHERE m.organization_id = message_status_events.organization_id
    AND c.external_conversation_id = message_status_events.conversation_external_id
    AND m.external_message_id = message_status_events.message_external_id
  LIMIT 1
)
WHERE platform_message_id IS NULL;

CREATE INDEX message_status_events_reconciliation_idx
  ON message_status_events (
    organization_id,
    channel_id,
    conversation_external_id,
    message_external_id,
    reconciled_at
  );

CREATE INDEX messages_organization_platform_idx
  ON messages (organization_id, conversation_id, platform_message_id)
  WHERE platform_message_id IS NOT NULL;

CREATE INDEX outbound_deliveries_organization_external_idx
  ON outbound_message_deliveries (organization_id, external_message_id)
  WHERE external_message_id IS NOT NULL;
