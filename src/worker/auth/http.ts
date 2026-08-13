import { z } from "zod";

import { OrganizationRepository } from "../repositories/organization-repository";
import { AuthorizationRepository } from "../repositories/auth/authorization-repository";
import { createRateLimitStorage } from "../repositories/auth/rate-limit-storage";
import { SetupRepository } from "../repositories/auth/setup-repository";
import { UserRepository } from "../repositories/auth/user-repository";
import { TeamRepository } from "../repositories/team-repository";
import {
  createActiveOrganizationCookie,
  readActiveOrganization,
} from "./active-organization";
import { createAuth, getConfiguredAuthOrigin } from "./auth";
import { hashInvitationToken } from "./invitation-token";
import type {
  AuthenticatedUser,
  AuthorizationResolution,
  WorkerEnv,
} from "./types";

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

const setupSchema = z.object({
  setupToken: z.string().min(1).max(512),
  organizationName: z.string().trim().min(2).max(100),
  organizationSlug: z
    .string()
    .trim()
    .min(2)
    .max(63)
    .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/),
  ownerName: z.string().trim().min(2).max(100),
  ownerEmail: z.email().max(254),
  ownerPassword: z.string().min(12).max(128),
});

const organizationSelectionSchema = z.object({
  organizationId: z.uuid(),
});

const invitationPreviewSchema = z.object({
  token: z.string().trim().min(16).max(512),
});

const invitationAcceptanceSchema = invitationPreviewSchema.extend({
  // El correo se pide aunque la invitación ya lo conozca: escribirlo demuestra
  // saber a quién se invitó. Si la previsualización lo devolviera, esta
  // comprobación sería decorativa.
  email: z.email().max(254),
  name: z.string().trim().min(2).max(100),
  password: z.string().min(12).max(128),
});

function json(body: unknown, status = 200, headers?: HeadersInit): Response {
  return new Response(JSON.stringify(body), {
    status,
    headers: { ...jsonHeaders, ...headers },
  });
}

export function error(
  status: number,
  code: string,
  message: string,
  correlationId: string,
): Response {
  return json({ error: { code, message, correlationId } }, status);
}

export function logSecurityRejection(
  action: string,
  reason: string,
  correlationId: string,
): void {
  console.warn(
    JSON.stringify({
      event: "security.authorization",
      action,
      result: "rejected",
      reason,
      correlationId,
    }),
  );
}

function hasSessionSecret(env: WorkerEnv): boolean {
  return (
    typeof env.BETTER_AUTH_SECRET === "string" &&
    env.BETTER_AUTH_SECRET.length >= 32
  );
}

function authConfigurationFailure(
  request: Request,
  env: WorkerEnv,
): Extract<AuthorizationResolution, { authorized: false }> | null {
  const authOrigin = getConfiguredAuthOrigin(env);
  if (!hasSessionSecret(env) || !authOrigin) {
    return {
      authorized: false,
      status: 503,
      code: "AUTH_NOT_CONFIGURED",
      message: "La autenticación no está configurada en este entorno.",
    };
  }
  if (new URL(request.url).origin !== authOrigin) {
    return {
      authorized: false,
      status: 403,
      code: "AUTH_ORIGIN_MISMATCH",
      message: "El origen de la solicitud no está autorizado.",
    };
  }
  return null;
}

async function readJson(request: Request): Promise<unknown> {
  const contentLength = Number(request.headers.get("content-length") ?? "0");
  if (contentLength > 16_384) {
    throw new Error("PAYLOAD_TOO_LARGE");
  }
  return request.json();
}

