import { routeAgentRequest } from "agents";

export { CustomerSupportAgent } from "./customer-support-agent";

const jsonHeaders = {
  "Cache-Control": "no-store",
  "Content-Type": "application/json; charset=utf-8",
} as const;

export default {
  async fetch(request, env): Promise<Response> {
    const url = new URL(request.url);

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

    const agentResponse = await routeAgentRequest(request, env);
    if (agentResponse) {
      return agentResponse;
    }

    return env.ASSETS.fetch(request);
  },
} satisfies ExportedHandler<Env>;
