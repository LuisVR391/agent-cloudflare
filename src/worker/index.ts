import { routeAgentRequest } from "agents";

import {
  error,
  logSecurityRejection,
  resolveAuthorizationContext,
  routeAuthRequest,
} from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import type { InboundQueueMessage, OutboundQueueMessage } from "./integrations/zernio/contracts";
import { handleInboundQueue } from "./integrations/zernio/inbound-queue";
import { handleOutboundQueue } from "./integrations/zernio/outbound-queue";
import { handleZernioWebhook } from "./integrations/zernio/webhook";
import { routeAgentApi } from "./agent-api";
import { routeAppointmentApi } from "./appointment-api";
import { routeContactApi } from "./contact-api";
import { routeConversationApi } from "./conversation-api";
import { routeMetricsApi } from "./metrics-api";
import { routeNoteApi } from "./note-api";
import { routeOpportunityApi } from "./opportunity-api";
import { routeOrganizationApi } from "./organization-api";
import { routePipelineApi } from "./pipeline-api";
import { routeServiceApi } from "./service-api";
import { routeTaskApi } from "./task-api";
import { routeTeamApi } from "./team-api";
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

    if (url.pathname === "/webhooks/zernio") {
      return handleZernioWebhook(request, env);
    }

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

    const conversationResponse = await routeConversationApi(request, env as never);
    if (conversationResponse) return conversationResponse;

    const contactResponse = await routeContactApi(request, workerEnv);
    if (contactResponse) return contactResponse;

    const serviceResponse = await routeServiceApi(request, workerEnv);
    if (serviceResponse) return serviceResponse;

    const pipelineResponse = await routePipelineApi(request, workerEnv);
    if (pipelineResponse) return pipelineResponse;

    const opportunityResponse = await routeOpportunityApi(request, workerEnv);
    if (opportunityResponse) return opportunityResponse;

    const noteResponse = await routeNoteApi(request, workerEnv);
    if (noteResponse) return noteResponse;

    const taskResponse = await routeTaskApi(request, workerEnv);
    if (taskResponse) return taskResponse;

    const appointmentResponse = await routeAppointmentApi(request, workerEnv);
    if (appointmentResponse) return appointmentResponse;

    const agentConfigurationResponse = await routeAgentApi(request, workerEnv);
    if (agentConfigurationResponse) return agentConfigurationResponse;

    const metricsResponse = await routeMetricsApi(request, workerEnv);
    if (metricsResponse) return metricsResponse;

    const organizationResponse = await routeOrganizationApi(request, workerEnv);
    if (organizationResponse) return organizationResponse;

    const teamResponse = await routeTeamApi(request, workerEnv);
    if (teamResponse) return teamResponse;

    // Utillaje de desarrollo. La importación es dinámica y vive dentro del
    // guard para que el artefacto construido no contenga la ruta:
    // `scripts/validate-staging-build.mjs` comprueba esa ausencia.
    if (import.meta.env.DEV) {
      const { routeDevFixtureApi } = await import("./dev/inbound-fixture");
      const fixtureResponse = await routeDevFixtureApi(request, env as never);
      if (fixtureResponse) return fixtureResponse;
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
      const instanceName = url.pathname.split("/").filter(Boolean).at(-1);
      if (instanceName !== "demo") {
        return error(
          404,
          "NOT_FOUND",
          "La instancia solicitada no está expuesta directamente.",
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

  async queue(batch, env): Promise<void> {
    if (batch.queue.includes("outbound")) {
      await handleOutboundQueue(batch as MessageBatch<OutboundQueueMessage>, env);
      return;
    }
    await handleInboundQueue(batch as MessageBatch<InboundQueueMessage>, env);
  },
} satisfies ExportedHandler<Env, InboundQueueMessage | OutboundQueueMessage>;
