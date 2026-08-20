import { z } from "zod";

import {
  agentToolCatalogEntries,
  isAgentToolKey,
} from "./agents/tool-catalog";
import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import {
  AgentPublicationUnchangedError,
  AgentVersionNotEditableError,
  AgentVersionNotInOrganizationError,
  DuplicateAgentNameError,
} from "./domain/errors";
import { json } from "./http/api-helpers";
import { AgentRepository } from "./repositories/agent-repository";

const idSchema = z.string().min(1).max(64);
const nameSchema = z.string().trim().min(1).max(120);
const purposeSchema = z.string().trim().max(500);
const expectedVersionSchema = z.number().int().positive();
const statusSchema = z.enum(["active", "archived"]);

/**
 * Las instrucciones y el playbook son texto largo de la empresa. El máximo no
 * es una regla de negocio: evita que un pegado accidental persista un documento
 * entero en una columna que el runtime cargará en cada conversación.
 */
const instructionsSchema = z.string().trim().min(1).max(20_000);
const playbookSchema = z.string().trim().max(20_000);

/**
 * Identificador opaco del modelo previsto. Se valida la forma, no la
 * pertenencia a un catálogo: qué modelos existen lo decide la capa común de
 * proveedor, que llega con la ejecución del agente (ADR-0014).
 */
const modelSchema = z.string().trim().min(1).max(120);

/**
 * Forma de una lista de etiquetas declaradas. El alcance de conocimiento sigue
 * sin catálogo —el suyo llega con la recuperación de conocimiento—, así que
 * aquí solo se valida la forma.
 */
const declarationSchema = z.array(z.string().trim().min(1).max(80)).max(50);

/**
 * Las herramientas sí tienen catálogo desde este corte: declarar una clave que
 * el producto no implementa no deja constancia de nada, porque el handler vive
 * en código. Se compara la clave tal como el catálogo la reconoce, que es la
 * forma normalizada que el repositorio persiste.
 */
function unknownToolDeclaration(tools: string[] | undefined): boolean {
  return (tools ?? []).some((candidate) => !isAgentToolKey(candidate));
}

/** El motivo de una publicación es obligatorio; el de una revisión, no. */
const reasonSchema = z.string().trim().min(1).max(500);
const changeReasonSchema = z.string().trim().max(500);

const createSchema = z.object({
  name: nameSchema,
  purpose: purposeSchema.nullable().optional(),
});

const updateSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    name: nameSchema.optional(),
    // `null` deja el agente sin propósito; omitirlo lo conserva.
    purpose: purposeSchema.nullable().optional(),
    status: statusSchema.optional(),
  })
  .refine(
    (value) =>
      value.name !== undefined ||
      value.purpose !== undefined ||
      value.status !== undefined,
  );

/**
 * Un borrador nace de una de dos maneras y nunca de las dos: escrito entero, o
 * derivado de otra revisión para editarlo después. Aceptar ambas a la vez
 * obligaría a decidir en silencio cuál gana.
 */
const createVersionSchema = z
  .object({
    expectedVersion: expectedVersionSchema,
    fromVersionId: idSchema.optional(),
    instructions: instructionsSchema.optional(),
    model: modelSchema.optional(),
    playbook: playbookSchema.nullable().optional(),
    tools: declarationSchema.optional(),
    knowledgeScopes: declarationSchema.optional(),
    changeReason: changeReasonSchema.nullable().optional(),
  })
  .refine((value) => {
    const derived = value.fromVersionId !== undefined;
    const written = value.instructions !== undefined && value.model !== undefined;
    if (derived === written) return false;
    if (!derived) return true;
    // Derivar copia el contenido de la fuente: mezclarlo con contenido propio
    // haría ambiguo qué quedó en la revisión nueva.
    return (
      value.instructions === undefined &&
      value.model === undefined &&
      value.playbook === undefined &&
      value.tools === undefined &&
      value.knowledgeScopes === undefined
    );
  });

