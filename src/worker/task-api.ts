import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import {
  MembershipNotActiveInOrganizationError,
  TaskSubjectNotInOrganizationError,
} from "./domain/errors";
import type { TaskStatus } from "./domain/types";
import { json, parseLimit } from "./http/api-helpers";
import { TaskRepository } from "./repositories/task-repository";

const idSchema = z.string().min(1).max(64);
const statusSchema = z.enum(["open", "done", "cancelled"]);

/**
 * El sujeto viaja como una sola forma con su tipo, en vez de tres campos
 * opcionales: así el `CHECK` de la tabla no puede violarse desde el contrato.
 */
const subjectSchema = z.object({
  type: z.enum(["contact", "conversation", "opportunity"]),
  id: idSchema,
});

// Vencimiento en ISO 8601 UTC, como el resto del esquema. La zona horaria de la
// organización llega con las citas (#38); hasta entonces el cliente envía el
// instante ya resuelto.
const dueAtSchema = z.iso.datetime();

const createSchema = z.object({
  title: z.string().trim().min(1).max(200),
  details: z.string().trim().max(2000).nullable().optional(),
  // Ausente deja la tarea a nombre de quien la crea.
  assigneeMembershipId: idSchema.optional(),
  dueAt: dueAtSchema.nullable().optional(),
  subject: subjectSchema.nullable().optional(),
});

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    title: z.string().trim().min(1).max(200).optional(),
    details: z.string().trim().max(2000).nullable().optional(),
    assigneeMembershipId: idSchema.optional(),
    // `null` retira el vencimiento; omitirlo lo conserva.
    dueAt: dueAtSchema.nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine((value) =>
    [
      value.title,
      value.details,
      value.assigneeMembershipId,
      value.dueAt,
      value.status,
    ].some((field) => field !== undefined),
  );

/**
 * Tareas con responsable y vencimiento. Los tres roles las gestionan, porque
 * quien atiende la conversación es quien descubre el pendiente.
 *
 * El filtro `assignee=me` lo resuelve el backend con la membresía de la sesión:
 * el cliente no necesita conocer su identificador ni podría demostrarlo.
 */
export async function routeTaskApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/tasks")) return null;

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
  const membershipId = context.activeOrganization.membershipId;
  const permissions = context.activeOrganization.permissions;
  const repository = new TaskRepository(env.DB);
  const suffix = url.pathname.slice("/api/tasks".length);

  if (!permissions.includes("tasks.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar tareas.",
      correlationId,
    );
  }
  const canManage = permissions.includes("tasks.manage");

  const denyManagement = async (
    action: "task.create" | "task.update",
    taskId: string | null,
  ) => {
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      taskId,
      action,
      result: "rejected",
      correlationId,
    });
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para gestionar tareas.",
      correlationId,
    );
  };

  const referenceError = (caught: unknown): Response | null => {
    if (caught instanceof TaskSubjectNotInOrganizationError) {
      return error(
        404,
        "NOT_FOUND",
        "Alguna de las referencias no existe en tu organización.",
        correlationId,
      );
    }
    if (caught instanceof MembershipNotActiveInOrganizationError) {
      return error(
        409,
        "MEMBERSHIP_NOT_ACTIVE",
        "Quien recibiría la tarea no tiene una membresía activa.",
        correlationId,
      );
    }
    return null;
  };

  if (suffix === "" || suffix === "/") {
    if (request.method === "GET") {
      const assignee = url.searchParams.get("assignee") ?? "all";
      const status = url.searchParams.get("status");
      const dueBefore = url.searchParams.get("dueBefore");
      if (status !== null && !statusSchema.safeParse(status).success) {
        return error(
          400,
          "INVALID_QUERY",
          "El estado solicitado no es válido.",
          correlationId,
        );
      }
      if (dueBefore !== null && !dueAtSchema.safeParse(dueBefore).success) {
        return error(
          400,
          "INVALID_QUERY",
          "La fecha límite solicitada no es válida.",
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

      const subjectType = url.searchParams.get("subjectType");
      const subjectId = url.searchParams.get("subjectId");
      if (subjectType || subjectId) {
        const subject = subjectSchema.safeParse({
          type: subjectType,
          id: subjectId,
        });
        if (!subject.success) {
          return error(
            400,
            "INVALID_QUERY",
            "El sujeto solicitado no es válido.",
            correlationId,
          );
        }
        return json({
          tasks: await repository.listBySubject(organizationId, subject.data, {
            limit,
          }),
        });
      }

      const tasks = await repository.list(organizationId, {
        assigneeMembershipId:
          assignee === "all"
            ? undefined
            : assignee === "me"
              ? membershipId
              : assignee,
        status: (status ?? undefined) as TaskStatus | undefined,
        dueBefore: dueBefore ?? undefined,
        limit,
      });
      // La lista anuncia el recorte en vez de fingir que muestra todo.
      return json({ tasks, limit, truncated: tasks.length === limit });
    }

    if (request.method === "POST") {
      if (!canManage) return denyManagement("task.create", null);
      const parsed = createSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return error(
          400,
          "INVALID_TASK",
          "La tarea solicitada no es válida.",
          correlationId,
        );
      }
      try {
        const task = await repository.create(organizationId, {
          ...parsed.data,
          createdByMembershipId: membershipId,
        });
        await repository.recordAudit({
          organizationId,
          actorId: context.user.id,
          taskId: task.id,
          action: "task.create",
          result: "allowed",
          correlationId,
        });
        return json({ task }, 201);
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

  const taskMatch = suffix.match(/^\/([^/]+)$/);
  if (!taskMatch) {
    return error(404, "NOT_FOUND", "La tarea solicitada no existe.", correlationId);
  }
  const taskId = decodeURIComponent(taskMatch[1]);

  // Se resuelve antes de decidir el método para que una tarea de otra
  // organización responda `404` en todas las ramas.
  const current = await repository.find(organizationId, taskId);
  if (current === null) {
    return error(404, "NOT_FOUND", "La tarea solicitada no existe.", correlationId);
  }

  if (request.method === "GET") {
    return json({ task: current });
  }

  if (request.method === "PATCH") {
    if (!canManage) return denyManagement("task.update", taskId);
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return error(
        400,
        "INVALID_TASK_UPDATE",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    try {
      const task = await repository.update(organizationId, taskId, parsed.data);
      if (task === null) {
        return error(
          409,
          "TASK_VERSION_CONFLICT",
          "La tarea cambió; vuelve a cargarla.",
          correlationId,
        );
      }
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        taskId,
        action: "task.update",
        result: "allowed",
        correlationId,
      });
      return json({ task });
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
