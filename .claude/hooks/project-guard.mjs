// Adaptador de Claude Code. La lógica vive en el núcleo neutral
// `.agents/guard/`, compartido con Codex.
import { runHook } from "../../.agents/guard/project-guard.mjs";

await runHook({
  agent: "claude",
  // Claude Code puede pedir una decisión al usuario dentro del turno, así que
  // un bloqueo autorizable se resuelve preguntando en vez de interrumpir la
  // entrega. Los adaptadores sin esa capacidad omiten el campo.
  inlineApprovalTool: "AskUserQuestion",
});
