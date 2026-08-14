import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import { LastPipelineStageError, StageOrderMismatchError } from "./domain/errors";
import { json } from "./http/api-helpers";
import { PipelineRepository } from "./repositories/pipeline-repository";

const colorSchema = z.enum(["neutral", "info", "success", "warning", "danger"]);
const nameSchema = z.string().trim().min(1).max(80);
const versionSchema = z.number().int().positive();

const renameSchema = z.object({
  expectedVersion: versionSchema,
  name: nameSchema,
});

const createStageSchema = z.object({
  expectedVersion: versionSchema,
  name: nameSchema,
  color: colorSchema.optional(),
});

const updateStageSchema = z
  .object({
    expectedVersion: versionSchema,
    name: nameSchema.optional(),
    color: colorSchema.optional(),
  })
  .refine((value) => value.name !== undefined || value.color !== undefined);

const deleteStageSchema = z.object({ expectedVersion: versionSchema });

// El reorden enumera todas las etapas del pipeline: el límite superior es
// generoso, pero acotado, porque la lista llega de fuera.
const reorderSchema = z.object({
  expectedVersion: versionSchema,
  stageIds: z.array(z.string().min(1).max(64)).min(1).max(100),
});

/**
 * Configuración del pipeline comercial. Leerlo exige `pipelines.read`, que
 * tienen los tres roles porque quien atiende necesita saber en qué etapa está
 * lo que gestiona; reconfigurarlo exige `pipelines.manage`.
 *
 * Toda mutación viaja con `expectedVersion` del pipeline: la configuración se
 * versiona entera, de modo que dos reordenamientos simultáneos no se pisen.
 */
