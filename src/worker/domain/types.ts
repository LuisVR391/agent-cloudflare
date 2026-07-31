/**
 * Tipos del dominio en `camelCase`. La conversión desde las columnas
 * `snake_case` de D1 vive en la capa de repositorios (ADR-0006).
 */

export type OrganizationStatus = "active" | "suspended";

export type ContactStatus = "active" | "archived";

/** Proveedores de identidad soportados hoy. Crece con cada canal integrado. */
export type IdentityProvider = "whatsapp";

export type Organization = {
  id: string;
  slug: string;
  displayName: string;
  status: OrganizationStatus;
  createdAt: string;
  updatedAt: string;
};

export type Contact = {
  id: string;
  organizationId: string;
  displayName: string | null;
  status: ContactStatus;
  createdAt: string;
  updatedAt: string;
};

export type ContactIdentity = {
  id: string;
  organizationId: string;
  contactId: string;
  provider: IdentityProvider;
  externalId: string;
  createdAt: string;
  updatedAt: string;
};

export type CreateOrganizationInput = {
  slug: string;
  displayName: string;
  status?: OrganizationStatus;
};

export type CreateContactInput = {
  displayName?: string | null;
  status?: ContactStatus;
};

export type LinkContactIdentityInput = {
  contactId: string;
  provider: IdentityProvider;
  externalId: string;
};
