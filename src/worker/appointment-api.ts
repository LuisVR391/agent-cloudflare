import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import { initialStatuses } from "./domain/appointment-status";
import {
  AppointmentReferenceNotInOrganizationError,
  AppointmentTransitionNotAllowedError,
  MembershipNotActiveInOrganizationError,
} from "./domain/errors";
import { agendaRange, isCivilDate, zonedToday } from "./domain/time-zone";
import type { AppointmentStatus } from "./domain/types";
import { json, parseLimit } from "./http/api-helpers";
import { AppointmentRepository } from "./repositories/appointment-repository";

const idSchema = z.string().min(1).max(64);

const statusSchema = z.enum([
  "requested",
  "pending",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
]);

/** Solo los estados que aún no describen un desenlace pueden estrenar una cita. */
const initialStatusSchema = z.enum(
  initialStatuses as [AppointmentStatus, ...AppointmentStatus[]],
);

// Instantes en ISO 8601 UTC, como el resto del esquema. La zona horaria de la
// organización decide cómo se agrupan, nunca cómo se almacenan.
const instantSchema = z.iso.datetime();

const subjectSchema = z.object({
  type: z.enum(["contact", "conversation", "opportunity"]),
  id: idSchema,
});

const createSchema = z
  .object({
    contactId: idSchema,
    serviceId: idSchema,
    startsAt: instantSchema,
    // Ausente deriva el fin de la duración del servicio.
    endsAt: instantSchema.optional(),
    assigneeMembershipId: idSchema.nullable().optional(),
    // El origen no es excluyente: la misma cita puede nacer en una conversación
    // y pertenecer a la oportunidad que esa conversación abrió.
    conversationId: idSchema.nullable().optional(),
    opportunityId: idSchema.nullable().optional(),
    status: initialStatusSchema.optional(),
  })
  .refine(
    (value) =>
      value.endsAt === undefined ||
      Date.parse(value.endsAt) > Date.parse(value.startsAt),
  );

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    startsAt: instantSchema.optional(),
    endsAt: instantSchema.optional(),
    // `null` deja la cita sin responsable; omitirlo lo conserva.
    assigneeMembershipId: idSchema.nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine((value) =>
    [
      value.startsAt,
      value.endsAt,
      value.assigneeMembershipId,
      value.status,
    ].some((field) => field !== undefined),
  )
  .refine(
    (value) =>
      value.startsAt === undefined ||
      value.endsAt === undefined ||
      Date.parse(value.endsAt) > Date.parse(value.startsAt),
  );

/**
 * Agenda de citas. Los tres roles la gestionan, porque quien atiende la
 * conversación es quien acuerda el horario.
 *
 * El rango de la agenda se resuelve aquí y no en el cliente: es una consulta a
 * D1 y el filtro tiene que llegar en UTC, interpretado con la zona horaria de la
 * organización. Confiar en el navegador dejaría que cada persona viera una
 * agenda distinta de la misma empresa.
 */
