// Adaptador de Claude Code. La lógica vive en el núcleo neutral
// `.agents/guard/`, compartido con Codex. Este archivo solo declara cómo se
// identifica el agente y cómo se invoca el skill de entrega.
import { runHook } from "../../.agents/guard/project-guard.mjs";

await runHook({
  agent: "claude",
  skillCommand: "/deliver-agent-cloudflare-change",
});
