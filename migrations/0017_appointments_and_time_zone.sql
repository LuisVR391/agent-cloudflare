-- Migración 0017: la cita, que es el compromiso al que llega una conversación,
-- y la zona horaria que decide cuándo ocurre (ADR-0010).
--
-- Toda marca de tiempo sigue siendo ISO 8601 UTC, sin excepción. La zona
-- horaria no cambia cómo se guarda un instante: decide dónde empieza y termina
-- el día que alguien mira. Sin ella, la agenda de un salón en
-- `America/Mexico_City` cortaría a las 18:00 locales, que es cuando cambia el
-- día en UTC.
--
-- Los tres estados del modelo de dominio permanecen separados: confirmar una
-- cita no mueve la etapa comercial ni resuelve la conversación. Las reglas que
-- los relacionen son automatizaciones explícitas de Fase 4.

-- Valor por defecto explícito para las organizaciones ya instaladas, como exige
-- ADR-0010. El identificador IANA es entrada no confiable y se valida en el
-- Worker contra `Intl`: SQLite no conoce el catálogo de zonas y un `CHECK` aquí
-- solo podría comprobar la forma, no que la zona exista.
ALTER TABLE organizations
  ADD COLUMN time_zone TEXT NOT NULL DEFAULT 'America/Mexico_City';

CREATE TABLE appointments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- La cita es de alguien y es de algo: sin contacto no hay a quién atender, y
  -- sin servicio no se sabe cuánto dura ni qué se reservó.
  contact_id TEXT NOT NULL,
  service_id TEXT NOT NULL,
  -- El responsable es opcional: una cita puede agendarse antes de decidir quién
  -- la atiende, y forzar un nombre falso sería peor que dejarlo pendiente.
  assignee_membership_id TEXT,
  -- Origen. A diferencia del sujeto de una tarea, no son excluyentes: la misma
  -- cita puede nacer en una conversación y pertenecer a la oportunidad que esa
  -- conversación abrió.
  conversation_id TEXT,
  opportunity_id TEXT,
  -- Instantes ISO 8601 UTC. El fin se deriva de la duración del servicio cuando
  -- no se envía, pero se persiste: cambiar el catálogo después no debe mover
  -- una cita ya acordada.
  starts_at TEXT NOT NULL,
  ends_at TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('requested', 'pending', 'confirmed', 'rescheduled',
                      'cancelled', 'completed', 'no_show')),
  created_by_membership_id TEXT NOT NULL,
  -- Concurrencia optimista: reprogramar exige la versión vigente, igual que
  -- mover una oportunidad o cerrar una tarea.
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Una cita que termina antes de empezar no describe nada reservable. El
  -- formato ISO es uniforme en todo el esquema, así que comparar el texto
  -- ordena igual que comparar los instantes.
  CHECK (ends_at > starts_at),
  -- Cada clave foránea incluye `organization_id` en ambos lados: dos claves
  -- independientes serían válidas por separado mientras la combinación cruza el
  -- límite de aislamiento (ADR-0006).
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
  -- `RESTRICT` en lo que explica la cita: qué se reservó, quién iba a atenderla
  -- y de dónde salió. Un servicio se archiva y una membresía se desactiva; ni
  -- uno ni otra se borran mientras una cita los conserve.
  FOREIGN KEY (organization_id, service_id)
    REFERENCES services (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, assignee_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE RESTRICT,
  FOREIGN KEY (organization_id, opportunity_id)
    REFERENCES opportunities (organization_id, id) ON DELETE RESTRICT
);

-- La agenda se lee por rango de tiempo dentro de la organización. El
-- identificador desempata para que dos citas a la misma hora tengan un orden
-- estable.
CREATE INDEX appointments_organization_starts_idx
  ON appointments (organization_id, starts_at, id);

-- «Qué me toca hoy» y «qué falta por confirmar» son las otras dos preguntas que
-- la agenda responde.
CREATE INDEX appointments_organization_assignee_starts_idx
  ON appointments (organization_id, assignee_membership_id, starts_at, id);
CREATE INDEX appointments_organization_status_starts_idx
  ON appointments (organization_id, status, starts_at, id);

-- La ficha del contacto, el hilo y la oportunidad resuelven sus citas por estas
-- tres rutas, de la más reciente a la más antigua.
CREATE INDEX appointments_organization_contact_idx
  ON appointments (organization_id, contact_id, starts_at DESC, id DESC);
CREATE INDEX appointments_organization_conversation_idx
  ON appointments (organization_id, conversation_id, starts_at DESC, id DESC);
CREATE INDEX appointments_organization_opportunity_idx
  ON appointments (organization_id, opportunity_id, starts_at DESC, id DESC);

-- Necesario para la clave foránea compuesta del historial.
CREATE UNIQUE INDEX appointments_organization_id_unique
  ON appointments (organization_id, id);

-- El historial conserva quién cambió la cita y qué cambió, igual que
-- `opportunity_stage_transitions` para la etapa comercial. La creación registra
-- su propia fila con `previous_status` nulo, así el historial explica también de
-- dónde partió.
--
-- Guarda los horarios además del estado porque una reprogramación es
-- precisamente un cambio de horario: sin ellos, dos filas `rescheduled`
-- seguidas no dirían nada de lo que se movió.
CREATE TABLE appointment_transitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  appointment_id TEXT NOT NULL,
  previous_status TEXT
    CHECK (previous_status IS NULL OR previous_status IN
           ('requested', 'pending', 'confirmed', 'rescheduled',
            'cancelled', 'completed', 'no_show')),
  next_status TEXT NOT NULL
    CHECK (next_status IN ('requested', 'pending', 'confirmed', 'rescheduled',
                           'cancelled', 'completed', 'no_show')),
  previous_starts_at TEXT,
  previous_ends_at TEXT,
  next_starts_at TEXT NOT NULL,
  next_ends_at TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'system')),
  -- Identificador del actor, sin clave foránea, como `audit_logs.actor_id`: el
  -- historial conserva quién cambió la cita aunque esa cuenta desaparezca.
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, appointment_id)
    REFERENCES appointments (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX appointment_transitions_organization_appointment_idx
  ON appointment_transitions (organization_id, appointment_id, occurred_at DESC);

-- ────────────────────── Catálogo de permisos ────────────────────────

-- `permissions` es global y su clave es única, así que una instalación nueva
-- que ya lo sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'appointments.read', 'Consultar la agenda de citas',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
  (lower(hex(randomblob(16))), 'appointments.manage', 'Agendar, reprogramar y cerrar citas',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles gestionan citas: quien atiende la conversación es quien acuerda
-- el horario, y una cita que solo puede agendar su jefe se pierde mientras tanto.
-- Ambos permisos van al mismo conjunto de roles, así que basta una sentencia.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p
    ON p.permission_key IN ('appointments.read', 'appointments.manage')
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
