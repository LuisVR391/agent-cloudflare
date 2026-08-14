import { z } from "zod";

import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import {
  ContactNotInOrganizationError,
  MembershipNotActiveInOrganizationError,
} from "./domain/errors";
import { json, parseLimit } from "./http/api-helpers";
import { NoteRepository } from "./repositories/note-repository";

const idSchema = z.string().min(1).max(64);

const createSchema = z.object({
  contactId: idSchema,
  // La conversación desde la que se escribe. Omitirla produce una nota de
  // ficha, sin origen conversacional.
  conversationId: idSchema.nullable().optional(),
  // Una nota vacía no dice nada y el tope evita convertir la ficha en un
  // documento; el cuerpo largo pertenece a un archivo, no a una nota.
  body: z.string().trim().min(1).max(4000),
});

/**
 * Notas del contacto. Se leen con `contacts.read` y se escriben con
 * `contacts.manage`: la nota vive en la ficha y no estrena permisos propios.
 *
 * El autor no viaja en el cuerpo. Lo pone el handler con la membresía de la
 * sesión, porque un identificador enviado por el frontend no demuestra quién
 * escribe.
 */
export async function routeNoteApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/notes")) return null;

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
  const repository = new NoteRepository(env.DB);
  const suffix = url.pathname.slice("/api/notes".length);

  if (suffix !== "" && suffix !== "/") {
    return error(404, "NOT_FOUND", "La ruta solicitada no existe.", correlationId);
  }

  if (!permissions.includes("contacts.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar contactos.",
      correlationId,
    );
  }

  if (request.method === "GET") {
    const contactId = url.searchParams.get("contactId");
    const conversationId = url.searchParams.get("conversationId");
    if (!contactId && !conversationId) {
      return error(
        400,
        "INVALID_QUERY",
        "Indica el contacto o la conversación que quieres consultar.",
        correlationId,
      );
    }
    const limit = parseLimit(url.searchParams.get("limit"), 50);
    if (!limit) {
      return error(
        400,
        "INVALID_LIMIT",
        "El límite solicitado no es válido.",
        correlationId,
      );
    }
    // El contacto manda cuando llegan los dos: la ficha muestra todas las notas
    // del contacto, no solo las de un hilo.
    const notes = contactId
      ? await repository.listByContact(organizationId, contactId, { limit })
      : await repository.listByConversation(organizationId, conversationId!, {
          limit,
        });
    return json({ notes });
  }

  if (request.method === "POST") {
    if (!permissions.includes("contacts.manage")) {
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        noteId: null,
        action: "contact_note.create",
        result: "rejected",
        correlationId,
      });
      return error(
        403,
        "FORBIDDEN",
        "No tienes permiso para anotar sobre contactos.",
        correlationId,
      );
    }

    const parsed = createSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return error(
        400,
        "INVALID_NOTE",
        "La nota solicitada no es válida.",
        correlationId,
      );
    }

    try {
      const note = await repository.create(organizationId, {
        ...parsed.data,
        authorMembershipId: context.activeOrganization.membershipId,
      });
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        noteId: note.id,
        action: "contact_note.create",
        result: "allowed",
        correlationId,
      });
      return json({ note }, 201);
    } catch (caught) {
      if (caught instanceof ContactNotInOrganizationError) {
        // Contacto ajeno y conversación ajena responden igual: distinguirlas
        // revelaría qué identificador existe en otra organización.
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
          "Tu membresía ya no está activa en esta organización.",
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
