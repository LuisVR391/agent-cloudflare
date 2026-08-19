import { getAgentByName } from "agents";
import { z } from "zod";
import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import type { CustomerSupportAgent } from "./customer-support-agent";
import { encodeCursor, json, parseCursor, parseLimit } from "./http/api-helpers";
import type { OutboundQueueMessage } from "./integrations/zernio/contracts";
import {
  ConversationRepository,
  type AssigneeFilter,
} from "./repositories/conversation-repository";
import {
  AgentNotRunnableError,
  MembershipNotActiveInOrganizationError,
} from "./domain/errors";
import type { ConversationSummary } from "./domain/types";

type ConversationEnv = WorkerEnv & {
  CustomerSupportAgent: DurableObjectNamespace<CustomerSupportAgent>;
  OUTBOUND_MESSAGES: Queue<OutboundQueueMessage>;
  MEDIA_BUCKET: R2Bucket;
};
const updateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: z.enum(["open", "resolved"]).optional(),
  // `supervised` sigue reservado por el contrato aceptado: el modo existe en el
  // esquema desde Fase 1, pero nada prepara todavía un borrador que aprobar.
  attentionMode: z.enum(["automatic", "human", "paused"]).optional(),
  // Ausente conserva el responsable; `null` lo retira. Campo nuevo y opcional:
  // un cliente que no lo envía sigue viendo el mismo contrato.
  assigneeMembershipId: z.uuid().nullable().optional(),
  // Qué agente atiende la conversación. Ausente lo conserva; `null` lo retira.
  agentId: z.uuid().nullable().optional(),
}).refine((value) => value.status !== undefined || value.attentionMode !== undefined
  || value.assigneeMembershipId !== undefined || value.agentId !== undefined);
const sendSchema = z.object({
  clientRequestId: z.uuid(),
  text: z.string().trim().min(1).max(65_536),
});

const UUID_PATTERN =
  /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/**
 * `me` lo resuelve el backend con la membresía de la sesión: el cliente no
 * necesita conocer su identificador para filtrar lo suyo. Cualquier otro valor
 * que no sea `unassigned` ni un identificador con forma válida se rechaza
 * antes de tocar SQL.
 */
function parseAssigneeFilter(
  value: string | null,
  membershipId: string,
): { filter?: AssigneeFilter } | null {
  if (value === null) return { filter: undefined };
  if (value === "me") return { filter: { kind: "membership", membershipId } };
  if (value === "unassigned") return { filter: { kind: "unassigned" } };
  return UUID_PATTERN.test(value)
    ? { filter: { kind: "membership", membershipId: value } }
    : null;
}