/**
 * El contenido del borrador se reemplaza entero, y por eso es `PUT` y no
 * `PATCH`: las herramientas y el alcance son conjuntos, así que omitirlos en un
 * cambio parcial no diría si hay que conservarlos o vaciarlos.
 */
const replaceVersionSchema = z.object({
  expectedVersion: expectedVersionSchema,
  instructions: instructionsSchema,
  model: modelSchema,
  playbook: playbookSchema.nullable().optional(),
  tools: declarationSchema.optional(),
  knowledgeScopes: declarationSchema.optional(),
  changeReason: changeReasonSchema.nullable().optional(),
});

/**
 * Publica, revierte o desactiva. `versionId` nulo deja al agente sin versión
 * publicada sin borrar ninguna.
 */
const publicationSchema = z.object({
  expectedVersion: expectedVersionSchema,
  versionId: idSchema.nullable(),
  reason: reasonSchema,
});

/**
 * Agentes de la organización activa y sus versiones. Reproduce el contrato de
 * los cortes anteriores: permisos verificados en cada rama, `404` —nunca
 * `403`— para un recurso de otra organización, y concurrencia optimista con
 * `expectedVersion`.
 *
 * Este corte no ejecuta nada. Publicar una versión no cambia el comportamiento
 * de ninguna conversación: cargarla y llamar a un modelo es el corte siguiente.
 *
 * El prefijo es `/api/agents` y no colisiona con `/agents/`, que sirve el SDK
 * para el runtime durable: `src/worker/index.ts` resuelve `/api/` antes.
 */
