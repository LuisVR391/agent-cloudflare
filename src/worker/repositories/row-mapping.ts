import { InvalidPersistedValueError } from "../domain/errors";
import type {
  Contact,
  ContactIdentity,
  ContactStatus,
  IdentityProvider,
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
  status: string;
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

const organizationStatuses: readonly OrganizationStatus[] = [
  "active",
  "suspended",
];

const contactStatuses: readonly ContactStatus[] = ["active", "archived"];

const identityProviders: readonly IdentityProvider[] = ["whatsapp"];

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
    status: asMember(contactStatuses, row.status, "contacts.status"),
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
