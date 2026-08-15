-- Migración 0016: la tarea, que es lo que alguien tiene que hacer y cuándo.
--
-- Una nota conserva lo que se entendió; una tarea conserva lo que quedó
-- pendiente. Por eso la tarea sí tiene responsable y vencimiento: sin alguien a
-- quien corresponda, un pendiente no se opera, solo se acumula.
--
-- El sujeto es opcional y a lo sumo uno. Una tarea puede nacer suelta —«llamar
-- al proveedor»—, colgar de un contacto, de la conversación que la originó o de
-- la oportunidad que hay que empujar. Dos sujetos a la vez la harían ambigua:
-- no se sabría en qué ficha aparece ni qué la explica.
--
-- Recordatorios, vencimientos automáticos y notificaciones son de Fase 4. Aquí
-- `due_at` es un dato que la lista ordena y muestra, no un disparador.

CREATE TABLE tasks (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  details TEXT,
  assignee_membership_id TEXT NOT NULL,
  created_by_membership_id TEXT NOT NULL,
  -- Timestamp ISO 8601 en UTC, como el resto del esquema (ADR-0006). Es
  -- opcional: un pendiente sin fecha sigue siendo un pendiente.
  due_at TEXT,
  status TEXT NOT NULL DEFAULT 'open'
    CHECK (status IN ('open', 'done', 'cancelled')),
  -- El sujeto de la tarea. A lo sumo uno de los tres.
  contact_id TEXT,
  conversation_id TEXT,
  opportunity_id TEXT,
  -- Concurrencia optimista: cerrar la misma tarea dos veces exige la versión
  -- vigente, igual que mover una oportunidad.
  version INTEGER NOT NULL DEFAULT 1,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- `IS NOT NULL` vale 0 o 1, así que la suma cuenta cuántos sujetos hay. Cero
  -- es válido: la tarea suelta existe.
  CHECK ((contact_id IS NOT NULL) + (conversation_id IS NOT NULL)
         + (opportunity_id IS NOT NULL) <= 1),
  -- Cada clave foránea incluye `organization_id` en ambos lados: dos claves
  -- independientes serían válidas por separado mientras la combinación cruza el
  -- límite de aislamiento (ADR-0006).
  --
  -- `RESTRICT` sobre las membresías: una tarea conserva a quién le tocaba y
  -- quién la creó. Retirar a alguien del equipo se hace cambiando el estado de
  -- su membresía, no borrando su rastro.
  FOREIGN KEY (organization_id, assignee_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE RESTRICT,
  -- El sujeto sí cae con lo que la explica: sin el contacto, la conversación o
  -- la oportunidad, la tarea perdió su razón de ser.
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES opportunities (organization_id, id) ON DELETE CASCADE
);

-- La lista de tareas se lee por responsable y ordena por vencimiento, con las
-- pendientes primero. El identificador desempata para que la paginación por
-- clave no deje filas inalcanzables.
CREATE INDEX tasks_organization_assignee_due_idx
  ON tasks (organization_id, assignee_membership_id, status, due_at, id);

-- La organización entera se consulta por vencimiento cuando se filtra por
-- «todos», sin pasar por el responsable.
CREATE INDEX tasks_organization_status_due_idx
  ON tasks (organization_id, status, due_at, id);

-- La ficha del contacto, el hilo y la oportunidad resuelven sus tareas por
-- estas tres rutas.
CREATE INDEX tasks_organization_contact_idx
  ON tasks (organization_id, contact_id, due_at, id);
CREATE INDEX tasks_organization_conversation_idx
  ON tasks (organization_id, conversation_id, due_at, id);
CREATE INDEX tasks_organization_opportunity_idx
  ON tasks (organization_id, opportunity_id, due_at, id);

-- ────────────────────── Catálogo de permisos ────────────────────────

-- `permissions` es global y su clave es única, así que una instalación nueva
-- que ya lo sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'tasks.read', 'Consultar tareas',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'tasks.manage', 'Crear, asignar y cerrar tareas',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles gestionan tareas: quien atiende la conversación es quien
-- descubre el pendiente, y una tarea que solo puede crear su jefe llega tarde.
-- Ambos permisos van al mismo conjunto de roles, así que basta una sentencia.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p
    ON p.permission_key IN ('tasks.read', 'tasks.manage')
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