export async function routeConversationApi(
  request: Request,
  env: ConversationEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/conversations")) return null;
  const correlationId = request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await resolveAuthorizationContext(request, env);
  if (!authorization.authorized) {
    return error(authorization.status, authorization.code, authorization.message, correlationId);
  }
  const { context } = authorization;
  const organizationId = context.activeOrganization.organizationId;
  const permissions = context.activeOrganization.permissions;
  const repository = new ConversationRepository(env.DB);
  const suffix = url.pathname.slice("/api/conversations".length);

  if (request.method === "GET" && (suffix === "" || suffix === "/")) {
    if (!permissions.includes("conversations.read")) return error(403, "FORBIDDEN", "No tienes permiso para consultar conversaciones.", correlationId);
    const status = url.searchParams.get("status");
    if (status !== null && status !== "open" && status !== "resolved") {
      return error(400, "INVALID_STATUS", "El estado solicitado no es válido.", correlationId);
    }
    const assignee = parseAssigneeFilter(
      url.searchParams.get("assignee"),
      context.activeOrganization.membershipId,
    );
    if (assignee === null) {
      return error(400, "INVALID_ASSIGNEE_FILTER", "El responsable solicitado no es válido.", correlationId);
    }
    const pageLimit = parseLimit(url.searchParams.get("limit"), 30);
    if (!pageLimit) return error(400, "INVALID_LIMIT", "El límite solicitado no es válido.", correlationId);
    const page = parseCursor(url.searchParams.get("cursor"));
    if (!page) return error(400, "INVALID_CURSOR", "El cursor solicitado no es válido.", correlationId);
    const result = await repository.list(organizationId, {
      status: status ?? undefined, assignee: assignee.filter,
      limit: pageLimit, cursor: page.cursor,
    });
    return json({
      conversations: result.conversations,
      nextCursor: encodeCursor(result.nextCursor),
    });
  }

  const attachmentMatch = suffix.match(/^\/([^/]+)\/attachments\/([^/]+)$/);
  if (attachmentMatch && request.method === "GET") {
    if (!permissions.includes("conversations.read")) return error(403, "FORBIDDEN", "No tienes permiso para consultar conversaciones.", correlationId);
    // El identificador del adjunto contiene `:`, que la interfaz codifica al
    // construir el enlace. Sin decodificarlo, la búsqueda usa el literal
    // escapado y ningún adjunto conservado llega a encontrarse.
    let attachmentId: string;
    try {
      attachmentId = decodeURIComponent(attachmentMatch[2]);
    } catch {
      return error(400, "INVALID_ATTACHMENT_ID", "El adjunto solicitado no es válido.", correlationId);
    }
    const row = await env.DB.prepare(`SELECT a.r2_key, a.content_type, a.status,
      a.failure_reason
      FROM message_attachments a JOIN messages m
        ON m.organization_id = a.organization_id AND m.id = a.message_id
      WHERE a.organization_id = ? AND m.conversation_id = ? AND a.id = ?`)
      .bind(organizationId, decodeURIComponent(attachmentMatch[1]), attachmentId)
      .first<{
        r2_key: string | null; content_type: string | null;
        status: string; failure_reason: string | null;
      }>();
    if (!row) return error(404, "NOT_FOUND", "El adjunto solicitado no existe.", correlationId);
    // El adjunto existe pero no se conservó: distinguirlo de un identificador
    // inexistente evita diagnosticar como pérdida de datos lo que el canal
    // rechazó o ya no puede servir.
    if (row.status !== "stored" || !row.r2_key) {
      return error(
        409,
        row.failure_reason ?? "ATTACHMENT_NOT_STORED",
        "El adjunto no pudo conservarse desde el canal.",
        correlationId,
      );
    }
    const object = await env.MEDIA_BUCKET.get(row.r2_key);
    if (!object) return error(404, "NOT_FOUND", "El adjunto solicitado no existe.", correlationId);
    return new Response(object.body, {
      headers: {
        "Cache-Control": "private, no-store",
        "Content-Type": row.content_type ?? "application/octet-stream",
        "X-Content-Type-Options": "nosniff",
      },
    });
  }

  const match = suffix.match(/^\/([^/]+)(?:\/(messages|live))?$/);
  if (!match) return error(404, "NOT_FOUND", "La conversación solicitada no existe.", correlationId);
  const conversationId = match[1];
  const action = match[2];
  const conversation = await repository.find(organizationId, conversationId);
  if (!conversation) return error(404, "NOT_FOUND", "La conversación solicitada no existe.", correlationId);

  if (request.method === "GET" && action === "messages") {
    if (!permissions.includes("conversations.read")) return error(403, "FORBIDDEN", "No tienes permiso para consultar conversaciones.", correlationId);
    const pageLimit = parseLimit(url.searchParams.get("limit"), 50);
    if (!pageLimit) return error(400, "INVALID_LIMIT", "El límite solicitado no es válido.", correlationId);
    const page = parseCursor(url.searchParams.get("cursor"));
    if (!page) return error(400, "INVALID_CURSOR", "El cursor solicitado no es válido.", correlationId);
    const result = await repository.listMessages(organizationId, conversationId, {
      limit: pageLimit, cursor: page.cursor,
    });
    return json({
      conversation,
      messages: result.messages,
      nextCursor: encodeCursor(result.nextCursor),
    });
  }
  if (request.method === "GET" && action === "live") {
    if (!permissions.includes("conversations.read")) return error(403, "FORBIDDEN", "No tienes permiso para consultar conversaciones.", correlationId);
    const agent = await getAgentByName(env.CustomerSupportAgent, `${organizationId}:${conversationId}`);
    return agent.fetch(request);
  }
  if (request.method === "POST" && action === "messages") {
    if (!permissions.includes("conversations.manage")) {
      return error(
        403,
        "FORBIDDEN",
        "No tienes permiso para responder conversaciones.",
        correlationId,
      );
    }
    if (conversation.status !== "open" || conversation.attentionMode !== "human") {
      return error(
        409,
        "CONVERSATION_NOT_IN_HUMAN_MODE",
        "Reabre la conversación y toma control antes de responder.",
        correlationId,
      );
    }
    const parsed = sendSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) {
      return error(
        400,
        "INVALID_MESSAGE",
        "El mensaje no es válido.",
        correlationId,
      );
    }
    let outgoing: Awaited<ReturnType<ConversationRepository["createOutgoing"]>>;
    try {
      outgoing = await repository.createOutgoing({
        organizationId,
        conversationId,
        actorId: context.user.id,
        clientRequestId: parsed.data.clientRequestId,
        text: parsed.data.text,
        correlationId,
      });
    } catch (caught) {
      if (caught instanceof Error && caught.message === "IDEMPOTENCY_KEY_REUSED") {
        return error(
          409,
          "IDEMPOTENCY_KEY_REUSED",
          "La operación ya existe con otro contenido.",
          correlationId,
        );
      }
      throw caught;
    }

    if (!outgoing.created) {
      const canRetryEnqueue =
        outgoing.deliveryStatus === "failed" &&
        outgoing.lastErrorCode === "QUEUE_ENQUEUE_FAILED" &&
        await repository.prepareEnqueueRetry(organizationId, outgoing.messageId);
      if (!canRetryEnqueue) {
        const responseStatus = outgoing.messageStatus === "queued" ? 202 : 200;
        return json({
          messageId: outgoing.messageId,
          status: outgoing.messageStatus,
          correlationId: outgoing.correlationId,
        }, responseStatus);
      }
    }

    try {
      await env.OUTBOUND_MESSAGES.send({
        kind: "sendTextMessage",
        organizationId,
        conversationId,
        messageId: outgoing.messageId,
        correlationId: outgoing.correlationId,
      }, { contentType: "json" });
    } catch {
      await repository.markEnqueueFailed(organizationId, outgoing.messageId);
      await repository.recordHumanSendAudit({
        organizationId,
        actorId: context.user.id,
        messageId: outgoing.messageId,
        result: "failed",
        correlationId: outgoing.correlationId,
      });
      return error(
        503,
        "OUTBOUND_QUEUE_UNAVAILABLE",
        "No fue posible encolar la respuesta. Intenta nuevamente.",
        outgoing.correlationId,
      );
    }

    await repository.recordHumanSendAudit({
      organizationId,
      actorId: context.user.id,
      messageId: outgoing.messageId,
      result: "allowed",
      correlationId: outgoing.correlationId,
    });
    return json({
      messageId: outgoing.messageId,
      status: "queued",
      correlationId: outgoing.correlationId,
    }, 202);
  }
  if (request.method === "PATCH" && action === undefined) {
    if (!permissions.includes("conversations.manage")) return error(403, "FORBIDDEN", "No tienes permiso para gestionar conversaciones.", correlationId);
    const parsed = updateSchema.safeParse(await request.json().catch(() => null));
    if (!parsed.success) return error(400, "INVALID_CONVERSATION_UPDATE", "El cambio solicitado no es válido.", correlationId);
    let updated: ConversationSummary | null;
    try {
      updated = await repository.updateState({
        organizationId, conversationId, actorId: context.user.id, correlationId, ...parsed.data,
      });
    } catch (caught) {
      // Inexistente, revocada o de otra organización se confunden a propósito:
      // distinguirlas revelaría a quién pertenece un identificador ajeno.
      if (caught instanceof MembershipNotActiveInOrganizationError) {
        return error(400, "INVALID_ASSIGNEE", "El responsable indicado no pertenece al equipo activo.", correlationId);
      }
      // Inexistente, archivado, sin versión publicada o de otra organización se
      // confunden igual: ninguno puede responder, y distinguirlos revelaría qué
      // identificador ajeno existe.
      if (caught instanceof AgentNotRunnableError) {
        return error(409, "AGENT_NOT_RUNNABLE", "Elige un agente activo con una versión publicada.", correlationId);
      }
      throw caught;
    }
    if (!updated) return error(409, "CONVERSATION_VERSION_CONFLICT", "La conversación cambió; vuelve a cargarla.", correlationId);
    const agent = await getAgentByName(env.CustomerSupportAgent, `${organizationId}:${conversationId}`);
    if (parsed.data.attentionMode) await agent.updateAttentionMode(parsed.data.attentionMode);
    return json({ conversation: updated });
  }
  return error(405, "METHOD_NOT_ALLOWED", "El método solicitado no está permitido.", correlationId);
}
