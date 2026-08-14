import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import {
  ContactNotInOrganizationError,
  ServiceNotInOrganizationError,
  StageNotInPipelineError,
} from "./domain/errors";
import { json, parseLimit } from "./http/api-helpers";
import { OpportunityRepository } from "./repositories/opportunity-repository";

const idSchema = z.string().min(1).max(64);

const createSchema = z.object({
  contactId: idSchema,
  conversationId: idSchema.nullable().optional(),
  pipelineId: idSchema.optional(),
  stageId: idSchema.optional(),
  serviceId: idSchema.nullable().optional(),
});

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    stageId: idSchema.optional(),
    // `null` desvincula el servicio; omitirlo lo conserva.
    serviceId: idSchema.nullable().optional(),
  })
  .refine((value) => value.stageId !== undefined || value.serviceId !== undefined);

/**
 * Oportunidades del pipeline. Los tres roles pueden crearlas y moverlas, porque
 * quien atiende la conversación es quien descubre que hay una venta posible;
 * configurar el pipeline sigue exigiendo `pipelines.manage`.
 *
 * Mover usa concurrencia optimista y la etapa destino se valida contra el
 * pipeline de la propia oportunidad, no solo contra la organización.
 */
export async function routeOpportunityApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/opportunities")) return null;

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
  const repository = new OpportunityRepository(env.DB);
  const suffix = url.pathname.slice("/api/opportunities".length);

  if (!permissions.includes("opportunities.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar oportunidades.",
      correlationId,
    );
  }
  const canManage = permissions.includes("opportunities.manage");

  const denyManagement = async (
    action: "opportunity.create" | "opportunity.update",
    opportunityId: string | null,
  ) => {
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      opportunityId,
      action,
      result: "rejected",
      correlationId,
    });
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para gestionar oportunidades.",
      correlationId,
    );
  };

  const referenceError = (caught: unknown): Response | null => {
    if (
      caught instanceof ContactNotInOrganizationError ||
      caught instanceof ServiceNotInOrganizationError ||
      caught instanceof StageNotInPipelineError
    ) {
      // Las tres responden igual: distinguirlas revelaría qué identificador
      // ajeno existe.
      return error(
        404,
        "NOT_FOUND",
        "Alguna de las referencias no existe en tu organización.",
        correlationId,
      );
    }
    return null;
  };

  if (suffix === "" || suffix === "/") {
    if (request.method === "GET") {
      const pipelineId = url.searchParams.get("pipelineId");
      const contactId = url.searchParams.get("contactId");
      if (contactId) {
        return json({
          opportunities: await repository.listByContact(organizationId, contactId),
        });
      }
      if (!pipelineId) {
        return error(
          400,
          "INVALID_QUERY",
          "Indica el pipeline o el contacto que quieres consultar.",
          correlationId,
        );
      }
      const limit = parseLimit(url.searchParams.get("limit"), 100);
      if (!limit) {
        return error(
          400,
          "INVALID_LIMIT",
          "El límite solicitado no es válido.",
          correlationId,
        );
      }
      const opportunities = await repository.listByPipeline(
        organizationId,
        pipelineId,
        { limit },
      );
      // El tablero anuncia el recorte en vez de fingir que muestra todo.
      return json({ opportunities, limit, truncated: opportunities.length === limit });
    }

    if (request.method === "POST") {
      if (!canManage) return denyManagement("opportunity.create", null);
      const parsed = createSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return error(
          400,
          "INVALID_OPPORTUNITY",
          "La oportunidad solicitada no es válida.",
          correlationId,
        );
      }
      try {
        const opportunity = await repository.create(organizationId, {
          ...parsed.data,
          actorId: context.user.id,
          correlationId,
        });
        await repository.recordAudit({
          organizationId,
          actorId: context.user.id,
          opportunityId: opportunity.id,
          action: "opportunity.create",
          result: "allowed",
          correlationId,
        });
        return json({ opportunity }, 201);
      } catch (caught) {
        const response = referenceError(caught);
        if (response) return response;
        if (
          caught instanceof Error &&
          caught.message === "PIPELINE_NOT_CONFIGURED"
        ) {
          return error(
            409,
            "PIPELINE_NOT_CONFIGURED",
            "La organización todavía no tiene un pipeline configurado.",
            correlationId,
          );
        }
        throw caught;
      }
    }

    return error(
      405,
      "METHOD_NOT_ALLOWED",
      "El método solicitado no está permitido.",
      correlationId,
    );
  }

  const opportunityMatch = suffix.match(/^\/([^/]+)$/);
  if (!opportunityMatch) {
    return error(
      404,
      "NOT_FOUND",
      "La oportunidad solicitada no existe.",
      correlationId,
    );
  }
  const opportunityId = decodeURIComponent(opportunityMatch[1]);

  // Se resuelve antes de decidir el método para que una oportunidad de otra
  // organización responda `404` en todas las ramas.
  const current = await repository.find(organizationId, opportunityId);
  if (current === null) {
    return error(
      404,
      "NOT_FOUND",
      "La oportunidad solicitada no existe.",
      correlationId,
    );
  }

  if (request.method === "GET") {
    return json({ opportunity: current });
  }

  if (request.method === "PATCH") {
    if (!canManage) return denyManagement("opportunity.update", opportunityId);
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return error(
        400,
        "INVALID_OPPORTUNITY_UPDATE",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    try {
      const opportunity = await repository.update(organizationId, opportunityId, {
        ...parsed.data,
        actorId: context.user.id,
        correlationId,
      });
      if (opportunity === null) {
        return error(
          409,
          "OPPORTUNITY_VERSION_CONFLICT",
          "La oportunidad cambió; vuelve a cargarla.",
          correlationId,
        );
      }
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        opportunityId,
        action: "opportunity.update",
        result: "allowed",
        correlationId,
      });
      return json({ opportunity });
    } catch (caught) {
      const response = referenceError(caught);
      if (response) return response;
      throw caught;
    }
  }

  return error(
    405,
    "METHOD_NOT_ALLOWED",
    "El método solicitado no está permitido.",
    correlationId,
  );
}