async function secretsMatch(left: string, right: string): Promise<boolean> {
  const encoder = new TextEncoder();
  const [leftDigest, rightDigest] = await Promise.all([
    crypto.subtle.digest("SHA-256", encoder.encode(left)),
    crypto.subtle.digest("SHA-256", encoder.encode(right)),
  ]);
  const leftBytes = new Uint8Array(leftDigest);
  const rightBytes = new Uint8Array(rightDigest);
  let difference = leftBytes.length ^ rightBytes.length;
  for (let index = 0; index < leftBytes.length; index += 1) {
    difference |= leftBytes[index] ^ rightBytes[index];
  }
  return difference === 0;
}

async function getAuthenticatedUser(
  request: Request,
  env: WorkerEnv,
): Promise<AuthenticatedUser | null> {
  const auth = createAuth(env);
  const session = await auth.api.getSession({ headers: request.headers });
  if (!session || session.user.status !== "active") return null;

  return {
    id: session.user.id,
    name: session.user.name,
    email: session.user.email,
  };
}

export async function resolveAuthorizationContext(
  request: Request,
  env: WorkerEnv,
): Promise<AuthorizationResolution> {
  const configurationFailure = authConfigurationFailure(request, env);
  if (configurationFailure) return configurationFailure;

  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return {
      authorized: false,
      status: 401,
      code: "UNAUTHENTICATED",
      message: "Inicia sesión para continuar.",
    };
  }

  const repository = new AuthorizationRepository(env.DB);
  const organizations = await repository.listAccessForUser(user.id);
  if (organizations.length === 0) {
    return {
      authorized: false,
      status: 403,
      code: "NO_ORGANIZATION_ACCESS",
      message: "Tu cuenta no tiene acceso a una organización activa.",
    };
  }

  const activeOrganization = await readActiveOrganization(
    request,
    env.BETTER_AUTH_SECRET,
    organizations,
  );
  if (!activeOrganization) {
    return {
      authorized: false,
      status: 409,
      code: "ORGANIZATION_SELECTION_REQUIRED",
      message: "Selecciona una organización válida para continuar.",
    };
  }

  return {
    authorized: true,
    context: { user, organizations, activeOrganization },
  };
}

async function handleSetupStatus(env: WorkerEnv): Promise<Response> {
  return json({ required: !(await new SetupRepository(env.DB).isCompleted()) });
}

async function handleSetup(
  request: Request,
  env: WorkerEnv,
  correlationId: string,
): Promise<Response> {
  const repository = new SetupRepository(env.DB);
  if (await repository.isCompleted()) {
    return error(
      409,
      "SETUP_ALREADY_COMPLETED",
      "La configuración inicial ya fue completada.",
      correlationId,
    );
  }

  let input: z.infer<typeof setupSchema>;
  try {
    input = setupSchema.parse(await readJson(request));
  } catch (caught) {
    const code =
      caught instanceof Error && caught.message === "PAYLOAD_TOO_LARGE"
        ? "PAYLOAD_TOO_LARGE"
        : "INVALID_SETUP_INPUT";
    return error(
      code === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      code,
      "Los datos de configuración inicial no son válidos.",
      correlationId,
    );
  }

  if (!(await secretsMatch(input.setupToken, env.AUTH_SETUP_TOKEN))) {
    logSecurityRejection(
      "installation.create",
      "invalid_setup_token",
      correlationId,
    );
    return error(
      403,
      "INVALID_SETUP_TOKEN",
      "No fue posible autorizar la configuración inicial.",
      correlationId,
    );
  }

  const attemptId = crypto.randomUUID();
  if (!(await repository.claim(attemptId))) {
    return error(
      409,
      "SETUP_UNAVAILABLE",
      "La configuración inicial ya fue completada o está en curso.",
      correlationId,
    );
  }

  let organizationId: string | null = null;
  let userId: string | null = null;
  try {
    const organizationRepository = new OrganizationRepository(env.DB);
    if (await organizationRepository.findBySlug(input.organizationSlug)) {
      throw new Error("ORGANIZATION_SLUG_CONFLICT");
    }

    const organization = await organizationRepository.create({
      slug: input.organizationSlug,
      displayName: input.organizationName,
    });
    organizationId = organization.id;

    const auth = createAuth(env, true);
    const registration = await auth.api.signUpEmail({
      body: {
        name: input.ownerName,
        email: input.ownerEmail.toLowerCase(),
        password: input.ownerPassword,
      },
    });
    userId = registration.user.id;

    await new AuthorizationRepository(env.DB).seedOwner(
      organization.id,
      userId,
      correlationId,
    );
    await repository.complete(attemptId);

    return json(
      {
        configured: true,
        organization: {
          id: organization.id,
          name: organization.displayName,
          slug: organization.slug,
        },
      },
      201,
    );
  } catch (caught) {
    if (organizationId) {
      await new OrganizationRepository(env.DB).deleteById(organizationId);
    }
    if (userId) {
      await new UserRepository(env.DB).deleteById(userId);
    }
    await repository.release(attemptId);

    const conflict =
      caught instanceof Error &&
      (caught.message === "ORGANIZATION_SLUG_CONFLICT" ||
        caught.message.toLowerCase().includes("unique"));
    return error(
      conflict ? 409 : 500,
      conflict ? "SETUP_CONFLICT" : "SETUP_FAILED",
      conflict
        ? "El correo o identificador de organización ya está en uso."
        : "No fue posible completar la configuración inicial.",
      correlationId,
    );
  }
}

