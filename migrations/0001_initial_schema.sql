-- Migración 0001: esquema inicial de aislamiento multiempresa.
--
-- Convenciones fijadas en ADR-0006: identificadores TEXT opacos, timestamps
-- TEXT en ISO 8601 UTC, `organization_id` obligatorio en toda tabla
-- empresarial e índices encabezados por esa columna.
--
-- Ninguna columna almacena secretos. Las credenciales de proveedores viven en
-- Cloudflare Secrets (ADR-0002).

CREATE TABLE organizations (
  id TEXT PRIMARY KEY,
  slug TEXT NOT NULL,
  display_name TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX organizations_slug_unique ON organizations (slug);

CREATE TABLE contacts (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  display_name TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'archived')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX contacts_organization_created_idx
  ON contacts (organization_id, created_at);

-- Una identidad externa pertenece a una organización. Dos organizaciones
-- pueden observar el mismo `external_id` del mismo proveedor sin colisionar;
-- repetirlo dentro de una organización sí es un conflicto.
CREATE TABLE contact_identities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL REFERENCES contacts (id) ON DELETE CASCADE,
  provider TEXT NOT NULL,
  external_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX contact_identities_scope_unique
  ON contact_identities (organization_id, provider, external_id);

CREATE INDEX contact_identities_contact_idx
  ON contact_identities (organization_id, contact_id);
