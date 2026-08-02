-- Migración 0002: autenticación del personal, autorización multiempresa,
-- instalación inicial y auditoría.
--
-- Better Auth posee únicamente sus tablas técnicas de identidad y sesión.
-- D1 conserva las organizaciones, membresías, roles y permisos canónicos.

CREATE TABLE users (
  id TEXT PRIMARY KEY,
  name TEXT NOT NULL,
  email TEXT NOT NULL COLLATE NOCASE,
  email_verified INTEGER NOT NULL DEFAULT 0 CHECK (email_verified IN (0, 1)),
  image TEXT,
  status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'suspended')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX users_email_unique ON users (email);

CREATE TABLE user_sessions (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  token TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  ip_address TEXT,
  user_agent TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX user_sessions_token_unique ON user_sessions (token);
CREATE INDEX user_sessions_user_idx ON user_sessions (user_id);

CREATE TABLE user_accounts (
  id TEXT PRIMARY KEY,
  account_id TEXT NOT NULL,
  provider_id TEXT NOT NULL,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  access_token TEXT,
  refresh_token TEXT,
  id_token TEXT,
  access_token_expires_at TEXT,
  refresh_token_expires_at TEXT,
  scope TEXT,
  password TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX user_accounts_user_idx ON user_accounts (user_id);
CREATE UNIQUE INDEX user_accounts_provider_unique
  ON user_accounts (provider_id, account_id);

CREATE TABLE auth_verifications (
  id TEXT PRIMARY KEY,
  identifier TEXT NOT NULL,
  value TEXT NOT NULL,
  expires_at TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX auth_verifications_identifier_idx
  ON auth_verifications (identifier);

CREATE TABLE memberships (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  user_id TEXT NOT NULL REFERENCES users (id) ON DELETE CASCADE,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'suspended', 'revoked')),
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX memberships_organization_user_unique
  ON memberships (organization_id, user_id);
CREATE INDEX memberships_organization_status_idx
  ON memberships (organization_id, status);
CREATE INDEX memberships_user_status_idx
  ON memberships (user_id, status);

CREATE TABLE roles (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role_key TEXT NOT NULL CHECK (role_key IN ('owner', 'manager', 'operator')),
  display_name TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX roles_organization_key_unique
  ON roles (organization_id, role_key);

CREATE TABLE permissions (
  id TEXT PRIMARY KEY,
  permission_key TEXT NOT NULL,
  description TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE UNIQUE INDEX permissions_key_unique ON permissions (permission_key);

CREATE TABLE membership_roles (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  membership_id TEXT NOT NULL REFERENCES memberships (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  assigned_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, membership_id, role_id)
);

CREATE INDEX membership_roles_organization_membership_idx
  ON membership_roles (organization_id, membership_id);

CREATE TABLE role_permissions (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  role_id TEXT NOT NULL REFERENCES roles (id) ON DELETE CASCADE,
  permission_id TEXT NOT NULL REFERENCES permissions (id) ON DELETE CASCADE,
  granted_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, role_id, permission_id)
);

CREATE INDEX role_permissions_organization_role_idx
  ON role_permissions (organization_id, role_id);

CREATE TABLE installation_state (
  installation_key TEXT PRIMARY KEY,
  status TEXT NOT NULL CHECK (status IN ('in_progress', 'completed')),
  attempt_id TEXT NOT NULL,
  lease_expires_at TEXT NOT NULL,
  completed_at TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE TABLE auth_rate_limits (
  key_hash TEXT PRIMARY KEY,
  request_count INTEGER NOT NULL,
  last_request INTEGER NOT NULL
);

CREATE TABLE audit_logs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'system')),
  actor_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  result TEXT NOT NULL CHECK (result IN ('allowed', 'rejected', 'failed')),
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL
);

CREATE INDEX audit_logs_organization_occurred_idx
  ON audit_logs (organization_id, occurred_at);