async function handleContext(
  request: Request,
  env: WorkerEnv,
  correlationId: string,
): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return error(401, "UNAUTHENTICATED", "Inicia sesión para continuar.", correlationId);
  }

  const organizations =
    await new AuthorizationRepository(env.DB).listAccessForUser(user.id);
  if (organizations.length === 0) {
    return error(
      403,
      "NO_ORGANIZATION_ACCESS",
      "Tu cuenta no tiene acceso a una organización activa.",
      correlationId,
    );
  }

  const activeOrganization = await readActiveOrganization(
    request,
    env.BETTER_AUTH_SECRET,
    organizations,
  );
  const responseHeaders: Record<string, string> = {};
  const authOrigin = getConfiguredAuthOrigin(env);
  if (!authOrigin) {
    return error(
      503,
      "AUTH_NOT_CONFIGURED",
      "La autenticación no está configurada en este entorno.",
      correlationId,
    );
  }
  if (activeOrganization && organizations.length === 1) {
    responseHeaders["Set-Cookie"] = await createActiveOrganizationCookie(
      activeOrganization.organizationId,
      env.BETTER_AUTH_SECRET,
      authOrigin,
    );
  }

  return json(
    {
      user,
      organizations,
      activeOrganization,
      requiresOrganizationSelection: activeOrganization === null,
    },
    200,
    responseHeaders,
  );
}

async function handleOrganizationSelection(
  request: Request,
  env: WorkerEnv,
  correlationId: string,
): Promise<Response> {
  const user = await getAuthenticatedUser(request, env);
  if (!user) {
    return error(401, "UNAUTHENTICATED", "Inicia sesión para continuar.", correlationId);
  }

  let input: z.infer<typeof organizationSelectionSchema>;
  try {
    input = organizationSelectionSchema.parse(await readJson(request));
  } catch {
    logSecurityRejection(
      "organization.select",
      "invalid_organization_input",
      correlationId,
    );
    return error(
      400,
      "INVALID_ORGANIZATION",
      "La organización seleccionada no es válida.",
      correlationId,
    );
  }

  const repository = new AuthorizationRepository(env.DB);
  const organizations = await repository.listAccessForUser(user.id);
  const selected = organizations.find(
    (organization) => organization.organizationId === input.organizationId,
  );
  if (!selected) {
    logSecurityRejection(
      "organization.select",
      "organization_access_denied",
      correlationId,
    );
    return error(
      403,
      "ORGANIZATION_ACCESS_DENIED",
      "No tienes acceso a la organización seleccionada.",
      correlationId,
    );
  }

  await repository.writeOrganizationSelectionAudit(
    user,
    selected.organizationId,
    correlationId,
  );

  const authOrigin = getConfiguredAuthOrigin(env);
  if (!authOrigin) {
    return error(
      503,
      "AUTH_NOT_CONFIGURED",
      "La autenticación no está configurada en este entorno.",
      correlationId,
    );
  }

  return json(
    { activeOrganization: selected },
    200,
    {
      "Set-Cookie": await createActiveOrganizationCookie(
        selected.organizationId,
        env.BETTER_AUTH_SECRET,
        authOrigin,
      ),
    },
  );
}

