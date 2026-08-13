-- Migración 0011: incorporación de colaboradores por invitación (ADR-0011) y
-- responsable de conversación con historial.
--
-- El registro público sigue cerrado: aceptar una invitación es el único camino
-- que habilita el alta de credenciales. El token que la autoriza es opaco, de
-- un solo uso y nunca se guarda en claro; D1 solo conserva su HMAC, del mismo
-- modo que `auth_rate_limits` guarda la clave hasheada y `AUTH_SETUP_TOKEN` se
-- compara sin almacenarse.
--
-- El responsable de una conversación es una membresía, no un usuario suelto:
-- `memberships` es la entidad que ya pertenece a una organización, así que
-- apuntar a ella deja el aislamiento en manos del motor en vez de la
-- aplicación.
--
-- El catálogo de permisos se siembra únicamente durante la instalación
-- (`AuthorizationRepository.seedOwner`), de modo que una organización ya
-- instalada no recibiría el permiso que introduce este corte. La última
-- sección lo concede a los roles existentes y es idempotente.

-- SQLite exige un índice único sobre las columnas padre para admitir una clave
-- foránea compuesta. Sin él, `conversation_assignments` no podría declarar que
-- la membresía y la conversación pertenecen a la misma organización, que es
-- justo la combinación que ADR-0006 obliga a comprobar.
CREATE UNIQUE INDEX memberships_organization_id_unique
  ON memberships (organization_id, id);

-- ─────────────────────────── Invitaciones ───────────────────────────

CREATE TABLE organization_invitations (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  -- `NOCASE` como en `users.email`: dos correos que solo difieren en
  -- mayúsculas son la misma persona.
  email TEXT NOT NULL COLLATE NOCASE,
  role_key TEXT NOT NULL CHECK (role_key IN ('owner', 'manager', 'operator')),
  -- HMAC-SHA256 del token con el secreto de sesión. Un volcado de D1 no basta
  -- para verificar candidatos: hace falta además el secreto, que vive en
  -- Cloudflare Secrets.
  token_hash TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending'
    CHECK (status IN ('pending', 'accepting', 'accepted', 'revoked', 'expired')),
  expires_at TEXT NOT NULL,
  -- Identificador del actor, sin clave foránea, como `audit_logs.actor_id`:
  -- la invitación conserva quién la creó aunque esa cuenta desaparezca.
  invited_by TEXT NOT NULL,
  accepted_user_id TEXT,
  accepted_at TEXT,
  revoked_at TEXT,
  -- Lease del intento de aceptación. Ambas columnas son NULL fuera de un
  -- intento en curso; su vencimiento libera una invitación que quedó a medias.
  claim_id TEXT,
  lease_expires_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

-- Excepción deliberada a «todo índice de una tabla empresarial empieza por
-- `organization_id`» (ADR-0006). La aceptación ocurre sin sesión y sin
-- organización activa: es el propio token el que la resuelve, así que la
-- búsqueda por hash debe ser global y devolver exactamente una fila. El valor
-- indexado son 256 bits de entropía, no un identificador enumerable, y ninguna
-- otra consulta usa este índice.
CREATE UNIQUE INDEX organization_invitations_token_unique
  ON organization_invitations (token_hash);

-- A lo sumo una invitación vigente por correo dentro de la organización.
-- Reenviar revoca la anterior en la misma operación: un enlace olvidado no
-- debe seguir siendo una credencial válida.
CREATE UNIQUE INDEX organization_invitations_pending_unique
  ON organization_invitations (organization_id, email)
  WHERE status IN ('pending', 'accepting');

CREATE INDEX organization_invitations_organization_status_idx
  ON organization_invitations (organization_id, status, created_at DESC);

-- ─────────────────── Responsable de conversación ────────────────────

-- SQLite no admite declarar una clave foránea compuesta en `ALTER TABLE ADD
-- COLUMN`, y recrear `conversations` arrastraría `messages`,
-- `conversation_status_history` y `outbound_message_deliveries`. La
-- pertenencia se garantiza en la misma sentencia que escribe —que exige
-- membresía activa de la organización— y, de forma transitiva, por las claves
-- foráneas de `conversation_assignments`: la fila de historial viaja en el
-- mismo lote que la actualización, así que una membresía ajena revierte ambas.
ALTER TABLE conversations ADD COLUMN assigned_membership_id TEXT;

CREATE INDEX conversations_organization_assignee_activity_idx
  ON conversations (organization_id, assigned_membership_id, status,
                    last_message_at DESC, id DESC);

CREATE TABLE conversation_assignments (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  previous_membership_id TEXT,
  next_membership_id TEXT,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'system')),
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, previous_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, next_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX conversation_assignments_organization_conversation_idx
  ON conversation_assignments (organization_id, conversation_id, occurred_at DESC);

-- ────────────────────── Catálogo de permisos ────────────────────────

-- `permissions` es global y su clave es única, así que una instalación nueva
-- que ya lo sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'users.read', 'Consultar el equipo y sus roles',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles reciben la lectura del equipo porque los tres gestionan
-- conversaciones, y no se puede asignar una conversación sin ver a quién.
-- `users.manage` —invitar y revocar— sigue siendo exclusivo de `owner`.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p ON p.permission_key IN ('users.read')
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
