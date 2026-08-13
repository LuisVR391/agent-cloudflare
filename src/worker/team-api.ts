import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import { getConfiguredAuthOrigin } from "./auth/auth";
import {
  buildInvitationLink,
  createInvitationToken,
  hashInvitationToken,
} from "./auth/invitation-token";
import type { WorkerEnv } from "./auth/types";
import { json } from "./http/api-helpers";
import { AuthorizationRepository } from "./repositories/auth/authorization-repository";
import { TeamRepository } from "./repositories/team-repository";

const DEFAULT_EXPIRATION_HOURS = 72;

const invitationSchema = z.object({
  email: z.email().max(254),
  role: z.enum(["owner", "manager", "operator"]),
  // Una invitación sin vencimiento es una credencial permanente (ADR-0011).
  // El máximo son dos semanas: más allá, reenviar cuesta menos que sostener un
  // enlace vivo.
  expiresInHours: z.number().int().min(1).max(336).optional(),
});

/**
 * Superficie del equipo. Leerlo exige `users.read` y lo tienen los tres roles,
 * porque asignar una conversación obliga a ver a quién; invitar y revocar
 * exigen `users.manage`, que solo tiene `owner`.
 *
 * El token de una invitación aparece una única vez, en la respuesta que la
 * crea. Ninguna lectura posterior puede devolverlo: D1 solo conserva su hash.
 */
export async function routeTeamApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/team")) return null;

  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await resolveAuthorizationContext(request, env);
  if (!authorization.authorized) {
    return error(
      authorization.status,
      authorization.code,
      authorization.message,
      correlationId,
    );
  }

  const { context } = authorization;
  const organizationId = context.activeOrganization.organizationId;
  const permissions = context.activeOrganization.permissions;
  const repository = new TeamRepository(env.DB);
  const suffix = url.pathname.slice("/api/team".length);

  const denyWithoutManagement = async (action: string) => {
    await new AuthorizationRepository(env.DB).writeAuthorizationRejectionAudit(
      context.user,
      organizationId,
      action,
      "invitation",
      correlationId,
    );
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para administrar el equipo.",
      correlationId,
    );
  };

  if (suffix === "/members" && request.method === "GET") {
    if (!permissions.includes("users.read")) {
      return error(
        403,
        "FORBIDDEN",
        "No tienes permiso para consultar el equipo.",
        correlationId,
      );
    }
    return json({ members: await repository.listMembers(organizationId) });
  }

  if (suffix === "/invitations" && request.method === "GET") {
    if (!permissions.includes("users.manage")) {
      return await denyWithoutManagement("invitation.list");
    }
    return json({
      invitations: await repository.listInvitations(organizationId),
    });
  }

  if (suffix === "/invitations" && request.method === "POST") {
    if (!permissions.includes("users.manage")) {
      return await denyWithoutManagement("invitation.create");
    }
    const parsed = invitationSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return error(
        400,
        "INVALID_INVITATION",
        "Los datos de la invitación no son válidos.",
        correlationId,
      );
    }

    // El enlace se construye con el origen configurado del entorno, nunca con
    // el `Host` de la petición, que lo fija quien llama.
    const authOrigin = getConfiguredAuthOrigin(env);
    if (!authOrigin) {
      return error(
        503,
        "AUTH_NOT_CONFIGURED",
        "La autenticación no está configurada en este entorno.",
        correlationId,
      );
    }

    const token = createInvitationToken();
    const expiresAt = new Date(
      Date.now() +
        (parsed.data.expiresInHours ?? DEFAULT_EXPIRATION_HOURS) * 3_600_000,
    ).toISOString();
    const invitation = await repository.createInvitation(organizationId, {
      email: parsed.data.email,
      role: parsed.data.role,
      tokenHash: await hashInvitationToken(env.BETTER_AUTH_SECRET, token),
      expiresAt,
      invitedBy: context.user.id,
      correlationId,
    });

    return json(
      {
        invitation,
        acceptUrl: buildInvitationLink(authOrigin, token),
      },
      201,
    );
  }

  const revokeMatch = suffix.match(/^\/invitations\/([^/]+)\/revoke$/);
  if (revokeMatch && request.method === "POST") {
    if (!permissions.includes("users.manage")) {
      return await denyWithoutManagement("invitation.revoke");
    }
    const invitation = await repository.revokeInvitation(
      organizationId,
      decodeURIComponent(revokeMatch[1]),
      context.user.id,
      correlationId,
    );
    // Una invitación de otra organización responde `404`, nunca `403`: la
    // respuesta no revela que existe.
    if (!invitation) {
      return error(
        404,
        "NOT_FOUND",
        "La invitación solicitada no está vigente.",
        correlationId,
      );
    }
    return json({ invitation });
  }

  if (
    suffix === "/members" ||
    suffix === "/invitations" ||
    revokeMatch !== null
  ) {
    return error(
      405,
      "METHOD_NOT_ALLOWED",
      "El método solicitado no está permitido.",
      correlationId,
    );
  }

  return error(
    404,
    "NOT_FOUND",
    "La ruta solicitada no existe.",
    correlationId,
  );
}