export async function routePipelineApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/pipelines")) return null;

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
  const repository = new PipelineRepository(env.DB);
  const suffix = url.pathname.slice("/api/pipelines".length);

  if (!permissions.includes("pipelines.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar el pipeline.",
      correlationId,
    );
  }
  const canManage = permissions.includes("pipelines.manage");

  const denyManagement = async (
    action:
      | "pipeline.update"
      | "pipeline.stage.create"
      | "pipeline.stage.update"
      | "pipeline.stage.delete"
      | "pipeline.stages.reorder",
    pipelineId: string,
  ) => {
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      pipelineId,
      action,
      result: "rejected",
      correlationId,
    });
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para configurar el pipeline.",
      correlationId,
    );
  };

  const conflict = () =>
    error(
      409,
      "PIPELINE_VERSION_CONFLICT",
      "El pipeline cambió; vuelve a cargarlo.",
      correlationId,
    );

  const notFound = () =>
    error(404, "NOT_FOUND", "El pipeline solicitado no existe.", correlationId);

  const body = async () => request.json().catch(() => null);

  if (suffix === "" || suffix === "/") {
    if (request.method !== "GET") {
      return error(
        405,
        "METHOD_NOT_ALLOWED",
        "El método solicitado no está permitido.",
        correlationId,
      );
    }
    return json({ pipelines: await repository.list(organizationId) });
  }

  const pipelineMatch = suffix.match(/^\/([^/]+)$/);
  const stagesMatch = suffix.match(/^\/([^/]+)\/stages$/);
  const stageMatch = suffix.match(/^\/([^/]+)\/stages\/([^/]+)$/);
  const orderMatch = suffix.match(/^\/([^/]+)\/stages\/order$/);
  if (!pipelineMatch && !stagesMatch && !stageMatch && !orderMatch) {
    return notFound();
  }

  const pipelineId = decodeURIComponent(
    (orderMatch ?? stageMatch ?? stagesMatch ?? pipelineMatch)![1],
  );

  // Se resuelve antes de decidir el método para que un pipeline de otra
  // organización responda `404` en todas las ramas y la respuesta no revele que
  // existe.
  const pipeline = await repository.find(organizationId, pipelineId);
  if (pipeline === null) return notFound();

  if (pipelineMatch && request.method === "GET") {
    return json({ pipeline });
  }

  if (pipelineMatch && request.method === "PATCH") {
    if (!canManage) return denyManagement("pipeline.update", pipelineId);
    const parsed = renameSchema.safeParse(await body());
    if (!parsed.success) {
      return error(
        400,
        "INVALID_PIPELINE_UPDATE",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    const updated = await repository.rename(organizationId, pipelineId, parsed.data);
    if (updated === null) return conflict();
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      pipelineId,
      action: "pipeline.update",
      result: "allowed",
      correlationId,
    });
    return json({ pipeline: updated });
  }

  // `/stages/order` se comprueba antes que `/stages/:id`, porque `order` sería
  // un identificador válido para esa ruta.
  if (orderMatch && request.method === "PATCH") {
    if (!canManage) return denyManagement("pipeline.stages.reorder", pipelineId);
    const parsed = reorderSchema.safeParse(await body());
    if (!parsed.success) {
      return error(
        400,
        "INVALID_STAGE_ORDER",
        "El orden solicitado no es válido.",
        correlationId,
      );
    }
    try {
      const updated = await repository.reorderStages(
        organizationId,
        pipelineId,
        parsed.data,
      );
      if (updated === null) return conflict();
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        pipelineId,
        action: "pipeline.stages.reorder",
        result: "allowed",
        correlationId,
      });
      return json({ pipeline: updated });
    } catch (caught) {
      if (caught instanceof StageOrderMismatchError) {
        return error(
          400,
          "INVALID_STAGE_ORDER",
          "El orden debe enumerar exactamente las etapas del pipeline.",
          correlationId,
        );
      }
      throw caught;
    }
  }

  if (stagesMatch && request.method === "POST") {
    if (!canManage) return denyManagement("pipeline.stage.create", pipelineId);
    const parsed = createStageSchema.safeParse(await body());
    if (!parsed.success) {
      return error(
        400,
        "INVALID_PIPELINE_STAGE",
        "La etapa solicitada no es válida.",
        correlationId,
      );
    }
    const updated = await repository.addStage(
      organizationId,
      pipelineId,
      parsed.data,
    );
    if (updated === null) return conflict();
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      pipelineId,
      action: "pipeline.stage.create",
      result: "allowed",
      correlationId,
    });
    return json({ pipeline: updated }, 201);
  }

  if (stageMatch && request.method === "PATCH") {
    if (!canManage) return denyManagement("pipeline.stage.update", pipelineId);
    const parsed = updateStageSchema.safeParse(await body());
    if (!parsed.success) {
      return error(
        400,
        "INVALID_PIPELINE_STAGE",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    const stageId = decodeURIComponent(stageMatch[2]);
    if (!pipeline.stages.some((stage) => stage.id === stageId)) {
      return error(
        404,
        "NOT_FOUND",
        "La etapa solicitada no existe.",
        correlationId,
      );
    }
    const updated = await repository.updateStage(
      organizationId,
      pipelineId,
      stageId,
      parsed.data,
    );
    if (updated === null) return conflict();
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      pipelineId,
      action: "pipeline.stage.update",
      result: "allowed",
      correlationId,
    });
    return json({ pipeline: updated });
  }

  if (stageMatch && request.method === "DELETE") {
    if (!canManage) return denyManagement("pipeline.stage.delete", pipelineId);
    const parsed = deleteStageSchema.safeParse(await body());
    if (!parsed.success) {
      return error(
        400,
        "INVALID_PIPELINE_STAGE",
        "El borrado solicitado no es válido.",
        correlationId,
      );
    }
    const stageId = decodeURIComponent(stageMatch[2]);
    if (!pipeline.stages.some((stage) => stage.id === stageId)) {
      return error(
        404,
        "NOT_FOUND",
        "La etapa solicitada no existe.",
        correlationId,
      );
    }
    try {
      const updated = await repository.removeStage(
        organizationId,
        pipelineId,
        stageId,
        parsed.data.expectedVersion,
      );
      if (updated === null) return conflict();
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        pipelineId,
        action: "pipeline.stage.delete",
        result: "allowed",
        correlationId,
      });
      return json({ pipeline: updated });
    } catch (caught) {
      if (caught instanceof LastPipelineStageError) {
        return error(
          409,
          "LAST_PIPELINE_STAGE",
          "El pipeline no puede quedarse sin etapas.",
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
