import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import { DuplicateServiceNameError } from "./domain/errors";
import { json } from "./http/api-helpers";
import { ServiceRepository } from "./repositories/service-repository";

/**
 * Importe en la unidad menor de la moneda. El máximo evita que un error de
 * captura persista una cifra absurda; no es una regla de negocio sobre precios.
 */
const priceSchema = z.object({
  amountCents: z.number().int().min(0).max(100_000_000),
  currency: z
    .string()
    .trim()
    .regex(/^[A-Za-z]{3}$/)
    .transform((value) => value.toUpperCase()),
});

const nameSchema = z.string().trim().min(1).max(120);
// El límite superior es un día, igual que el `CHECK` de la migración: una cita
// más larga que eso describe otra cosa.
const durationSchema = z.number().int().min(1).max(1440);
const statusSchema = z.enum(["active", "archived"]);

const createSchema = z.object({
  name: nameSchema,
  durationMinutes: durationSchema,
  price: priceSchema.nullable().optional(),
  status: statusSchema.optional(),
});

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    name: nameSchema.optional(),
    durationMinutes: durationSchema.optional(),
    // `null` borra importe y moneda a la vez; omitirlo conserva ambos.
    price: priceSchema.nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.durationMinutes !== undefined ||
      value.price !== undefined ||
      value.status !== undefined,
  );

/**
 * Catálogo de servicios de la organización activa. Reproduce el contrato que ya
 * usan contactos y equipo: permisos verificados en cada rama, `404` —nunca
 * `403`— para un recurso de otra organización, y concurrencia optimista con
 * `expectedVersion` para no pisar la edición de otra persona.
 *
 * Un servicio no se borra: se archiva. Las oportunidades y las citas que lo
 * referencien deben seguir explicando qué se vendió.
 */
export async function routeServiceApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/services")) return null;

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
  const repository = new ServiceRepository(env.DB);
  const suffix = url.pathname.slice("/api/services".length);

  if (!permissions.includes("services.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar los servicios.",
      correlationId,
    );
  }
  const canManage = permissions.includes("services.manage");

  const denyManagement = async (
    action: "service.create" | "service.update",
    serviceId: string | null,
  ) => {
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      serviceId,
      action,
      result: "rejected",
      correlationId,
    });
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para gestionar los servicios.",
      correlationId,
    );
  };

  if (suffix === "" || suffix === "/") {
    if (request.method === "GET") {
      const requested = url.searchParams.get("status");
      if (requested !== null && !["active", "archived", "all"].includes(requested)) {
        return error(
          400,
          "INVALID_STATUS",
          "El estado solicitado no es válido.",
          correlationId,
        );
      }
      const status = (requested ?? "active") as "active" | "archived" | "all";
      return json({ services: await repository.list(organizationId, { status }) });
    }

    if (request.method === "POST") {
      if (!canManage) return denyManagement("service.create", null);
      const parsed = createSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return error(
          400,
          "INVALID_SERVICE",
          "El servicio solicitado no es válido.",
          correlationId,
        );
      }
      try {
        const service = await repository.create(organizationId, {
          name: parsed.data.name,
          durationMinutes: parsed.data.durationMinutes,
          priceAmountCents: parsed.data.price?.amountCents ?? null,
          priceCurrency: parsed.data.price?.currency ?? null,
          status: parsed.data.status,
        });
        await repository.recordAudit({
          organizationId,
          actorId: context.user.id,
          serviceId: service.id,
          action: "service.create",
          result: "allowed",
          correlationId,
        });
        return json({ service }, 201);
      } catch (caught) {
        if (caught instanceof DuplicateServiceNameError) {
          return error(
            409,
            "SERVICE_NAME_TAKEN",
            "Ya existe un servicio con ese nombre.",
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

  const serviceMatch = suffix.match(/^\/([^/]+)$/);
  if (!serviceMatch) {
    return error(
      404,
      "NOT_FOUND",
      "El servicio solicitado no existe.",
      correlationId,
    );
  }
  const serviceId = decodeURIComponent(serviceMatch[1]);

  // Se resuelve antes de decidir el método para que un servicio de otra
  // organización responda `404` en todas las ramas y la respuesta no revele que
  // existe.
  const current = await repository.findById(organizationId, serviceId);
  if (current === null) {
    return error(
      404,
      "NOT_FOUND",
      "El servicio solicitado no existe.",
      correlationId,
    );
  }

  if (request.method === "GET") {
    return json({ service: current });
  }

  if (request.method === "PATCH") {
    if (!canManage) return denyManagement("service.update", serviceId);
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return error(
        400,
        "INVALID_SERVICE_UPDATE",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    try {
      const service = await repository.update(organizationId, serviceId, {
        expectedVersion: parsed.data.expectedVersion,
        name: parsed.data.name,
        durationMinutes: parsed.data.durationMinutes,
        price:
          parsed.data.price === undefined
            ? undefined
            : parsed.data.price === null
              ? null
              : {
                  amountCents: parsed.data.price.amountCents,
                  currency: parsed.data.price.currency,
                },
        status: parsed.data.status,
      });
      if (service === null) {
        return error(
          409,
          "SERVICE_VERSION_CONFLICT",
          "El servicio cambió; vuelve a cargarlo.",
          correlationId,
        );
      }
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        serviceId,
        action: "service.update",
        result: "allowed",
        correlationId,
      });
      return json({ service });
    } catch (caught) {
      if (caught instanceof DuplicateServiceNameError) {
        return error(
          409,
          "SERVICE_NAME_TAKEN",
          "Ya existe un servicio con ese nombre.",
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
