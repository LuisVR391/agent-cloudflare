import { requireOrganizationScope } from "../domain/errors";
import type {
  InvitationLookup,
  InvitationStatus,
  RoleKey,
  TeamInvitation,
  TeamMember,
} from "../domain/types";

type MemberRow = {
  membership_id: string;
  user_id: string;
  name: string;
  email: string;
  role_key: RoleKey;
  status: TeamMember["status"];
  joined_at: string;
};

type InvitationRow = {
  id: string;
  email: string;
  role_key: RoleKey;
  status: InvitationStatus;
  expires_at: string;
  invited_by: string;
  created_at: string;
};

type LookupRow = InvitationRow & {
  organization_id: string;
  organization_name: string;
};

/**
 * Lo que devuelve un intento de aceptación ganador. No incluye el nombre de la
 * organización porque nadie lo necesita en esa rama, y devolver un campo vacío
 * para cumplir un tipo sería mentir sobre el dato.
 */
export type ClaimedInvitation = {
  id: string;
  organizationId: string;
  email: string;
  role: RoleKey;
};

const memberSelect = `SELECT m.id AS membership_id, m.user_id, u.name, u.email,
  r.role_key, m.status, m.created_at AS joined_at
 FROM memberships m
 JOIN users u ON u.id = m.user_id
 JOIN membership_roles mr ON mr.organization_id = m.organization_id
  AND mr.membership_id = m.id
 JOIN roles r ON r.organization_id = m.organization_id AND r.id = mr.role_id`;

const invitationColumns = `id, email, role_key, status, expires_at, invited_by,
  created_at`;

function member(row: MemberRow): TeamMember {
  return {
    membershipId: row.membership_id,
    userId: row.user_id,
    name: row.name,
    email: row.email,
    role: row.role_key,
    status: row.status,
    joinedAt: row.joined_at,
  };
}

function invitation(row: InvitationRow): TeamInvitation {
  return {
    id: row.id,
    email: row.email,
    role: row.role_key,
    status: row.status,
    expiresAt: row.expires_at,
    invitedBy: row.invited_by,
    createdAt: row.created_at,
  };
}

/**
 * Equipo de una organización: quién la integra y qué invitaciones tiene
 * vigentes. Es el único dueño de `organization_invitations`.
 *
 * Casi todos sus métodos reciben `organizationId` y lo comprueban antes de
 * tocar D1. Las dos excepciones —`findByTokenHash` y `claimByTokenHash`— no
 * pueden hacerlo: la aceptación ocurre sin sesión y es el propio token el que
 * resuelve la organización. Por eso ambas devuelven la organización que
 * encontraron, para que quien las llama trabaje con ella y no con una recibida
 * del cliente.
 */
export class TeamRepository {
  constructor(private readonly db: D1Database) {}

