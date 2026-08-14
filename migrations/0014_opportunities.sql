-- Migración 0014: la oportunidad, que es lo que recorre el pipeline (ADR-0010).
--
-- Una conversación no cambia de etapa: puede producir una oportunidad, ninguna
-- o varias a lo largo del tiempo, y sigue siendo el hilo de atención. La
-- oportunidad pertenece a un contacto y referencia opcionalmente la
-- conversación que la originó.
--
-- Los tres estados del modelo de dominio permanecen separados: resolver una
-- conversación no cierra su oportunidad y confirmar una cita no mueve la etapa.
-- Ninguna transición arrastra a otra; las reglas que las relacionen son
-- automatizaciones explícitas de Fase 4.

-- `services` necesita este índice para poder ser referenciado por una clave
-- foránea compuesta. No se creó en `0012` porque entonces nada lo referenciaba,
-- y el esquema crece con la capacidad que lo necesita (ADR-0006).
CREATE UNIQUE INDEX services_organization_id_unique
  ON services (organization_id, id);

CREATE TABLE opportunities (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  -- La conversación que la originó, cuando existe. Una oportunidad creada desde
  -- el directorio de contactos no tiene ninguna.
  conversation_id TEXT,
  pipeline_id TEXT NOT NULL,
  stage_id TEXT NOT NULL,
  -- El servicio califica la oportunidad y es opcional hasta que se identifica.
  service_id TEXT,
  -- Concurrencia optimista: mover la misma oportunidad dos veces exige la
  -- versión vigente, igual que la actualización de conversación.
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Cada clave foránea incluye `organization_id` en ambos lados: dos claves
  -- independientes serían válidas por separado mientras la combinación cruza el
  -- límite de aislamiento (ADR-0006).
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, pipeline_id)
    REFERENCES pipelines (organization_id, id) ON DELETE RESTRICT,
  -- `RESTRICT` traslada al motor lo que la aplicación ya impide: una etapa con
  -- oportunidades no se borra. Sin él, borrarla las dejaría apuntando al vacío.
  FOREIGN KEY (organization_id, stage_id)
    REFERENCES pipeline_stages (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, service_id)
    REFERENCES services (organization_id, id) ON DELETE RESTRICT
);

-- El tablero lee por pipeline y etapa, y ordena por actividad reciente. El
-- identificador desempata para que la paginación por clave no deje filas
-- inalcanzables.
CREATE INDEX opportunities_organization_stage_activity_idx
  ON opportunities (organization_id, pipeline_id, stage_id, updated_at DESC, id DESC);

-- La ficha del contacto y el hilo de conversación resuelven sus oportunidades
-- por estas dos rutas.
CREATE INDEX opportunities_organization_contact_idx
  ON opportunities (organization_id, contact_id, updated_at DESC);
CREATE INDEX opportunities_organization_conversation_idx
  ON opportunities (organization_id, conversation_id, updated_at DESC);

-- Necesario para la clave foránea compuesta del historial.
CREATE UNIQUE INDEX opportunities_organization_id_unique
  ON opportunities (organization_id, id);

-- El historial conserva quién movió la oportunidad, entre qué etapas y con qué
-- correlación, igual que `conversation_assignments` para el responsable. La
-- creación registra su propia fila con `previous_stage_id` nulo: así el
-- historial explica también de dónde partió.
CREATE TABLE opportunity_stage_transitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  opportunity_id TEXT NOT NULL,
  previous_stage_id TEXT,
  next_stage_id TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'system')),
  -- Identificador del actor, sin clave foránea, como `audit_logs.actor_id`: el
  -- historial conserva quién movió la oportunidad aunque esa cuenta desaparezca.
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES opportunities (organization_id, id) ON DELETE CASCADE,
  -- Las etapas del historial no se borran mientras lo expliquen: reescribir el
  -- pasado para poder borrar una etapa sería perder la evidencia comercial.
  FOREIGN KEY (organization_id, previous_stage_id)
    REFERENCES pipeline_stages (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, next_stage_id)
    REFERENCES pipeline_stages (organization_id, id) ON DELETE RESTRICT
);

CREATE INDEX opportunity_transitions_organization_opportunity_idx
  ON opportunity_stage_transitions (organization_id, opportunity_id, occurred_at DESC);

-- ────────────────────── Catálogo de permisos ────────────────────────

-- `permissions` es global y su clave es única, así que una instalación nueva
-- que ya lo sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'opportunities.read', 'Consultar oportunidades',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'opportunities.manage', 'Crear y mover oportunidades',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles gestionan oportunidades: quien atiende la conversación es
-- quien descubre que hay una venta posible y quien la mueve. Configurar el
-- pipeline sigue siendo distinto y permanece en `owner` y `manager`.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p
    ON p.permission_key IN ('opportunities.read', 'opportunities.manage')
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