/**
 * Toda invitación que no puede usarse responde lo mismo: inexistente,
 * vencida, revocada, ya consumida o dirigida a otro correo. Distinguirlas
 * convertiría la ruta en un oráculo que confirma qué tokens existen.
 */
function invitationUnavailable(correlationId: string): Response {
  return error(
    404,
    "INVITATION_NOT_AVAILABLE",
    "La invitación no está disponible.",
    correlationId,
  );
}

/**
 * Las rutas de invitación no pasan por el pipeline de Better Auth, así que
 * consumen el límite persistente por su cuenta. La clave se deriva de la IP y
 * se guarda hasheada, como el resto de `auth_rate_limits`.
 */
async function consumeInvitationAttempt(
  request: Request,
  env: WorkerEnv,
  scope: string,
  rule: { window: number; max: number },
): Promise<{ allowed: boolean; retryAfter: number | null }> {
  const address = request.headers.get("cf-connecting-ip") ?? "unknown";
  return createRateLimitStorage(env.DB, env.BETTER_AUTH_SECRET).consume(
    `${scope}:${address}`,
    rule,
  );
}

function tooManyAttempts(
  action: string,
  retryAfter: number | null,
  correlationId: string,
): Response {
  logSecurityRejection(action, "rate_limited", correlationId);
  return json(
    {
      error: {
        code: "TOO_MANY_REQUESTS",
        message: "Demasiados intentos. Espera antes de volver a intentarlo.",
        correlationId,
      },
    },
    429,
    retryAfter ? { "Retry-After": String(retryAfter) } : undefined,
  );
}

async function readInvitationInput<Schema extends z.ZodType>(
  request: Request,
  schema: Schema,
): Promise<z.infer<Schema> | { failure: "PAYLOAD_TOO_LARGE" | "INVALID" }> {
  try {
    return schema.parse(await readJson(request)) as z.infer<Schema>;
  } catch (caught) {
    return {
      failure:
        caught instanceof Error && caught.message === "PAYLOAD_TOO_LARGE"
          ? "PAYLOAD_TOO_LARGE"
          : "INVALID",
    };
  }
}

async function handleInvitationPreview(
  request: Request,
  env: WorkerEnv,
  correlationId: string,
): Promise<Response> {
  const limit = await consumeInvitationAttempt(
    request,
    env,
    "invitation-preview",
    { window: 60, max: 20 },
  );
  if (!limit.allowed) {
    return tooManyAttempts("invitation.preview", limit.retryAfter, correlationId);
  }

  const input = await readInvitationInput(request, invitationPreviewSchema);
  if ("failure" in input) {
    return error(
      input.failure === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      input.failure === "PAYLOAD_TOO_LARGE"
        ? "PAYLOAD_TOO_LARGE"
        : "INVALID_INVITATION_INPUT",
      "La invitación solicitada no es válida.",
      correlationId,
    );
  }

  const repository = new TeamRepository(env.DB);
  const invitation = await repository.findByTokenHash(
    await hashInvitationToken(env.BETTER_AUTH_SECRET, input.token),
  );
  if (
    !invitation ||
    invitation.status !== "pending" ||
    Date.parse(invitation.expiresAt) <= Date.now()
  ) {
    logSecurityRejection("invitation.preview", "not_available", correlationId);
    return invitationUnavailable(correlationId);
  }

  return json({
    invitation: {
      organizationName: invitation.organizationName,
      role: invitation.role,
      expiresAt: invitation.expiresAt,
    },
  });
}