  async listMembers(organizationId: string): Promise<TeamMember[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "TeamRepository.listMembers",
    );
    const { results } = await this.db
      .prepare(`${memberSelect}
        WHERE m.organization_id = ?
        ORDER BY u.name, u.email`)
      .bind(scope)
      .all<MemberRow>();
    return results.map(member);
  }

  async findActiveMembership(
    organizationId: string,
    membershipId: string,
  ): Promise<TeamMember | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "TeamRepository.findActiveMembership",
    );
    const row = await this.db
      .prepare(`${memberSelect}
        WHERE m.organization_id = ? AND m.id = ? AND m.status = 'active'`)
      .bind(scope, membershipId)
      .first<MemberRow>();
    return row ? member(row) : null;
  }

  async listInvitations(organizationId: string): Promise<TeamInvitation[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "TeamRepository.listInvitations",
    );
    const { results } = await this.db
      .prepare(`SELECT ${invitationColumns} FROM organization_invitations
        WHERE organization_id = ?
        ORDER BY created_at DESC`)
      .bind(scope)
      .all<InvitationRow>();
    return results.map(invitation);
  }

  /**
   * Crear una invitación revoca la que estuviera vigente para el mismo correo.
   * Reenviar genera un enlace nuevo, y el anterior deja de servir en la misma
   * operación: un enlace olvidado es una credencial olvidada.
   */
  async createInvitation(
    organizationId: string,
    input: {
      email: string;
      role: RoleKey;
      tokenHash: string;
      expiresAt: string;
      invitedBy: string;
      correlationId: string;
    },
  ): Promise<TeamInvitation> {
    const scope = requireOrganizationScope(
      organizationId,
      "TeamRepository.createInvitation",
    );
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const email = input.email.trim().toLowerCase();

    await this.db.batch([
      this.db
        .prepare(`UPDATE organization_invitations
          SET status = 'revoked', revoked_at = ?, updated_at = ?,
              claim_id = NULL, lease_expires_at = NULL
          WHERE organization_id = ? AND email = ?
            AND status IN ('pending', 'accepting')`)
        .bind(now, now, scope, email),
      this.db
        .prepare(`INSERT INTO organization_invitations
          (id, organization_id, email, role_key, token_hash, status, expires_at,
           invited_by, created_at, updated_at)
          VALUES (?, ?, ?, ?, ?, 'pending', ?, ?, ?, ?)`)
        .bind(
          id,
          scope,
          email,
          input.role,
          input.tokenHash,
          input.expiresAt,
          input.invitedBy,
          now,
          now,
        ),
      this.#auditStatement(scope, {
        action: "invitation.created",
        actorType: "staff",
        actorId: input.invitedBy,
        invitationId: id,
        result: "allowed",
        correlationId: input.correlationId,
      }),
    ]);

    return {
      id,
      email,
      role: input.role,
      status: "pending",
      expiresAt: input.expiresAt,
      invitedBy: input.invitedBy,
      createdAt: now,
    };
  }

  async revokeInvitation(
    organizationId: string,
    invitationId: string,
    actorId: string,
    correlationId: string,
  ): Promise<TeamInvitation | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "TeamRepository.revokeInvitation",
    );
    const now = new Date().toISOString();
    const row = await this.db
      .prepare(`UPDATE organization_invitations
        SET status = 'revoked', revoked_at = ?, updated_at = ?,
            claim_id = NULL, lease_expires_at = NULL
        WHERE organization_id = ? AND id = ?
          AND status IN ('pending', 'accepting')
        RETURNING ${invitationColumns}`)
      .bind(now, now, scope, invitationId)
      .first<InvitationRow>();
    if (!row) return null;

    await this.#auditStatement(scope, {
      action: "invitation.revoked",
      actorType: "staff",
      actorId,
      invitationId,
      result: "allowed",
      correlationId,
    }).run();
    return invitation(row);
  }

  /**
   * Sin organización: la aceptación todavía no tiene ninguna validada. El
   * resultado sirve para decidir el motivo del rechazo y para saber a qué
   * organización auditarlo; la autorización real la produce `claimByTokenHash`.
   */
  async findByTokenHash(tokenHash: string): Promise<InvitationLookup | null> {
    const row = await this.db
      .prepare(`SELECT i.id, i.email, i.role_key, i.status, i.expires_at,
        i.invited_by, i.created_at, i.organization_id,
        o.display_name AS organization_name
        FROM organization_invitations i
        JOIN organizations o ON o.id = i.organization_id AND o.status = 'active'
        WHERE i.token_hash = ?`)
      .bind(tokenHash)
      .first<LookupRow>();
    return row
      ? {
          id: row.id,
          organizationId: row.organization_id,
          organizationName: row.organization_name,
          email: row.email,
          role: row.role_key,
          status: row.status,
          expiresAt: row.expires_at,
        }
      : null;
  }

  /**
   * Reclama la invitación en una sola sentencia, como hace la instalación con
   * su lease. Dos aceptaciones simultáneas compiten aquí y solo una cambia una
   * fila, así que solo una llega a crear identidad y membresía. Un lease
   * vencido libera una invitación que quedó a medias por una caída.
   */
  async claimByTokenHash(
    tokenHash: string,
    claimId: string,
    leaseMinutes = 5,
  ): Promise<ClaimedInvitation | null> {
    const now = new Date();
    const nowIso = now.toISOString();
    const leaseExpiresAt = new Date(
      now.getTime() + leaseMinutes * 60_000,
    ).toISOString();
    const row = await this.db
      .prepare(`UPDATE organization_invitations
        SET status = 'accepting', claim_id = ?, lease_expires_at = ?,
            updated_at = ?
        WHERE token_hash = ? AND expires_at > ?
          AND (status = 'pending'
               OR (status = 'accepting' AND lease_expires_at < ?))
        RETURNING ${invitationColumns}, organization_id`)
      .bind(claimId, leaseExpiresAt, nowIso, tokenHash, nowIso, nowIso)
      .first<InvitationRow & { organization_id: string }>();
    if (!row) return null;

    return {
      id: row.id,
      organizationId: row.organization_id,
      email: row.email,
      role: row.role_key,
    };
  }

  async completeInvitation(
    invitationId: string,
    claimId: string,
    userId: string,
  ): Promise<void> {
    const now = new Date().toISOString();
    const result = await this.db
      .prepare(`UPDATE organization_invitations
        SET status = 'accepted', accepted_user_id = ?, accepted_at = ?,
            updated_at = ?, claim_id = NULL, lease_expires_at = NULL
        WHERE id = ? AND claim_id = ? AND status = 'accepting'`)
      .bind(userId, now, now, invitationId, claimId)
      .run();
    if (result.meta.changes !== 1) {
      throw new Error("INVITATION_CLAIM_LOST");
    }
  }

  /** Devuelve la invitación a `pending`: un fallo transitorio no quema el enlace. */
  async releaseInvitation(invitationId: string, claimId: string): Promise<void> {
    await this.db
      .prepare(`UPDATE organization_invitations
        SET status = 'pending', claim_id = NULL, lease_expires_at = NULL,
            updated_at = ?
        WHERE id = ? AND claim_id = ? AND status = 'accepting'`)
      .bind(new Date().toISOString(), invitationId, claimId)
      .run();
  }

  async markExpired(invitationId: string): Promise<void> {
    const now = new Date().toISOString();
    await this.db
      .prepare(`UPDATE organization_invitations
        SET status = 'expired', updated_at = ?, claim_id = NULL,
            lease_expires_at = NULL
        WHERE id = ? AND status IN ('pending', 'accepting')`)
      .bind(now, invitationId)
      .run();
  }

  /**
   * La auditoría conserva el identificador de la invitación, nunca su token ni
   * el correo: `audit_logs` no es un segundo lugar donde acaben datos
   * personales.
   */
  async recordAudit(
    organizationId: string,
    input: {
      action:
        | "invitation.created"
        | "invitation.accepted"
        | "invitation.expired"
        | "invitation.rejected"
        | "invitation.revoked";
      actorType: "staff" | "system";
      actorId: string | null;
      invitationId: string;
      result: "allowed" | "rejected" | "failed";
      correlationId: string;
    },
  ): Promise<void> {
    const scope = requireOrganizationScope(
      organizationId,
      "TeamRepository.recordAudit",
    );
    await this.#auditStatement(scope, input).run();
  }

  #auditStatement(
    organizationId: string,
    input: {
      action: string;
      actorType: "staff" | "system";
      actorId: string | null;
      invitationId: string;
      result: "allowed" | "rejected" | "failed";
      correlationId: string;
    },
  ): D1PreparedStatement {
    return this.db
      .prepare(`INSERT INTO audit_logs
        (id, organization_id, actor_type, actor_id, action, resource_type,
         resource_id, result, correlation_id, occurred_at)
        VALUES (?, ?, ?, ?, ?, 'invitation', ?, ?, ?, ?)`)
      .bind(
        crypto.randomUUID(),
        organizationId,
        input.actorType,
        input.actorId,
        input.action,
        input.invitationId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      );
  }
}
