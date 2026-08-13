import { InvalidPersistedValueError } from "../domain/errors";
import type {
  ChannelAdapter,
  ChannelProvider,
  ChannelStatus,
  CommunicationChannel,
  Contact,
  ContactIdentity,
  ContactStatus,
  ContactTag,
  ContactTagColor,
  IdentityProvider,
  InboundWebhookEvent,
  InboundWebhookEventStatus,
  InboundWebhookEventType,
  Organization,
  OrganizationStatus,
} from "../domain/types";

/**
 * Único punto donde el repositorio traduce las columnas `snake_case` de D1 a
 * los tipos `camelCase` del dominio. Ninguna capa superior conoce nombres
 * físicos de columna (ADR-0006).
 */

export type OrganizationRow = {
  id: string;
  slug: string;
  display_name: string;
  status: string;
  created_at: string;
  updated_at: string;
};

export type ContactRow = {
  id: string;
  organization_id: string;
  display_name: string | null;
  phone_number: string | null;
  email: string | null;
  status: string;
  version: number;
  created_at: string;
  updated_at: string;
};

export type ContactTagRow = {
  id: string;
  organization_id: string;
  name: string;
  color: string;
  created_at: string;
  updated_at: string;
};

export type ContactIdentityRow = {
  id: string;
  organization_id: string;
  contact_id: string;
  provider: string;
  external_id: string;
  created_at: string;
  updated_at: string;
};

export type CommunicationChannelRow = {
  id: string;
  organization_id: string;
  provider: string;
  adapter: string;
  external_account_id: string;
  external_profile_id: string | null;
  display_name: string | null;
  status: string;
  disconnected_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InboundWebhookEventRow = {
  id: string;
  organization_id: string;
  channel_id: string;
  adapter: string;
  external_event_id: string;
  event_type: string;
  status: string;
  correlation_id: string;
  received_at: string;
  enqueued_at: string | null;
  processed_at: string | null;
  failure_code: string | null;
};

const organizationStatuses: readonly OrganizationStatus[] = [
  "active",
  "suspended",
];
const contactStatuses: readonly ContactStatus[] = ["active", "archived"];
const contactTagColors: readonly ContactTagColor[] = [
  "neutral",
  "info",
  "success",
  "warning",
  "danger",
];
const identityProviders: readonly IdentityProvider[] = ["whatsapp"];
const channelProviders: readonly ChannelProvider[] = ["whatsapp"];
const channelAdapters: readonly ChannelAdapter[] = ["zernio"];
const channelStatuses: readonly ChannelStatus[] = ["active", "disconnected"];
const inboundWebhookEventTypes: readonly InboundWebhookEventType[] = [
  "message.received",
  "message.sent",
  "message.delivered",
  "message.read",
  "message.failed",
  "account.disconnected",
];
const inboundWebhookEventStatuses: readonly InboundWebhookEventStatus[] = [
  "received",
  "enqueued",
  "processed",
  "failed",
];

function asMember<T extends string>(
  allowed: readonly T[],
  value: string,
  column: string,
): T {
  const match = allowed.find((candidate) => candidate === value);
  if (match === undefined) {
    throw new InvalidPersistedValueError(column, value);
  }
  return match;
}

export function toOrganization(row: OrganizationRow): Organization {
  return {
    id: row.id,
    slug: row.slug,
    displayName: row.display_name,
    status: asMember(organizationStatuses, row.status, "organizations.status"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toContact(row: ContactRow): Contact {
  return {
    id: row.id,
    organizationId: row.organization_id,
    displayName: row.display_name,
    phoneNumber: row.phone_number,
    email: row.email,
    status: asMember(contactStatuses, row.status, "contacts.status"),
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toContactTag(row: ContactTagRow): ContactTag {
  return {
    id: row.id,
    organizationId: row.organization_id,
    name: row.name,
    color: asMember(contactTagColors, row.color, "contact_tags.color"),
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toContactIdentity(row: ContactIdentityRow): ContactIdentity {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    provider: asMember(
      identityProviders,
      row.provider,
      "contact_identities.provider",
    ),
    externalId: row.external_id,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toCommunicationChannel(
  row: CommunicationChannelRow,
): CommunicationChannel {
  return {
    id: row.id,
    organizationId: row.organization_id,
    provider: asMember(
      channelProviders,
      row.provider,
      "communication_channels.provider",
    ),
    adapter: asMember(
      channelAdapters,
      row.adapter,
      "communication_channels.adapter",
    ),
    externalAccountId: row.external_account_id,
    externalProfileId: row.external_profile_id,
    displayName: row.display_name,
    status: asMember(
      channelStatuses,
      row.status,
      "communication_channels.status",
    ),
    disconnectedAt: row.disconnected_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

export function toInboundWebhookEvent(
  row: InboundWebhookEventRow,
): InboundWebhookEvent {
  return {
    id: row.id,
    organizationId: row.organization_id,
    channelId: row.channel_id,
    adapter: asMember(
      channelAdapters,
      row.adapter,
      "inbound_webhook_events.adapter",
    ),
    externalEventId: row.external_event_id,
    eventType: asMember(
      inboundWebhookEventTypes,
      row.event_type,
      "inbound_webhook_events.event_type",
    ),
    status: asMember(
      inboundWebhookEventStatuses,
      row.status,
      "inbound_webhook_events.status",
    ),
    correlationId: row.correlation_id,
    receivedAt: row.received_at,
    enqueuedAt: row.enqueued_at,
    processedAt: row.processed_at,
    failureCode: row.failure_code,
  };
}