export async function routeAgentApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  // El catálogo de herramientas se sirve aquí porque se lee con el mismo
  // permiso que un agente y se declara desde la misma pantalla, aunque no
  // cuelgue de un agente concreto: es del producto, no de la organización.
  const isToolCatalog = url.pathname === "/api/agent-tools";
  if (!isToolCatalog && !url.pathname.startsWith("/api/agents")) return null;

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
  const repository = new AgentRepository(env.DB);
  const suffix = url.pathname.slice("/api/agents".length);

  if (!permissions.includes("agents.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar los agentes.",
      correlationId,
    );
  }
  const canManage = permissions.includes("agents.manage");

  const denyManagement = async (
    action:
      | "agent.create"
      | "agent.update"
      | "agent_version.create"
      | "agent_version.update"
      | "agent.publication_change",
    resource: { type: "agent" | "agent_version"; id: string | null },
  ) => {
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      resource,
      action,
      result: "rejected",
      correlationId,
    });
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para gestionar los agentes.",
      correlationId,
    );
  };

  const notFound = () =>
    error(404, "NOT_FOUND", "El agente solicitado no existe.", correlationId);

  const conflict = () =>
    error(
      409,
      "AGENT_VERSION_CONFLICT",
      "El agente cambió; vuelve a cargarlo.",
      correlationId,
    );

  const methodNotAllowed = () =>
    error(
      405,
      "METHOD_NOT_ALLOWED",
      "El método solicitado no está permitido.",
      correlationId,
    );

  const unknownTool = () =>
    error(
      400,
      "AGENT_TOOL_UNKNOWN",
      "Alguna herramienta declarada no existe en el catálogo.",
      correlationId,
    );

  if (isToolCatalog) {
    if (request.method !== "GET") return methodNotAllowed();
    // El catálogo no es de nadie en particular: no hay recurso ajeno que
    // ocultar y una lectura sin efecto no se audita, como el resto de las
    // lecturas del repositorio.
    return json({ tools: agentToolCatalogEntries() });
  }

  if (suffix === "" || suffix === "/") {
    if (request.method === "GET") {
      const requested = url.searchParams.get("status");
      if (
        requested !== null &&
        !["active", "archived", "all"].includes(requested)
      ) {
        return error(
          400,
          "INVALID_STATUS",
          "El estado solicitado no es válido.",
          correlationId,
        );
      }
      const status = (requested ?? "active") as "active" | "archived" | "all";
      return json({ agents: await repository.list(organizationId, { status }) });
    }

    if (request.method === "POST") {
      if (!canManage) {
        return denyManagement("agent.create", { type: "agent", id: null });
      }
      const parsed = createSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return error(
          400,
          "INVALID_AGENT",
          "El agente solicitado no es válido.",
          correlationId,
        );
      }
      try {
        const agent = await repository.create(organizationId, {
          name: parsed.data.name,
          purpose: parsed.data.purpose,
          createdByMembershipId: membershipId,
        });
        await repository.recordAudit({
          organizationId,
          actorId: context.user.id,
          resource: { type: "agent", id: agent.id },
          action: "agent.create",
          result: "allowed",
          correlationId,
        });
        return json({ agent }, 201);
      } catch (caught) {
        return nameConflictOrRethrow(caught, correlationId);
      }
    }

    return methodNotAllowed();
  }

  const match = suffix.match(
    /^\/([^/]+)(?:\/(versions|publication))?(?:\/([^/]+))?$/,
  );
  if (!match) return notFound();
  const agentId = decodeURIComponent(match[1]);
  const collection = match[2];
  const versionId = match[3] === undefined ? null : decodeURIComponent(match[3]);
  // El segmento opcional final solo tiene sentido bajo `versions`. Sin esta
  // guarda, una subruta desconocida caería en la rama del detalle y respondería
  // como si la ruta existiera.
  if (collection !== "versions" && versionId !== null) return notFound();

  // Se resuelve antes de decidir el método para que un agente de otra
  // organización responda `404` en todas las ramas y la respuesta no revele que
  // existe.
  const current = await repository.find(organizationId, agentId);
  if (current === null) return notFound();

  if (collection === undefined) {
    if (request.method === "GET") {
      const agent = await repository.findDetail(organizationId, agentId);
      return agent === null ? notFound() : json({ agent });
    }

    if (request.method === "PATCH") {
      if (!canManage) {
        return denyManagement("agent.update", { type: "agent", id: agentId });
      }
      const parsed = updateSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return error(
          400,
          "INVALID_AGENT_UPDATE",
          "El cambio solicitado no es válido.",
          correlationId,
        );
      }
      try {
        const agent = await repository.update(organizationId, agentId, {
          expectedVersion: parsed.data.expectedVersion,
          name: parsed.data.name,
          purpose: parsed.data.purpose,
          status: parsed.data.status,
        });
        if (agent === null) return conflict();
        await repository.recordAudit({
          organizationId,
          actorId: context.user.id,
          resource: { type: "agent", id: agentId },
          action: "agent.update",
          result: "allowed",
          correlationId,
        });
        return json({ agent });
      } catch (caught) {
        return nameConflictOrRethrow(caught, correlationId);
      }
    }

    return methodNotAllowed();
  }

  if (collection === "versions") {
    if (versionId === null) {
      if (request.method !== "POST") return methodNotAllowed();
      if (!canManage) {
        return denyManagement("agent_version.create", {
          type: "agent",
          id: agentId,
        });
      }
      const parsed = createVersionSchema.safeParse(
        await request.json().catch(() => null),
      );
      if (!parsed.success) {
        return error(
          400,
          "INVALID_AGENT_VERSION",
          "La versión solicitada no es válida.",
          correlationId,
        );
      }
      // Se comprueba antes de escribir nada: una declaración desconocida no
      // deja media versión creada. Derivar de otra revisión no pasa por aquí,
      // porque copia lo que ya se declaró y no declara nada nuevo.
      if (unknownToolDeclaration(parsed.data.tools)) return unknownTool();
      try {
        const agent = await repository.createVersion(organizationId, agentId, {
          expectedVersion: parsed.data.expectedVersion,
          fromVersionId: parsed.data.fromVersionId ?? null,
          content:
            parsed.data.fromVersionId === undefined
              ? {
                  instructions: parsed.data.instructions ?? "",
                  model: parsed.data.model ?? "",
                  playbook: parsed.data.playbook,
                  tools: parsed.data.tools,
                  knowledgeScopes: parsed.data.knowledgeScopes,
                }
              : null,
          changeReason: parsed.data.changeReason,
          createdByMembershipId: membershipId,
        });
        if (agent === null) return conflict();
        await repository.recordAudit({
          organizationId,
          actorId: context.user.id,
          resource: { type: "agent", id: agentId },
          action: "agent_version.create",
          result: "allowed",
          correlationId,
        });
        return json({ agent }, 201);
      } catch (caught) {
        return versionErrorOrRethrow(caught, correlationId);
      }
    }

    if (request.method !== "PUT") return methodNotAllowed();
    if (!canManage) {
      return denyManagement("agent_version.update", {
        type: "agent_version",
        id: versionId,
      });
    }
    const parsed = replaceVersionSchema.safeParse(
      await request.json().catch(() => null),
    );
    if (!parsed.success) {
      return error(
        400,
        "INVALID_AGENT_VERSION",
        "El cambio solicitado no es válido.",
        correlationId,
      );
    }
    if (unknownToolDeclaration(parsed.data.tools)) return unknownTool();
    try {
      const agent = await repository.updateVersion(
        organizationId,
        agentId,
        versionId,
        {
          expectedVersion: parsed.data.expectedVersion,
          instructions: parsed.data.instructions,
          model: parsed.data.model,
          playbook: parsed.data.playbook,
          tools: parsed.data.tools,
          knowledgeScopes: parsed.data.knowledgeScopes,
          changeReason: parsed.data.changeReason,
        },
      );
      if (agent === null) return conflict();
      await repository.recordAudit({
        organizationId,
        actorId: context.user.id,
        resource: { type: "agent_version", id: versionId },
        action: "agent_version.update",
        result: "allowed",
        correlationId,
      });
      return json({ agent });
    } catch (caught) {
      return versionErrorOrRethrow(caught, correlationId);
    }
  }

  if (request.method !== "PUT") return methodNotAllowed();
  if (!canManage) {
    return denyManagement("agent.publication_change", {
      type: "agent",
      id: agentId,
    });
  }
  const parsed = publicationSchema.safeParse(
    await request.json().catch(() => null),
  );
  if (!parsed.success) {
    return error(
      400,
      "INVALID_AGENT_PUBLICATION",
      "La publicación solicitada no es válida.",
      correlationId,
    );
  }
  try {
    const agent = await repository.setPublication(organizationId, agentId, {
      expectedVersion: parsed.data.expectedVersion,
      versionId: parsed.data.versionId,
      reason: parsed.data.reason,
      actorId: context.user.id,
      correlationId,
    });
    if (agent === null) return conflict();
    await repository.recordAudit({
      organizationId,
      actorId: context.user.id,
      resource: { type: "agent", id: agentId },
      action: "agent.publication_change",
      result: "allowed",
      correlationId,
    });
    return json({ agent });
  } catch (caught) {
    return versionErrorOrRethrow(caught, correlationId);
  }
}

function nameConflictOrRethrow(caught: unknown, correlationId: string): Response {
  if (caught instanceof DuplicateAgentNameError) {
    return error(
      409,
      "AGENT_NAME_TAKEN",
      "Ya existe un agente con ese nombre.",
      correlationId,
    );
  }
  throw caught;
}

/**
 * Una revisión ajena responde `404` como cualquier recurso de otra
 * organización; que ya no sea editable o que la publicación no cambie nada son
 * conflictos de estado, no de permisos.
 */
function versionErrorOrRethrow(caught: unknown, correlationId: string): Response {
  if (caught instanceof AgentVersionNotInOrganizationError) {
    return error(
      404,
      "NOT_FOUND",
      "La versión solicitada no existe.",
      correlationId,
    );
  }
  if (caught instanceof AgentVersionNotEditableError) {
    return error(
      409,
      "AGENT_VERSION_NOT_EDITABLE",
      "La versión ya se publicó y su contenido no puede cambiar.",
      correlationId,
    );
  }
  if (caught instanceof AgentPublicationUnchangedError) {
    return error(
      409,
      "AGENT_PUBLICATION_UNCHANGED",
      "El agente ya está publicado así.",
      correlationId,
    );
  }
  throw caught;
}
