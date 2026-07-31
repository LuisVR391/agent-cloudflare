// Adaptador de Codex. La lógica vive en el núcleo neutral `.agents/guard/`
// para que Codex y Claude Code compartan una sola política y un solo set de
// pruebas. Este archivo solo declara cómo se identifica el agente.
import { runHook } from "../../.agents/guard/project-guard.mjs";

await runHook({
  agent: "codex",
  skillCommand: "$deliver-agent-cloudflare-change",
});