async function handleInvitationAcceptance(
  request: Request,
  env: WorkerEnv,
  correlationId: string,
): Promise<Response> {
  const limit = await consumeInvitationAttempt(
    request,
    env,
    "invitation-accept",
    { window: 300, max: 5 },
  );
  if (!limit.allowed) {
    return tooManyAttempts("invitation.accept", limit.retryAfter, correlationId);
  }

  const input = await readInvitationInput(request, invitationAcceptanceSchema);
  if ("failure" in input) {
    return error(
      input.failure === "PAYLOAD_TOO_LARGE" ? 413 : 400,
      input.failure === "PAYLOAD_TOO_LARGE"
        ? "PAYLOAD_TOO_LARGE"
        : "INVALID_INVITATION_INPUT",
      "Los datos de la invitación no son válidos.",
      correlationId,
    );
  }

  const repository = new TeamRepository(env.DB);
  const tokenHash = await hashInvitationToken(
    env.BETTER_AUTH_SECRET,
    input.token,
  );
  const invitation = await repository.findByTokenHash(tokenHash);
  if (!invitation) {
    // Sin invitación no hay organización validada, así que este rechazo no
    // puede escribirse en `audit_logs`: se emite como evento operativo.
    logSecurityRejection("invitation.accept", "token_not_found", correlationId);
    return invitationUnavailable(correlationId);
  }

  const rejectAcceptance = async (
    reason: string,
    action: "invitation.expired" | "invitation.rejected",
  ) => {
    logSecurityRejection("invitation.accept", reason, correlationId);
    await repository.recordAudit(invitation.organizationId, {
      action,
      actorType: "system",
      actorId: null,
      invitationId: invitation.id,
      result: "rejected",
      correlationId,
    });
    return invitationUnavailable(correlationId);
  };

  if (Date.parse(invitation.expiresAt) <= Date.now()) {
    await repository.markExpired(invitation.id);
    return rejectAcceptance("expired", "invitation.expired");
  }
  if (invitation.status !== "pending" && invitation.status !== "accepting") {
    return rejectAcceptance("already_consumed", "invitation.rejected");
  }
  if (invitation.email !== input.email.trim().toLowerCase()) {
    return rejectAcceptance("email_mismatch", "invitation.rejected");
  }
  if (await new UserRepository(env.DB).existsByEmail(invitation.email)) {
    logSecurityRejection("invitation.accept", "email_in_use", correlationId);
    await repository.recordAudit(invitation.organizationId, {
      action: "invitation.rejected",
      actorType: "system",
      actorId: null,
      invitationId: invitation.id,
      result: "rejected",
      correlationId,
    });
    return error(
      409,
      "EMAIL_ALREADY_REGISTERED",
      "Ese correo ya tiene una cuenta en el producto.",
      correlationId,
    );
  }

  // Reclamar es lo que autoriza: dos aceptaciones simultáneas compiten aquí y
  // solo una cambia la fila, así que solo una crea identidad y membresía.
  const claimId = crypto.randomUUID();
  const claimed = await repository.claimByTokenHash(tokenHash, claimId);
  if (!claimed) {
    logSecurityRejection("invitation.accept", "claim_lost", correlationId);
    return invitationUnavailable(correlationId);
  }

  const authorization = new AuthorizationRepository(env.DB);
  let userId: string | null = null;
  let membershipId: string | null = null;
  try {
    const registration = await createAuth(env, true).api.signUpEmail({
      body: {
        name: input.name,
        // El correo lo dicta la invitación, no el cuerpo de la petición.
        email: claimed.email,
        password: input.password,
      },
    });
    userId = registration.user.id;
    membershipId = await authorization.addMember(
      claimed.organizationId,
      userId,
      claimed.role,
    );
    await repository.completeInvitation(claimed.id, claimId, userId);
    await repository.recordAudit(claimed.organizationId, {
      action: "invitation.accepted",
      actorType: "staff",
      actorId: userId,
      invitationId: claimed.id,
      result: "allowed",
      correlationId,
    });

    return json(
      { organization: { name: invitation.organizationName } },
      201,
    );
  } catch {
    // Compensa lo creado y devuelve la invitación a `pending`: un fallo
    // transitorio no debe quemar el enlace de quien todavía no entró.
    if (membershipId) {
      await authorization.deleteMembership(claimed.organizationId, membershipId);
    }
    if (userId) {
      await new UserRepository(env.DB).deleteById(userId);
    }
    await repository.releaseInvitation(claimed.id, claimId);
    await repository.recordAudit(claimed.organizationId, {
      action: "invitation.accepted",
      actorType: "system",
      actorId: null,
      invitationId: claimed.id,
      result: "failed",
      correlationId,
    });
    return error(
      500,
      "INVITATION_ACCEPTANCE_FAILED",
      "No fue posible completar el alta. Intenta nuevamente.",
      correlationId,
    );
  }
}

