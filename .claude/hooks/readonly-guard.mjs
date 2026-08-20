// Adaptador de solo lectura. Lo registra en su propio frontmatter el subagente
// que verifica, no `.claude/settings.json`, para que la restricción se aplique
// únicamente en sus turnos y no en los del resto del ciclo. La lógica sigue
// viviendo en el núcleo neutral `.agents/guard/`.
import { runHook } from "../../.agents/guard/project-guard.mjs";

await runHook({
  agent: "claude",
  skillCommand: "/deliver-agent-cloudflare-change",
  // El rol no concede permisos: solo retira los de escritura. Un agente que
  // juzga una implementación no puede corregirla, porque dejaría de ser
  // independiente de lo que revisa.
  role: "readOnly",
});
