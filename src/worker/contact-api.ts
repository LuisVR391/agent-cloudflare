import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import { encodeCursor, json, parseCursor, parseLimit } from "./http/api-helpers";
import { ContactNotInOrganizationError } from "./domain/errors";
import { ContactRepository } from "./repositories/contact-repository";

const QUERY_MAX_LENGTH = 128;

/**
 * El teléfono llega del canal sin formato garantizado, así que la edición
 * acepta lo que una persona escribiría y solo rechaza lo que no puede ser un
 * número. Normalizar a E.164 exigiría conocer el país y perdería el valor que
 * el proveedor observó.
 */
const phoneSchema = z
  .string()
  .trim()
  .min(6)
  .max(32)
  .regex(/^\+?[0-9][0-9\s()\-.]*$/);

const updateSchema = z
  .object({
    expectedVersion: z.number().int().positive(),
    displayName: z.string().trim().min(1).max(256).nullable().optional(),
    phoneNumber: phoneSchema.nullable().optional(),
    email: z.email().max(320).nullable().optional(),
    status: z.enum(["active", "archived"]).optional(),
  })
  .refine(
    (value) =>
      value.displayName !== undefined ||
      value.phoneNumber !== undefined ||
      value.email !== undefined ||
      value.status !== undefined,
  );

const tagSchema = z.object({
  name: z.string().trim().min(1).max(64),
  color: z.enum(["neutral", "info", "success", "warning", "danger"]).optional(),
});

/**
 * Superficie del directorio de contactos. Reproduce el contrato que ya usa
 * `/api/conversations`: cursor opaco, permisos verificados en cada rama y
 * `404` —nunca `403`— para un recurso de otra organización, de modo que la
 * respuesta no revele que existe.
 */
export async function routeContactApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  const isDirectory = url.pathname.startsWith("/api/contacts");
  const isTagCatalog = url.pathname === "/api/contact-tags";
  if (!isDirectory && !isTagCatalog) return null;

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
  const repository = new ContactRepository(env.DB);

  const canRead = permissions.includes("contacts.read");
  const canManage = permissions.includes("contacts.manage");
  if (!canRead) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar contactos.",
      correlationId,
    );
  }

  if (isTagCatalog) {
    if (request.method !== "GET") {
      return error(
        405,
        "METHOD_NOT_ALLOWED",
        "El método solicitado no está permitido.",
        correlationId,
      );
    }
    return json({ tags: await repository.listTags(organizationId) });
  }

  const suffix = url.pathname.slice("/api/contacts".length);

  if (request.method === "GET" && (suffix === "" || suffix === "/")) {
    const rawQuery = url.searchParams.get("query");
    if (rawQuery !== null && rawQuery.length > QUERY_MAX_LENGTH) {
      return error(
        400,
        "INVALID_QUERY",
        "La búsqueda solicitada no es válida.",
        correlationId,
      );
    }
    const pageLimit = parseLimit(url.searchParams.get("limit"), 30);
    if (!pageLimit) {
      return error(
        400,
        "INVALID_LIMIT",
        "El límite solicitado no es válido.",
        correlationId,
      );
    }
    const page = parseCursor(url.searchParams.get("cursor"));
    if (!page) {
      return error(
        400,
        "INVALID_CURSOR",
        "El cursor solicitado no es válido.",
        correlationId,
      );
    }
    const result = await repository.search(organizationId, {
      query: rawQuery ?? undefined,
      limit: pageLimit,
      cursor: page.cursor,
    });
    return json({
      contacts: result.contacts,
      nextCursor: encodeCursor(result.nextCursor),
    });
  }

  const tagMatch = suffix.match(/^\/([^/]+)\/tags(?:\/([^/]+))?$/);
  const contactMatch = suffix.match(/^\/([^/]+)$/);
  if (!tagMatch && !contactMatch) {
    return error(
      404,
      "NOT_FOUND",
      "El contacto solicitado no existe.",
      correlationId,
    );
  }

  const contactId = decodeURIComponent((tagMatch ?? contactMatch)![1]);
  const profile = await repository.findProfile(organizationId, contactId);
  if (!profile) {
    return error(
      404,
      "NOT_FOUND",
      "El contacto solicitado no existe.",
      correlationId,
    );
  }

  if (contactMatch && request.method === "GET") {
    return json({ contact: profile });
  }

  if (contactMatch && request.method === "PATCH") {
    if (!canManage) {
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        contactId,
        action: "contact.profile.update",
        result: "denied",
        correlationId,
      });
      return error(
        403,
        "FORBIDDEN",
        "No tienes permiso para editar contactos.",
        correlationId,
      );
    }
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return error(
        400,
        "INVALID_CONTACT_UPDATE",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    const updated = await repository.updateProfile(
      organizationId,
      contactId,
      parsed.data,
    );
    if (!updated) {
      return error(
        409,
        "CONTACT_VERSION_CONFLICT",
        "El contacto cambió; vuelve a cargarlo.",
        correlationId,
      );
    }
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      contactId,
      action: "contact.profile.update",
      result: "allowed",
      correlationId,
    });
    return json({ contact: updated });
  }

  if (tagMatch && request.method === "POST" && tagMatch[2] === undefined) {
    if (!canManage) {
      return error(
        403,
        "FORBIDDEN",
        "No tienes permiso para etiquetar contactos.",
        correlationId,
      );
    }
    const parsed = tagSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return error(
        400,
        "INVALID_CONTACT_TAG",
        "La etiqueta solicitada no es válida.",
        correlationId,
      );
    }
    try {
      await repository.assignTag(organizationId, {
        contactId,
        name: parsed.data.name,
        color: parsed.data.color,
        assignedBy: context.user.id,
      });
    } catch (caught) {
      if (caught instanceof ContactNotInOrganizationError) {
        return error(
          404,
          "NOT_FOUND",
          "El contacto solicitado no existe.",
          correlationId,
        );
      }
      throw caught;
    }
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      contactId,
      action: "contact.tag.assign",
      result: "allowed",
      correlationId,
    });
    return json({
      contact: await repository.findProfile(organizationId, contactId),
    });
  }

  if (tagMatch && request.method === "DELETE" && tagMatch[2] !== undefined) {
    if (!canManage) {
      return error(
        403,
        "FORBIDDEN",
        "No tienes permiso para etiquetar contactos.",
        correlationId,
      );
    }
    const removed = await repository.removeTag(
      organizationId,
      contactId,
      decodeURIComponent(tagMatch[2]),
    );
    if (!removed) {
      return error(
        404,
        "NOT_FOUND",
        "La etiqueta solicitada no está asignada.",
        correlationId,
      );
    }
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      contactId,
      action: "contact.tag.remove",
      result: "allowed",
      correlationId,
    });
    return json({
      contact: await repository.findProfile(organizationId, contactId),
    });
  }

  return error(
    405,
    "METHOD_NOT_ALLOWED",
    "El método solicitado no está permitido.",
    correlationId,
  );
}
