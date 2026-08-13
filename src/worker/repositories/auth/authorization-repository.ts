import type {
  AuthenticatedUser,
  OrganizationAccess,
} from "../../auth/types";

type AccessRow = {
  organization_id: string;
  organization_name: string;
  organization_slug: string;
  membership_id: string;
  role_key: OrganizationAccess["role"];
  permission_key: string | null;
};

const roleNames = {
  owner: "Propietario",
  manager: "Gerente",
  operator: "Operador",
} as const;

/**
 * Catálogo canónico para una instalación nueva. Una organización ya instalada
 * no vuelve a pasar por aquí, así que cada corte que añade permisos los
 * concede además mediante una migración aditiva; `test/contacts.test.ts`
 * comprueba que ambos caminos producen el mismo catálogo.
 */
const permissionDefinitions = [
  ["panel.read", "Acceder al panel administrativo"],
  ["conversations.read", "Consultar conversaciones"],
  ["conversations.manage", "Gestionar conversaciones"],
  ["contacts.read", "Consultar contactos"],
  ["contacts.manage", "Gestionar contactos"],
  ["agents.read", "Consultar agentes"],
  ["agents.manage", "Gestionar agentes"],
  ["users.manage", "Gestionar usuarios y membresías"],
  ["organization.manage", "Gestionar la organización"],
] as const;

const permissionsByRole: Record<OrganizationAccess["role"], string[]> = {
  owner: permissionDefinitions.map(([key]) => key),
  manager: [
    "panel.read",
    "conversations.read",
    "conversations.manage",
    "contacts.read",
    "contacts.manage",
    "agents.read",
    "agents.manage",
  ],
  // Quien atiende la conversación es quien descubre el nombre correcto del
  // contacto mientras habla con él, así que también puede corregir la ficha.
  operator: [
    "panel.read",
    "conversations.read",
    "conversations.manage",
    "contacts.read",
    "contacts.manage",
  ],
};

export class AuthorizationRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async seedOwner(
    organizationId: string,
    userId: string,
    correlationId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const membershipId = crypto.randomUUID();
    const roleIds = {
      owner: crypto.randomUUID(),
      manager: crypto.randomUUID(),
      operator: crypto.randomUUID(),
    };
    const permissionIds = new Map(
      permissionDefinitions.map(([key]) => [key, crypto.randomUUID()]),
    );
    const statements: D1PreparedStatement[] = [
      this.#db
        .prepare(
          `INSERT INTO memberships
             (id, organization_id, user_id, status, created_at, updated_at)
           VALUES (?, ?, ?, 'active', ?, ?)`,
        )
        .bind(membershipId, organizationId, userId, now, now),
    ];

    for (const [roleKey, displayName] of Object.entries(roleNames)) {
      statements.push(
        this.#db
          .prepare(
            `INSERT INTO roles
               (id, organization_id, role_key, display_name, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?, ?)`,
          )
          .bind(
            roleIds[roleKey as keyof typeof roleIds],
            organizationId,
            roleKey,
            displayName,
            now,
            now,
          ),
      );
    }

    for (const [key, description] of permissionDefinitions) {
      statements.push(
        this.#db
          .prepare(
            `INSERT INTO permissions
               (id, permission_key, description, created_at, updated_at)
             VALUES (?, ?, ?, ?, ?)
             ON CONFLICT (permission_key) DO NOTHING`,
          )
          .bind(permissionIds.get(key), key, description, now, now),
      );
    }

    statements.push(
      this.#db
        .prepare(
          `INSERT INTO membership_roles
             (organization_id, membership_id, role_id, assigned_at)
           VALUES (?, ?, ?, ?)`,
        )
        .bind(organizationId, membershipId, roleIds.owner, now),
    );

    for (const [roleKey, permissionKeys] of Object.entries(permissionsByRole)) {
      for (const permissionKey of permissionKeys) {
        statements.push(
          this.#db
            .prepare(
              `INSERT INTO role_permissions
                 (organization_id, role_id, permission_id, granted_at)
               SELECT ?, ?, id, ?
               FROM permissions
               WHERE permission_key = ?`,
            )
            .bind(
              organizationId,
              roleIds[roleKey as OrganizationAccess["role"]],
              now,
              permissionKey,
            ),
        );
      }
    }

    statements.push(
      this.#db
        .prepare(
          `INSERT INTO audit_logs
             (id, organization_id, actor_type, actor_id, action, resource_type,
              resource_id, result, correlation_id, occurred_at)
           VALUES (?, ?, 'system', ?, 'installation.completed', 'organization',
             ?, 'allowed', ?, ?)`,
        )
        .bind(
          crypto.randomUUID(),
          organizationId,
          userId,
          organizationId,
          correlationId,
          now,
        ),
    );

    await this.#db.batch(statements);
  }

  async listAccessForUser(userId: string): Promise<OrganizationAccess[]> {
    const rows = await this.#db
      .prepare(
        `SELECT
           o.id AS organization_id,
           o.display_name AS organization_name,
           o.slug AS organization_slug,
           m.id AS membership_id,
           r.role_key,
           p.permission_key
         FROM memberships m
         INNER JOIN organizations o
           ON o.id = m.organization_id AND o.status = 'active'
         INNER JOIN membership_roles mr
           ON mr.organization_id = m.organization_id
          AND mr.membership_id = m.id
         INNER JOIN roles r
           ON r.organization_id = m.organization_id
          AND r.id = mr.role_id
         LEFT JOIN role_permissions rp
           ON rp.organization_id = r.organization_id
          AND rp.role_id = r.id
         LEFT JOIN permissions p ON p.id = rp.permission_id
         WHERE m.user_id = ? AND m.status = 'active'
         ORDER BY o.display_name, p.permission_key`,
      )
      .bind(userId)
      .all<AccessRow>();

    const accessByOrganization = new Map<string, OrganizationAccess>();
    for (const row of rows.results) {
      const access = accessByOrganization.get(row.organization_id) ?? {
        organizationId: row.organization_id,
        organizationName: row.organization_name,
        organizationSlug: row.organization_slug,
        membershipId: row.membership_id,
        role: row.role_key,
        permissions: [],
      };

      if (row.permission_key && !access.permissions.includes(row.permission_key)) {
        access.permissions.push(row.permission_key);
      }
      accessByOrganization.set(row.organization_id, access);
    }

    return [...accessByOrganization.values()];
  }

  async writeOrganizationSelectionAudit(
    user: AuthenticatedUser,
    organizationId: string,
    correlationId: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, 'organization.selected', 'organization',
           ?, 'allowed', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        organizationId,
        user.id,
        organizationId,
        correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  async writeAuthorizationRejectionAudit(
    user: AuthenticatedUser,
    organizationId: string,
    action: string,
    resourceType: string,
    correlationId: string,
  ): Promise<void> {
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, ?, NULL, 'rejected', ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        organizationId,
        user.id,
        action,
        resourceType,
        correlationId,
        new Date().toISOString(),
      )
      .run();
  }
}
