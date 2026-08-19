import { execFileSync } from "node:child_process";
import {
  readFileSync,
  readdirSync,
  mkdirSync,
  writeFileSync,
  existsSync,
} from "node:fs";
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

// La auditoría del diff se dispara al crear un PR, y crearlo ya no pasa
// necesariamente por la CLI: `POST /repos/:owner/:repo/pulls` hace lo mismo
// desde `curl` o desde `gh api`. Sin esto, publicar por la API evitaría la
// comprobación de documentación, ADR y roadmap.
function createsPullRequest(command) {
  if (/(^|[;&|]\s*|\s)gh\s+pr\s+create\b/i.test(command)) return true;
  const targetsGitHubApi = /api\.github\.com|(^|[;&|]\s*|\s)gh\s+api\b/i.test(
    command,
  );
  const posts = /(?:-X|--request|--method)[=\s]+POST\b/i.test(command);
  return targetsGitHubApi && posts && /\/pulls\b/i.test(command);
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

// El plan activo vive fuera de git, en `.plans/<slug>/SPEC.md`. Su frontmatter
// declara la rama que lo implementa; la sesión solo recupera el que corresponde
// a la rama actual y sigue vigente. Un frontmatter con marcadores `<...>` es una
// plantilla sin rellenar y no cuenta como plan.
function readFrontmatter(source) {
  const match = source.match(/^---\n([\s\S]*?)\n---/);
  if (!match) return null;
  const fields = {};
  for (const line of match[1].split("\n")) {
    const pair = line.match(/^([A-Za-z_-]+):\s*(.*)$/);
    if (!pair) continue;
    const value = pair[2].trim().replace(/^["']|["']$/g, "");
    if (!value || /^<.*>$/.test(value)) continue;
    fields[pair[1]] = value;
  }
  return fields;
}

function activePlan(cwd, policy, gitRunner = runGit) {
  const settings = policy.planArtifacts;
  if (!settings) return null;
  const branch = gitRunner(["rev-parse", "--abbrev-ref", "HEAD"], cwd);
  if (!branch) return null;
  const root = join(cwd, settings.directory);
  let entries = [];
  try {
    entries = readdirSync(root, { withFileTypes: true });
  } catch {
    return null;
  }
  for (const entry of entries) {
    if (!entry.isDirectory()) continue;
    const specPath = join(root, entry.name, settings.specFileName);
    let fields;
    try {
      fields = readFrontmatter(readFileSync(specPath, "utf8"));
    } catch {
      continue;
    }
    if (!fields) continue;
    const estado = (fields.estado || "activo").toLowerCase();
    if (estado !== "activo") continue;
    const matchesBranch =
      fields.rama === branch ||
      (fields.slug && branch.includes(fields.slug)) ||
      entry.name === branch ||
      branch.includes(entry.name);
    if (!matchesBranch) continue;
    return {
      feature: fields.feature || entry.name,
      path: `${settings.directory}/${entry.name}/${settings.specFileName}`,
      issue: fields.issue || null,
    };
  }
  return null;
}

// El rol de solo lectura evalúa una lista de comandos permitidos, no una de
// prohibidos: cualquier binario que no esté declarado se rechaza. Es la única
// forma de garantizar que un agente de verificación no modifique lo que juzga.
function readOnlyCommandViolation(command, policy) {
  const role = policy.readOnlyRole;
  if (!role) return null;
  const text = String(command || "").trim();
  if (!text) return null;

  for (const pattern of role.blockedShellPatterns || []) {
    if (new RegExp(pattern).test(text)) {
      return "usa redirección, sustitución de comandos o escritura de archivos";
    }
  }
  for (const pattern of role.blockedArgumentPatterns || []) {
    if (new RegExp(pattern).test(text)) {
      return "incluye un argumento que escribe en disco";
    }
  }

  for (const segment of text.split(/(?:&&|\|\||[;|])/)) {
    const tokens = segment.trim().split(/\s+/).filter(Boolean);
    // Las asignaciones previas al binario no lo convierten en otro comando.
    while (tokens.length > 0 && /^[A-Za-z_][A-Za-z0-9_]*=/.test(tokens[0])) {
      tokens.shift();
    }
    if (tokens.length === 0) continue;
    const base = tokens[0].split("/").pop();
    if (!(role.allowedCommands || []).includes(base)) {
      return `ejecuta \`${base}\`, que no está en la lista de lectura`;
    }
    if (base === "git") {
      const subcommand = tokens.find(
        (token, index) => index > 0 && !token.startsWith("-"),
      );
      if (!(role.allowedGitSubcommands || []).includes(subcommand)) {
        return `ejecuta \`git ${subcommand || ""}\`, que no es un subcomando de lectura`;
      }
    }
    if (base === "npm") {
      const script = tokens[1] === "run" ? tokens[2] : null;
      if (!script || !(role.allowedNpmScripts || []).includes(script)) {
        return "ejecuta un script de npm fuera de los permitidos para verificar";
      }
    }
  }
  return null;
}

// El prompt se compara sin acentos ni mayúsculas: quien escribe deprisa no
// escribe «planificación» con tilde, y el recordatorio dejaría de aparecer justo
// cuando más sirve.
function normalizeIntent(value) {
  return String(value || "")
    .toLowerCase()
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "");
}

// Recordatorio, nunca bloqueo: el prompt sigue su camino y el agente decide.
// Un corte que ya tiene plan se continúa por el ciclo; uno que no lo tiene se
// planifica antes de escribir código.
function skillReminder(input, policy, runtime = {}) {
  const routing = policy.skillRouting;
  if (!routing) return null;
  const prompt = normalizeIntent(input.prompt);
  if (!prompt) return null;
  const wantsPlanning = matchesAny(prompt, routing.planningIntentPatterns);
  const wantsImplementation = matchesAny(
    prompt,
    routing.implementationIntentPatterns,
  );
  if (!wantsPlanning && !wantsImplementation) return null;

  const prefix = (runtime.skillCommand || "/")[0];
  const plan = activePlan(
    input.cwd || repositoryRoot,
    policy,
    runtime.runGit || runGit,
  );
  if (plan) {
    return `Esta rama ya tiene un plan aprobado en ${plan.path}. Continúa por ${prefix}${routing.cycleSkill} en vez de volver a planificar; el SPEC es el contrato del corte.`;
  }
  if (wantsPlanning) {
    return `Usa ${prefix}${routing.planningSkill} para investigar, clasificar las decisiones y escribir el SPEC antes de tocar código.`;
  }
  return `Este corte no tiene plan. Si no es un cambio trivial, pasa antes por ${prefix}${routing.planningSkill}: sin criterios de aceptación no hay forma de verificar que terminó.`;
}

function handleSessionStart(input, policy, runtime = {}) {
  const sourceList = policy.sourcesOfTruth.join(", ");
  const skill = runtime.skillCommand || "deliver-agent-cloudflare-change";
  const plan = activePlan(input.cwd || repositoryRoot, policy, runtime.runGit || runGit);
  const planLine = plan
    ? ` Esta rama tiene un plan activo: ${plan.feature} en ${plan.path}${plan.issue ? ` (issue ${plan.issue})` : ""}; léelo antes de continuar.`
    : "";
  return addContext(
    "SessionStart",
    `Repositorio Agent Cloudflare: lee ${sourceList}. Confirma fase, dependencias, seguridad, pruebas y efecto en Documentación/ADR/Roadmap antes de entregar. Usa ${skill} para cambios del repositorio.${planLine}`,
  );
}

function handleSubagentStart(input, policy) {
  return addContext(
    "SubagentStart",
    `Antes de trabajar, lee AGENTS.md y la documentación relevante. Respeta la fase activa, fuentes de verdad, aislamiento, migraciones inmutables y entrega evidencia de pruebas y documentación. Fuentes base: ${policy.sourcesOfTruth.join(", ")}.`,
  );
}

function handleUserPromptSubmit(input, policy, runtime = {}) {
  const prompt = String(input.prompt || "");
  if (matchesAny(prompt, policy.highConfidenceSecretPatterns)) {
    return {
      decision: "block",
      reason:
        "El prompt parece contener un secreto de alta confianza. Retíralo, rótalo si fue real y vuelve a enviar una versión redactada.",
    };
  }
  const reminder = skillReminder(input, policy, runtime);
  return reminder ? addContext("UserPromptSubmit", reminder) : null;
}

function handlePreToolUse(input, policy, runtime = {}) {
  const cwd = input.cwd || repositoryRoot;
  const toolName = input.tool_name || "";
  const command = String(input.tool_input?.command || "");
  const gitRunner = runtime.runGit || runGit;

  // Un agente declarado de solo lectura no escribe por ninguna vía: ni con las
  // herramientas de edición ni con un comando que redirija, borre o mueva.
  if (runtime.role === "readOnly") {
    if (isFileTool(toolName)) {
      return denyPreToolUse(
        "Bloqueado: este agente verifica y no modifica archivos. Reporta el hallazgo en vez de corregirlo.",
      );
    }
    const violation = readOnlyCommandViolation(command, policy);
    if (violation) {
      return denyPreToolUse(
        `Bloqueado: este agente verifica y no modifica el repositorio; el comando ${violation}. Usa una lectura equivalente y reporta el hallazgo.`,
      );
    }
  }

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

  if (
    !/\b(git\s+commit|git\s+push)\b/i.test(command) &&
    !createsPullRequest(command)
  ) {
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
      return handleUserPromptSubmit(input, policy, runtime);
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