export async function routeAppointmentApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/appointments")) return null;

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
  const timeZone = context.activeOrganization.organizationTimeZone;
  const permissions = context.activeOrganization.permissions;
  const repository = new AppointmentRepository(env.DB);
  const suffix = url.pathname.slice("/api/appointments".length);

  if (!permissions.includes("appointments.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar la agenda.",
      correlationId,
    );
  }
  const canManage = permissions.includes("appointments.manage");

  const denyManagement = async (
    action: "appointment.create" | "appointment.update",
    appointmentId: string | null,
  ) => {
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      appointmentId,
      action,
      result: "rejected",
      correlationId,
    });
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para gestionar citas.",
      correlationId,
    );
  };

  const referenceError = (caught: unknown): Response | null => {
    if (caught instanceof AppointmentReferenceNotInOrganizationError) {
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
        "Quien atendería la cita no tiene una membresía activa.",
        correlationId,
      );
    }
    if (caught instanceof AppointmentTransitionNotAllowedError) {
      return error(
        409,
        "APPOINTMENT_TRANSITION_NOT_ALLOWED",
        "La cita no puede pasar a ese estado.",
        correlationId,
      );
    }
    return null;
  };

  if (suffix === "" || suffix === "/") {
    if (request.method === "GET") {
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
          appointments: await repository.listBySubject(
            organizationId,
            subject.data,
            { limit },
          ),
          timeZone,
        });
      }

      // Sin fecha, la agenda abre en el día que la empresa está viviendo, no en
      // el del servidor.
      const date = url.searchParams.get("date") ?? zonedToday(timeZone);
      const range = url.searchParams.get("range") ?? "day";
      const status = url.searchParams.get("status");
      const assignee = url.searchParams.get("assignee") ?? "all";

      if (!isCivilDate(date)) {
        return error(
          400,
          "INVALID_QUERY",
          "La fecha solicitada no es válida.",
          correlationId,
        );
      }
      if (range !== "day" && range !== "week") {
        return error(
          400,
          "INVALID_QUERY",
          "El rango solicitado no es válido.",
          correlationId,
        );
      }
      if (status !== null && !statusSchema.safeParse(status).success) {
        return error(
          400,
          "INVALID_QUERY",
          "El estado solicitado no es válido.",
          correlationId,
        );
      }

      const window = agendaRange(date, range, timeZone);
      const appointments = await repository.list(organizationId, {
        ...window,
        assigneeMembershipId:
          assignee === "all"
            ? undefined
            : assignee === "me"
              ? membershipId
              : assignee,
        status: (status ?? undefined) as AppointmentStatus | undefined,
        limit,
      });

      // La agenda anuncia el recorte en vez de fingir que muestra todo.
      return json({
        appointments,
        timeZone,
        date,
        range,
        window,
        limit,
        truncated: appointments.length === limit,
      });
    }

    if (request.method === "POST") {
      if (!canManage) return denyManagement("appointment.create", null);
      const parsed = createSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return error(
          400,
          "INVALID_APPOINTMENT",
          "La cita solicitada no es válida.",
          correlationId,
        );
      }
      try {
        const appointment = await repository.create(organizationId, {
          ...parsed.data,
          createdByMembershipId: membershipId,
          actorId: context.user.id,
          correlationId,
        });
        await repository.recordAudit({
          organizationId,
          actorId: context.user.id,
          appointmentId: appointment.id,
          action: "appointment.create",
          result: "allowed",
          correlationId,
        });
        return json({ appointment }, 201);
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

  const appointmentMatch = suffix.match(/^\/([^/]+)$/);
  if (!appointmentMatch) {
    return error(404, "NOT_FOUND", "La cita solicitada no existe.", correlationId);
  }
  const appointmentId = decodeURIComponent(appointmentMatch[1]);

  // Se resuelve antes de decidir el método para que una cita de otra
  // organización responda `404` en todas las ramas.
  const current = await repository.findDetail(organizationId, appointmentId);
  if (current === null) {
    return error(404, "NOT_FOUND", "La cita solicitada no existe.", correlationId);
  }

  if (request.method === "GET") {
    return json({ appointment: current, timeZone });
  }

  if (request.method === "PATCH") {
    if (!canManage) return denyManagement("appointment.update", appointmentId);
    const parsed = updateSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return error(
        400,
        "INVALID_APPOINTMENT_UPDATE",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    try {
      const appointment = await repository.update(organizationId, appointmentId, {
        ...parsed.data,
        actorId: context.user.id,
        correlationId,
      });
      if (appointment === null) {
        return error(
          409,
          "APPOINTMENT_VERSION_CONFLICT",
          "La cita cambió; vuelve a cargarla.",
          correlationId,
        );
      }
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        appointmentId,
        action: "appointment.update",
        result: "allowed",
        correlationId,
      });
      return json({ appointment });
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
