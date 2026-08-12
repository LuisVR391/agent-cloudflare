import { getAgentByName } from "agents";
import { z } from "zod";
import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import type { CustomerSupportAgent } from "./customer-support-agent";
import type { OutboundQueueMessage } from "./integrations/zernio/contracts";
import { ConversationRepository } from "./repositories/conversation-repository";

type ConversationEnv = WorkerEnv & {
  CustomerSupportAgent: DurableObjectNamespace<CustomerSupportAgent>;
  OUTBOUND_MESSAGES: Queue<OutboundQueueMessage>;
  MEDIA_BUCKET: R2Bucket;
};
const updateSchema = z.object({
  expectedVersion: z.number().int().positive(),
  status: z.enum(["open", "resolved"]).optional(),
  attentionMode: z.enum(["human", "paused"]).optional(),
}).refine((value) => value.status !== undefined || value.attentionMode !== undefined);
const sendSchema = z.object({
  clientRequestId: z.uuid(),
  text: z.string().trim().min(1).max(65_536),
});

function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

function parseLimit(value: string | null, fallback: number): number | null {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 100) : null;
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
    const pageLimit = parseLimit(url.searchParams.get("limit"), 30);
    if (!pageLimit) return error(400, "INVALID_LIMIT", "El límite solicitado no es válido.", correlationId);
    const conversations = await repository.list(organizationId, {
      status: status ?? undefined, limit: pageLimit,
      cursor: url.searchParams.get("cursor") ?? undefined,
    });
    return json({ conversations, nextCursor: conversations.at(-1)?.lastMessageAt ?? null });
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
    const messages = await repository.listMessages(organizationId, conversationId, {
      limit: pageLimit, cursor: url.searchParams.get("cursor") ?? undefined,
    });
    return json({ conversation, messages, nextCursor: messages.at(0)?.occurredAt ?? null });
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
    const updated = await repository.updateState({
      organizationId, conversationId, actorId: context.user.id, correlationId, ...parsed.data,
    });
    if (!updated) return error(409, "CONVERSATION_VERSION_CONFLICT", "La conversación cambió; vuelve a cargarla.", correlationId);
    const agent = await getAgentByName(env.CustomerSupportAgent, `${organizationId}:${conversationId}`);
    if (parsed.data.attentionMode) await agent.updateAttentionMode(parsed.data.attentionMode);
    return json({ conversation: updated });
  }
  return error(405, "METHOD_NOT_ALLOWED", "El método solicitado no está permitido.", correlationId);
}
