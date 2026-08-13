-- Migración 0012: catálogo de servicios de la organización (ADR-0010).
--
-- Un servicio se agenda, se cobra y se cuenta, así que es dato relacional con
-- dueño en D1 y no conocimiento recuperable: la calificación de una oportunidad
-- y la cita necesitan consultas exactas sobre él, no recuperación semántica.
--
-- El precio es opcional porque no todo servicio se publica con tarifa, pero un
-- importe sin moneda no significa nada. `organizations` todavía no declara
-- configuración regional —ADR-0010 solo compromete la zona horaria, que llega
-- con las citas—, de modo que la moneda se declara por servicio y el `CHECK`
-- impide que aparezca uno de los dos valores sin el otro.
--
-- El catálogo de permisos se siembra únicamente durante la instalación
-- (`AuthorizationRepository.seedOwner`), de modo que una organización ya
-- instalada no recibiría los permisos que introduce este corte. La última
-- sección los concede a los roles existentes y es idempotente.

CREATE TABLE services (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Nombre plegado a minúsculas y sin espacios en los extremos, como en
  -- `contact_tags`: la unicidad no debe depender de mayúsculas y SQLite no
  -- aplica `NOCASE` fuera de ASCII, así que se calcula en el repositorio.
  normalized_name TEXT NOT NULL,
  -- La duración es la unidad con la que la agenda reservará tiempo. El límite
  -- superior es un día: una cita más larga que eso describe otra cosa.
  duration_minutes INTEGER NOT NULL
    CHECK (duration_minutes > 0 AND duration_minutes <= 1440),
  -- Importe menor de la moneda —centavos— en entero. Un flotante acumularía
  -- error de representación sobre un dato que se cobra.
  price_amount_cents INTEGER
    CHECK (price_amount_cents IS NULL OR price_amount_cents >= 0),
  price_currency TEXT
    CHECK (price_currency IS NULL OR price_currency GLOB '[A-Z][A-Z][A-Z]'),
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  -- Concurrencia optimista, como en `contacts` y `conversations`: editar exige
  -- la versión vigente en vez de sobrescribir lo que otra persona acaba de
  -- escribir.
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Precio y moneda viajan juntos o no viajan.
  CHECK ((price_amount_cents IS NULL) = (price_currency IS NULL))
);

-- Un servicio no se borra: se archiva, porque las oportunidades y las citas que
-- lo referencien deben seguir explicando qué se vendió. El nombre sigue siendo
-- único dentro de la organización aunque el servicio esté archivado, de modo que
-- reactivarlo no compita con un duplicado creado mientras tanto.
CREATE UNIQUE INDEX services_organization_normalized_name_unique
  ON services (organization_id, normalized_name);

-- El catálogo se lista por estado y en orden alfabético dentro de la
-- organización, que es como lo consulta el panel y como lo recorrerá el
-- selector de servicio de la oportunidad.
CREATE INDEX services_organization_status_name_idx
  ON services (organization_id, status, normalized_name);

-- ────────────────────── Catálogo de permisos ────────────────────────

-- `permissions` es global y su clave es única, así que una instalación nueva
-- que ya lo sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'services.read', 'Consultar el catálogo de servicios',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'services.manage', 'Gestionar el catálogo de servicios',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles leen el catálogo porque quien atiende necesita saber qué
-- ofrece la empresa mientras conversa. Editarlo es decisión de negocio, así que
-- `services.manage` queda en `owner` y `manager`.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p ON p.permission_key = 'services.read'
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p ON p.permission_key = 'services.manage'
 WHERE r.role_key IN ('owner', 'manager')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
