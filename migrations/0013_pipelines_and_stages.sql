-- Migración 0013: pipeline comercial configurable por organización (ADR-0010).
--
-- Las etapas viven en datos propios de cada organización, con orden explícito,
-- no en un enumerado del código ni en una columna de la conversación. El
-- pipeline inicial de salón de belleza descrito en la guía §16.3 se siembra de
-- forma idempotente y desde ahí es editable: cambiar de giro no bifurca el
-- producto.
--
-- La siembra tiene dos caminos que deben producir el mismo resultado. Una
-- organización nueva la recibe durante la instalación, desde la plantilla
-- canónica de `PipelineRepository`; una ya instalada la recibe aquí. Ambos se
-- comparan en `test/pipelines.test.ts`, porque una divergencia entre ellos
-- dejaría organizaciones con pipelines distintos según cuándo se crearon.

CREATE TABLE pipelines (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Identifica la plantilla que originó el pipeline y hace idempotente su
  -- siembra. Es `NULL` en un pipeline creado a mano, que no vuelve a sembrarse.
  template_key TEXT,
  -- Concurrencia optimista de la configuración completa: crear, renombrar,
  -- recolorear, reordenar o borrar una etapa exige la versión vigente del
  -- pipeline y la incrementa. Un solo punto de versión evita que dos
  -- reordenamientos simultáneos se pisen dejando posiciones incoherentes.
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Necesario para las claves foráneas compuestas de `pipeline_stages`: SQLite
-- exige un índice único sobre las columnas padre.
CREATE UNIQUE INDEX pipelines_organization_id_unique
  ON pipelines (organization_id, id);

-- A lo sumo un pipeline por plantilla dentro de la organización. Es lo que
-- permite reaplicar la siembra sin duplicarla.
CREATE UNIQUE INDEX pipelines_organization_template_unique
  ON pipelines (organization_id, template_key)
  WHERE template_key IS NOT NULL;

CREATE INDEX pipelines_organization_name_idx
  ON pipelines (organization_id, name);

CREATE TABLE pipeline_stages (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  pipeline_id TEXT NOT NULL,
  name TEXT NOT NULL,
  -- Orden explícito dentro del pipeline. No es único a propósito: reordenar por
  -- lote reasigna todas las posiciones en la misma transacción, y SQLite valida
  -- la unicidad sentencia a sentencia, así que un índice único haría fallar el
  -- intercambio de dos etapas contiguas.
  position INTEGER NOT NULL CHECK (position > 0),
  -- Token semántico, igual que en `contact_tags`: la interfaz lo traduce a una
  -- variante de componente en vez de guardar un color literal.
  color TEXT NOT NULL DEFAULT 'neutral'
    CHECK (color IN ('neutral', 'info', 'success', 'warning', 'danger')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- La clave foránea incluye `organization_id` en ambos lados: dos claves
  -- independientes serían válidas por separado mientras la combinación cruza el
  -- límite de aislamiento (ADR-0006).
  FOREIGN KEY (organization_id, pipeline_id)
    REFERENCES pipelines (organization_id, id) ON DELETE CASCADE
);

-- Las oportunidades del corte siguiente referenciarán la etapa dentro de su
-- organización, y esa clave foránea compuesta necesita este índice.
CREATE UNIQUE INDEX pipeline_stages_organization_id_unique
  ON pipeline_stages (organization_id, id);

CREATE INDEX pipeline_stages_organization_pipeline_position_idx
  ON pipeline_stages (organization_id, pipeline_id, position);

-- ─────────────── Siembra del pipeline inicial de salón ───────────────

-- Una organización que ya lo tenga no recibe otro: el `NOT EXISTS` la excluye,
-- y el índice único de plantilla lo garantiza aunque esta migración se
-- reaplicara.
INSERT INTO pipelines (id, organization_id, name, template_key, created_at, updated_at)
SELECT lower(hex(randomblob(16))), o.id, 'Pipeline de salón', 'beauty-salon-initial',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM organizations o
 WHERE NOT EXISTS (
   SELECT 1 FROM pipelines p
    WHERE p.organization_id = o.id AND p.template_key = 'beauty-salon-initial'
 );

-- Las doce etapas de la guía §16.3, en su orden. Van en sentencias separadas
-- porque SQLite limita los términos de un `UNION ALL` y doce ya lo exceden en
-- el runtime de Workers. Cada una comprueba su propio nombre, de modo que
-- reaplicar la siembra no duplica etapas y una etapa borrada a propósito no
-- reaparece por el nombre de otra.

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Nuevo contacto', 1, 'neutral',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Nuevo contacto'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Servicio identificado', 2, 'info',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Servicio identificado'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Prospecto calificado', 3, 'info',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Prospecto calificado'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Información enviada', 4, 'info',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Información enviada'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Cita propuesta', 5, 'warning',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Cita propuesta'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Cita agendada', 6, 'warning',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Cita agendada'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Cita confirmada', 7, 'success',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Cita confirmada'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Servicio realizado', 8, 'success',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Servicio realizado'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Seguimiento posterior', 9, 'info',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Seguimiento posterior'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Próximo retoque', 10, 'info',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Próximo retoque'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Cliente recurrente', 11, 'success',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Cliente recurrente'
   );

INSERT INTO pipeline_stages
  (id, organization_id, pipeline_id, name, position, color, created_at, updated_at)
SELECT lower(hex(randomblob(16))), p.organization_id, p.id, 'Oportunidad perdida', 12, 'danger',
       strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM pipelines p
 WHERE p.template_key = 'beauty-salon-initial'
   AND NOT EXISTS (
     SELECT 1 FROM pipeline_stages ps
      WHERE ps.organization_id = p.organization_id AND ps.pipeline_id = p.id
        AND ps.name = 'Oportunidad perdida'
   );

-- ────────────────────── Catálogo de permisos ────────────────────────

-- `permissions` es global y su clave es única, así que una instalación nueva
-- que ya lo sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'pipelines.read', 'Consultar pipelines y sus etapas',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'pipelines.manage', 'Configurar pipelines y sus etapas',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles leen el pipeline porque quien atiende necesita saber en qué
-- etapa está lo que gestiona. Reconfigurarlo es decisión de negocio, así que
-- `pipelines.manage` queda en `owner` y `manager`, como el catálogo de
-- servicios.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p ON p.permission_key = 'pipelines.read'
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;

INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p ON p.permission_key = 'pipelines.manage'
 WHERE r.role_key IN ('owner', 'manager')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