export async function routeAuthRequest(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();

  if (url.pathname === "/api/setup/status" && request.method === "GET") {
    return handleSetupStatus(env);
  }
  const isInvitationRoute =
    url.pathname === "/api/invitations/preview" ||
    url.pathname === "/api/invitations/accept";
  const configurationFailure = authConfigurationFailure(request, env);
  if (
    (url.pathname.startsWith("/api/auth/") ||
      (url.pathname === "/api/setup" && request.method === "POST") ||
      url.pathname === "/api/context" ||
      url.pathname === "/api/context/organization" ||
      isInvitationRoute) &&
    configurationFailure
  ) {
    logSecurityRejection(
      "authentication.configure",
      configurationFailure.code.toLowerCase(),
      correlationId,
    );
    return error(
      configurationFailure.status,
      configurationFailure.code,
      configurationFailure.message,
      correlationId,
    );
  }
  if (url.pathname === "/api/setup" && request.method === "POST") {
    if (
      !hasSessionSecret(env) ||
      typeof env.AUTH_SETUP_TOKEN !== "string" ||
      env.AUTH_SETUP_TOKEN.length < 12
    ) {
      return error(
        503,
        "SETUP_NOT_CONFIGURED",
        "La configuración inicial no está habilitada en este entorno.",
        correlationId,
      );
    }
    return handleSetup(request, env, correlationId);
  }
  // Aceptar una invitación es el único otro camino que habilita el alta de
  // credenciales, así que vive junto a la instalación: ambos son las dos
  // llamadas a `createAuth(env, true)` del repositorio y quedan auditables en
  // un solo archivo.
  if (isInvitationRoute && request.method === "POST") {
    return url.pathname === "/api/invitations/preview"
      ? handleInvitationPreview(request, env, correlationId)
      : handleInvitationAcceptance(request, env, correlationId);
  }
  if (isInvitationRoute) {
    return error(
      405,
      "METHOD_NOT_ALLOWED",
      "El método solicitado no está permitido.",
      correlationId,
    );
  }
  if (url.pathname.startsWith("/api/auth/")) {
    const response = await createAuth(env).handler(request);
    if (url.pathname === "/api/auth/sign-in/email" && response.status >= 400) {
      logSecurityRejection(
        "authentication.sign_in",
        "credentials_rejected",
        correlationId,
      );
    }
    return response;
  }
  if (url.pathname === "/api/context" && request.method === "GET") {
    return handleContext(request, env, correlationId);
  }
  if (
    url.pathname === "/api/context/organization" &&
    request.method === "POST"
  ) {
    return handleOrganizationSelection(request, env, correlationId);
  }

  return null;
}
