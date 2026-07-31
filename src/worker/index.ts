import { routeAgentRequest } from "agents";

import { getAuthorizationContext, routeAuthRequest } from "./auth/http";
import type { WorkerEnv } from "./auth/types";

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
      const context = await getAuthorizationContext(request, workerEnv);
      if (
        !context ||
        !context.activeOrganization.permissions.includes("conversations.manage")
      ) {
        return new Response(
          JSON.stringify({
            error: {
              code: context ? "FORBIDDEN" : "UNAUTHENTICATED",
              message: context
                ? "No tienes permiso para usar el agente."
                : "Inicia sesión para continuar.",
              correlationId:
                request.headers.get("x-correlation-id") ?? crypto.randomUUID(),
            },
          }),
          { status: context ? 403 : 401, headers: jsonHeaders },
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
