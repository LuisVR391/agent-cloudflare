import { routeAgentRequest } from "agents";

import {
  error,
  logSecurityRejection,
  resolveAuthorizationContext,
  routeAuthRequest,
} from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import { AuthorizationRepository } from "./repositories/auth/authorization-repository";

export { CustomerSupportAgent } from "./customer-support-agent";

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);
    const workerEnv = env as WorkerEnv;

    if (url.pathname === "/api/health") {
      return new Response(
        JSON.stringify({
          ok: true,
          service: "agent-cloudflare",
          runtime: "cloudflare-workers",
        }),
        { headers: jsonHeaders },
      );
    }

    const authResponse = await routeAuthRequest(request, workerEnv);
    if (authResponse) {
      return authResponse;
    }

    if (url.pathname.startsWith("/api/")) {
      return new Response(
        JSON.stringify({
          error: {
            code: "NOT_FOUND",
            message: "La ruta solicitada no existe.",
            correlationId:
              request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
          },
        }),
        { status: 404, headers: jsonHeaders },
      );
    }

    if (url.pathname.startsWith("/agents/")) {
      const correlationId =
        request.headers.get("x-correlation-id") ?? crypto.randomUUID();
      const authorization = await resolveAuthorizationContext(request, workerEnv);
      if (!authorization.authorized) {
        logSecurityRejection(
          "conversation.agent.access",
          authorization.code.toLowerCase(),
          correlationId,
        );
        return error(
          authorization.status,
          authorization.code,
          authorization.message,
          correlationId,
        );
      }

      const { context } = authorization;
      if (
        !context.activeOrganization.permissions.includes("conversations.manage")
      ) {
        const repository = new AuthorizationRepository(workerEnv.DB);
        await repository.writeAuthorizationRejectionAudit(
          context.user,
          context.activeOrganization.organizationId,
          "conversation.agent.access",
          "conversation_agent",
          correlationId,
        );
        return error(
          403,
          "FORBIDDEN",
          "No tienes permiso para usar el agente.",
          correlationId,
        );
      }
    }

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
