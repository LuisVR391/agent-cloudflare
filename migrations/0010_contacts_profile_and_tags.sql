-- Migración 0010: ficha empresarial del contacto, etiquetas y permisos de CRM.
--
-- `contacts` solo conservaba un nombre siempre nulo, así que el inbox mostraba
-- el identificador externo del canal como si fuera una persona. La ficha añade
-- el teléfono que el canal ya reporta, un correo y una versión para editar sin
-- pisar otra edición, igual que hacen las conversaciones.
--
-- Las etiquetas pertenecen a la organización y se asignan por relación, no por
-- una columna de texto en el contacto: filtrar y renombrar exige una entidad.
--
-- El catálogo de permisos se siembra únicamente durante la instalación
-- (`AuthorizationRepository.seedOwner`), de modo que una organización ya
-- instalada no recibiría los permisos que introduce este corte. La segunda
-- sección los concede a los roles existentes y es idempotente.

ALTER TABLE contacts ADD COLUMN phone_number TEXT;
ALTER TABLE contacts ADD COLUMN email TEXT;
ALTER TABLE contacts ADD COLUMN version INTEGER NOT NULL DEFAULT 1;

-- El directorio ordena y busca por nombre dentro de la organización.
CREATE INDEX contacts_organization_display_name_idx
  ON contacts (organization_id, display_name);

CREATE TABLE contact_tags (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Nombre plegado a minúsculas y sin espacios en los extremos. Existe para
  -- que la unicidad no dependa de mayúsculas: `VIP` y `vip` son la misma
  -- etiqueta y SQLite no aplica `NOCASE` fuera de ASCII.
  normalized_name TEXT NOT NULL,
  color TEXT NOT NULL DEFAULT 'neutral'
    CHECK (color IN ('neutral', 'info', 'success', 'warning', 'danger')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX contact_tags_organization_name_unique
  ON contact_tags (organization_id, normalized_name);
CREATE UNIQUE INDEX contact_tags_organization_id_unique
  ON contact_tags (organization_id, id);

-- Las claves foráneas incluyen `organization_id` en ambos lados: dos claves
-- independientes serían válidas por separado mientras la combinación cruza el
-- límite de aislamiento (ADR-0006).
CREATE TABLE contact_tag_assignments (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  tag_id TEXT NOT NULL,
  assigned_by TEXT,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, contact_id, tag_id),
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, tag_id)
    REFERENCES contact_tags (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX contact_tag_assignments_organization_tag_idx
  ON contact_tag_assignments (organization_id, tag_id);

-- Catálogo de permisos del corte. `permissions` es global y su clave es única,
-- así que una instalación nueva que ya los sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'contacts.read', 'Consultar contactos',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'contacts.manage', 'Gestionar contactos',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles reciben ambos permisos: quien atiende la conversación es
-- quien descubre el nombre correcto del contacto mientras habla con él.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p ON p.permission_key IN ('contacts.read', 'contacts.manage')
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
