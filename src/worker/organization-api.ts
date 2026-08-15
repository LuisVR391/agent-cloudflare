import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import { isSupportedTimeZone } from "./domain/time-zone";
import { json } from "./http/api-helpers";
import { OrganizationRepository } from "./repositories/organization-repository";

const updateSchema = z.object({
  timeZone: z.string().trim().min(1).max(64),
});

/**
 * Configuración de la organización activa. Hoy expone una sola cosa —la zona
 * horaria con la que se interpreta la agenda (ADR-0010)— porque es lo que el
 * corte de citas necesita: una empresa fuera de la zona por defecto tiene que
 * poder corregirla o su agenda muestra el día equivocado.
 *
 * La organización no viaja en el cuerpo: es la activa de la sesión. Un
 * identificador enviado por el frontend no demostraría a cuál pertenece quien
 * pide el cambio.
 */
export async function routeOrganizationApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/organization") return null;

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
  const repository = new OrganizationRepository(env.DB);

  if (request.method === "GET") {
    const organization = await repository.findById(organizationId);
    if (organization === null) {
      return error(
        404,
        "NOT_FOUND",
        "La organización solicitada no existe.",
        correlationId,
      );
    }
    return json({ organization });
  }

  if (request.method === "PATCH") {
    if (!context.activeOrganization.permissions.includes("organization.manage")) {
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        action: "organization.update",
        result: "rejected",
        correlationId,
      });
      return error(
        403,
        "FORBIDDEN",
        "No tienes permiso para configurar la organización.",
        correlationId,
      );
    }

    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success || !isSupportedTimeZone(parsed.data.timeZone)) {
      return error(
        400,
        "INVALID_TIME_ZONE",
        "La zona horaria solicitada no es válida.",
        correlationId,
      );
    }

    const organization = await repository.updateTimeZone(
      organizationId,
      parsed.data.timeZone,
    );
    if (organization === null) {
      return error(
        404,
        "NOT_FOUND",
        "La organización solicitada no existe.",
        correlationId,
      );
    }

    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      action: "organization.update",
      result: "allowed",
      correlationId,
    });
    return json({ organization });
  }

  return error(
    405,
    "METHOD_NOT_ALLOWED",
    "El método solicitado no está permitido.",
    correlationId,
  );
}
