import { execFileSync } from "node:child_process";
import { readFileSync, mkdirSync, writeFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = join(scriptDirectory, "..", "..");
const defaultPolicyPath = join(repositoryRoot, ".agents", "guard", "policy.json");

// Herramientas de edición por agente. Codex entrega el parche completo en
// `tool_input.command`; Claude Code entrega una ruta absoluta en
// `tool_input.file_path`. El núcleo normaliza ambas formas.
const patchTools = new Set(["apply_patch"]);
const fileTools = new Set(["Edit", "Write"]);

export function loadPolicy(path = defaultPolicyPath) {
  return JSON.parse(readFileSync(path, "utf8"));
}

function matchesAny(value, patterns = []) {
  return patterns.some((pattern) => new RegExp(pattern, "i").test(value));
}

function normalizePath(path) {
  return path.replaceAll("\\", "/").replace(/^\.\//, "");
}

// Claude Code exige rutas absolutas en Edit y Write. La política razona sobre
// rutas relativas al repositorio, así que se recortan contra el directorio de
// trabajo y la raíz antes de evaluar cualquier prefijo.
function toRepositoryPath(path, cwd = repositoryRoot) {
  const normalized = normalizePath(String(path || ""));
  if (!normalized.startsWith("/")) return normalized;
  for (const root of [normalizePath(cwd), normalizePath(repositoryRoot)]) {
    if (!root) continue;
    const prefix = root.endsWith("/") ? root : `${root}/`;
    if (normalized.startsWith(prefix)) return normalized.slice(prefix.length);
  }
  return normalized;
}

function isUnder(path, prefixes = []) {
  const normalized = normalizePath(path);
  return prefixes.some(
    (prefix) => normalized === prefix || normalized.startsWith(prefix),
  );
}

function isSensitivePath(path, policy) {
  const normalized = normalizePath(path);
  if (matchesAny(normalized, policy.sensitivePathAllowPatterns)) return false;
  return matchesAny(normalized, policy.sensitivePathPatterns);
}

function denyPreToolUse(reason) {
  return {
    hookSpecificOutput: {
      hookEventName: "PreToolUse",
      permissionDecision: "deny",
      permissionDecisionReason: reason,
    },
  };
}

// Un bloqueo autorizable espera una decisión humana, no el final de la entrega.
// Cuando el adaptador declara una herramienta de pregunta en línea, el motivo
// indica cómo pedirla sin abandonar el turno. Las prohibiciones permanentes
// —force push, reset destructivo, migración ya aplicada— nunca la reciben:
// preguntar por ellas sugeriría que existe una autorización que las habilite.
function denyAuthorizable(reason, runtime) {
  const tool = runtime?.inlineApprovalTool;
  if (!tool) return denyPreToolUse(reason);
  return denyPreToolUse(
    `${reason} Solicita esa autorización con ${tool} en este mismo turno, indicando entorno y artefacto, y continúa según lo que el usuario apruebe; no termines la entrega para pedirla.`,
  );
}

function addContext(eventName, additionalContext) {
  return {
    hookSpecificOutput: {
      hookEventName: eventName,
      additionalContext,
    },
  };
}

function runGit(args, cwd = repositoryRoot) {
  try {
    return execFileSync("git", args, {
      cwd,
      encoding: "utf8",
      stdio: ["ignore", "pipe", "ignore"],
    }).trim();
  } catch {
    return "";
  }
}

function parseNameStatus(output) {
  if (!output) return [];
  return output
    .split("\n")
    .map((line) => line.trim())
    .filter(Boolean)
    .map((line) => {
      const [status, ...rawPaths] = line.split(/\s+/);
      return {
        status,
        paths: rawPaths.map(normalizePath),
      };
    });
}

function collectAuditChanges(cwd, command, gitRunner = runGit) {
  const outputs = [];
  if (/\bgit\s+commit\b/i.test(command)) {
    outputs.push(gitRunner(["diff", "--cached", "--name-status"], cwd));
  } else {
    outputs.push(gitRunner(["diff", "--name-status"], cwd));
    outputs.push(gitRunner(["diff", "--cached", "--name-status"], cwd));
    outputs.push(
      gitRunner(["diff", "--name-status", "origin/main...HEAD"], cwd),
    );
  }

  const unique = new Map();
  for (const item of outputs.flatMap(parseNameStatus)) {
    unique.set(`${item.status}:${item.paths.join(":")}`, item);
  }
  return [...unique.values()];
}

function auditText(cwd, command, gitRunner = runGit) {
  const messages = gitRunner(
    ["log", "--format=%B", "origin/main..HEAD"],
    cwd,
  );
  return `${command}\n${messages}`;
}

function hasExplicitJustification(text, label) {
  const expression = new RegExp(
    `${label}:\\s*no aplica\\s*[—-]\\s*\\S.{7,}`,
    "i",
  );
  return expression.test(text);
}

function isGitPush(command) {
  return /(^|[;&|]\s*|\s)git\s+push\b/i.test(command);
}

function hasPushConfirmation(command, policy) {
  const variable = policy.pushConfirmation?.environmentVariable;
  const value = policy.pushConfirmation?.value;
  if (!variable || !value) return false;
  const expression = new RegExp(
    `(^|[;&|]\\s*|\\s)(?:env\\s+)?${variable}=${value}\\s+git\\s+push\\b`,
    "i",
  );
  return expression.test(command);
}

// Una regla bloqueada puede declarar la marca que la libera. A diferencia de
// `hasPushConfirmation`, la marca no necesita preceder a un comando concreto:
// un despliegue se invoca tanto por script de npm como por wrangler directo.
function hasRuleConfirmation(command, confirmation) {
  const variable = confirmation?.environmentVariable;
  const value = confirmation?.value;
  if (!variable || !value) return false;
  const expression = new RegExp(
    `(^|[;&|]\\s*|\\s)(?:env\\s+)?${variable}=${value}(?=\\s)`,
    "i",
  );
  return expression.test(command);
}

function extractPatchOperations(patch, cwd = repositoryRoot) {
  const operations = [];
  const regex = /^\*\*\* (Add|Update|Delete) File: (.+)$/gm;
  for (const match of patch.matchAll(regex)) {
    operations.push({
      action: match[1],
      path: toRepositoryPath(match[2].trim(), cwd),
    });
  }
  return operations;
}

function isFileTool(toolName) {
  return patchTools.has(toolName) || fileTools.has(toolName);
}

// Devuelve operaciones `{ action, path }` sin importar qué agente las produjo.
// `Edit` y `Write` se tratan como `Update`: la comprobación de seguimiento en
// git decide después si la ruta ya estaba versionada.
function toolOperations(input, cwd = repositoryRoot) {
  const toolName = input.tool_name || "";
  const toolInput = input.tool_input || {};
  if (patchTools.has(toolName)) {
    return extractPatchOperations(String(toolInput.command || ""), cwd);
  }
  if (fileTools.has(toolName)) {
    const path = toolInput.file_path;
    if (!path) return [];
    return [{ action: "Update", path: toRepositoryPath(path, cwd) }];
  }
  return [];
}

function isTracked(path, cwd, gitRunner = runGit) {
  return Boolean(
    gitRunner(["ls-files", "--error-unmatch", "--", path], cwd),
  );
}

function migrationViolationFromOperations(
  operations,
  cwd,
  policy,
  gitRunner = runGit,
) {
  for (const operation of operations) {
    if (!isUnder(operation.path, policy.migrationPrefixes)) continue;
    if (
      operation.action !== "Add" &&
      isTracked(operation.path, cwd, gitRunner)
    ) {
      return operation.path;
    }
  }
  return null;
}

function migrationViolationFromChanges(changes, policy) {
  for (const change of changes) {
    for (const path of change.paths) {
      if (!isUnder(path, policy.migrationPrefixes)) continue;
      if (!change.status.startsWith("A")) return path;
    }
  }
  return null;
}

function documentationReminder(paths, policy) {
  const suggestions = new Set();
  for (const path of paths) {
    for (const mapping of policy.documentationMap) {
      if (isUnder(path, [mapping.prefix])) {
        mapping.documents.forEach((document) => suggestions.add(document));
      }
    }
  }
  if (suggestions.size === 0) return null;
  return `Este cambio puede afectar documentación. Revisa: ${[...suggestions].join(", ")}. Declara Documentación, ADR, Roadmap y Validación al cerrar.`;
}

function safeMarkerPart(value, fallback) {
  return String(value || fallback).replace(/[^A-Za-z0-9_-]/g, "_");
}

// Codex identifica el turno con `turn_id`; Claude Code lo hace con `prompt_id`.
// Si ninguno está disponible, la deduplicación degrada a una vez por sesión.
function stateMarker(input, kind, runtime = {}) {
  const agent = safeMarkerPart(runtime.agent, "agent");
  const session = safeMarkerPart(input.session_id, "session");
  const turn = safeMarkerPart(input.turn_id || input.prompt_id, "turn");
  return join(
    tmpdir(),
    "agent-cloudflare-agent-hooks",
    `${agent}-${session}-${turn}-${kind}`,
  );
}

function markOnce(input, kind, runtime = {}) {
  try {
    const marker = stateMarker(input, kind, runtime);
    if (existsSync(marker)) return false;
    mkdirSync(dirname(marker), { recursive: true });
    writeFileSync(marker, "", { flag: "wx" });
    return true;
  } catch {
    return true;
  }
}

function handleSessionStart(input, policy, runtime = {}) {
  const sourceList = policy.sourcesOfTruth.join(", ");
  const skill = runtime.skillCommand || "deliver-agent-cloudflare-change";
  return addContext(
    "SessionStart",
    `Repositorio Agent Cloudflare: lee ${sourceList}. Confirma fase, dependencias, seguridad, pruebas y efecto en Documentación/ADR/Roadmap antes de entregar. Usa ${skill} para cambios del repositorio.`,
  );
}

function handleSubagentStart(input, policy) {
  return addContext(
    "SubagentStart",
    `Antes de trabajar, lee AGENTS.md y la documentación relevante. Respeta la fase activa, fuentes de verdad, aislamiento, migraciones inmutables y entrega evidencia de pruebas y documentación. Fuentes base: ${policy.sourcesOfTruth.join(", ")}.`,
  );
}

function handleUserPromptSubmit(input, policy) {
  const prompt = String(input.prompt || "");
  if (matchesAny(prompt, policy.highConfidenceSecretPatterns)) {
    return {
      decision: "block",
      reason:
        "El prompt parece contener un secreto de alta confianza. Retíralo, rótalo si fue real y vuelve a enviar una versión redactada.",
    };
  }
  return null;
}

function handlePreToolUse(input, policy, runtime = {}) {
  const cwd = input.cwd || repositoryRoot;
  const toolName = input.tool_name || "";
  const command = String(input.tool_input?.command || "");
  const gitRunner = runtime.runGit || runGit;

  if (isFileTool(toolName)) {
    const migration = migrationViolationFromOperations(
      toolOperations(input, cwd),
      cwd,
      policy,
      gitRunner,
    );
    if (migration) {
      return denyPreToolUse(
        `Bloqueado: ${migration} es una migración existente. Crea una migración nueva.`,
      );
    }
    return null;
  }

  for (const rule of policy.blockedCommandPatterns) {
    if (!new RegExp(rule.pattern, "i").test(command)) continue;
    if (hasRuleConfirmation(command, rule.confirmation)) continue;
    // Solo las reglas con `confirmation` admiten desbloqueo por autorización.
    return rule.confirmation
      ? denyAuthorizable(rule.message, runtime)
      : denyPreToolUse(rule.message);
  }

  if (isGitPush(command) && !hasPushConfirmation(command, policy)) {
    const variable = policy.pushConfirmation.environmentVariable;
    const value = policy.pushConfirmation.value;
    return denyAuthorizable(
      `Bloqueado: git push requiere confirmación explícita del usuario. Después de recibirla, ejecuta \`${variable}=${value} git push\` en el mismo comando.`,
      runtime,
    );
  }

  if (!/\b(git\s+commit|git\s+push|gh\s+pr\s+create)\b/i.test(command)) {
    return null;
  }

  const changes = collectAuditChanges(cwd, command, gitRunner);
  const allPaths = changes.flatMap((change) => change.paths);
  const sensitive = allPaths.find((path) => isSensitivePath(path, policy));
  if (sensitive) {
    return denyPreToolUse(
      `Bloqueado: ${sensitive} coincide con una ruta sensible y no debe publicarse.`,
    );
  }

  const migration = migrationViolationFromChanges(changes, policy);
  if (migration) {
    return denyPreToolUse(
      `Bloqueado: ${migration} modifica una migración existente. Crea una migración nueva.`,
    );
  }

  const evidence = auditText(cwd, command, gitRunner);
  const architectureChanged = allPaths.some((path) =>
    isUnder(path, policy.architecturePrefixes),
  );
  const adrChanged = allPaths.some((path) =>
    isUnder(path, [policy.adrPrefix]),
  );
  if (
    architectureChanged &&
    !adrChanged &&
    !hasExplicitJustification(evidence, "ADR")
  ) {
    return denyPreToolUse(
      "Bloqueado: el cambio arquitectónico requiere un ADR o `ADR: no aplica — <motivo concreto>`.",
    );
  }

  const deliverableChanged = allPaths.some((path) =>
    isUnder(path, policy.deliverablePrefixes),
  );
  const roadmapChanged = allPaths.includes(policy.roadmapPath);
  if (
    deliverableChanged &&
    !roadmapChanged &&
    !hasExplicitJustification(evidence, "Roadmap")
  ) {
    return denyPreToolUse(
      "Bloqueado: declara el impacto con una actualización del roadmap o `Roadmap: no aplica — <motivo concreto>`.",
    );
  }

  const implementationChanged = allPaths.some((path) =>
    isUnder(path, policy.implementationPrefixes),
  );
  const documentationChanged = allPaths.some((path) =>
    isUnder(path, policy.documentationPrefixes),
  );
  if (implementationChanged && !documentationChanged) {
    return addContext(
      "PreToolUse",
      "La auditoría encontró implementación sin documentación en el diff. Revisa el impacto y declara `Documentación: no aplica — <motivo concreto>` si corresponde.",
    );
  }

  return null;
}

function handlePostToolUse(input, policy, runtime = {}) {
  const cwd = input.cwd || repositoryRoot;
  const paths = toolOperations(input, cwd).map((operation) => operation.path);
  const reminder = documentationReminder(paths, policy);
  if (!reminder || !markOnce(input, "docs", runtime)) return null;
  return addContext("PostToolUse", reminder);
}

function handleStop(input) {
  if (input.stop_hook_active) return { continue: true };
  const message = String(input.last_assistant_message || "");
  const required = [
    /(?:^|\n)#{1,6}\s+Documentaci[oó]n\b/im,
    /(?:^|\n)#{1,6}\s+ADR\b/im,
    /(?:^|\n)#{1,6}\s+Roadmap\b/im,
    /(?:^|\n)#{1,6}\s+Validaci[oó]n\b/im,
  ];
  if (required.every((expression) => expression.test(message))) {
    return { continue: true };
  }
  return {
    decision: "block",
    reason:
      "Completa el cierre con las secciones Documentación, ADR, Roadmap y Validación. Si alguna no aplica, indica un motivo concreto. No repitas trabajo ya terminado.",
  };
}

export function handleHook(input, policy = loadPolicy(), runtime = {}) {
  switch (input.hook_event_name) {
    case "SessionStart":
      return handleSessionStart(input, policy, runtime);
    case "SubagentStart":
      return handleSubagentStart(input, policy);
    case "UserPromptSubmit":
      return handleUserPromptSubmit(input, policy);
    case "PreToolUse":
      return handlePreToolUse(input, policy, runtime);
    case "PostToolUse":
      return handlePostToolUse(input, policy, runtime);
    case "Stop":
      return handleStop(input);
    default:
      return null;
  }
}

// Punto de entrada compartido por los adaptadores de cada agente. `runtime.agent`
// solo etiqueta los marcadores de deduplicación; no cambia ninguna decisión.
export async function runHook(runtime = {}) {
  try {
    let raw = "";
    for await (const chunk of process.stdin) raw += chunk;
    const input = JSON.parse(raw || "{}");
    const output = handleHook(input, loadPolicy(), runtime);
    if (output) process.stdout.write(`${JSON.stringify(output)}\n`);
  } catch {
    // Los errores internos fallan abiertos y nunca imprimen el payload recibido.
    process.exitCode = 0;
  }
}

if (
  process.argv[1] &&
  import.meta.url === pathToFileURL(process.argv[1]).href
) {
  await runHook();
}
