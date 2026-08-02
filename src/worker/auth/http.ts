import { z } from "zod";

import { OrganizationRepository } from "../repositories/organization-repository";
import { AuthorizationRepository } from "../repositories/auth/authorization-repository";
import { SetupRepository } from "../repositories/auth/setup-repository";
import { UserRepository } from "../repositories/auth/user-repository";
import {
  createActiveOrganizationCookie,
  readActiveOrganization,
} from "./active-organization";
import { createAuth, getConfiguredAuthOrigin } from "./auth";
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
  const configurationFailure = authConfigurationFailure(request, env);
  if (
    (url.pathname.startsWith("/api/auth/") ||
      (url.pathname === "/api/setup" && request.method === "POST") ||
      url.pathname === "/api/context" ||
      url.pathname === "/api/context/organization") &&
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
