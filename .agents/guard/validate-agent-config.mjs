import {
  existsSync,
  lstatSync,
  readdirSync,
  readFileSync,
  realpathSync,
} from "node:fs";
import { join } from "node:path";

const root = join(import.meta.dirname, "..", "..");
const failures = [];

function fail(message) {
  failures.push(message);
}

function readJson(path) {
  try {
    return JSON.parse(readFileSync(join(root, path), "utf8"));
  } catch (error) {
    fail(`${path}: JSON inválido (${error.message})`);
    return {};
  }
}

function requireFile(path) {
  if (!existsSync(join(root, path))) fail(`${path}: archivo requerido ausente`);
}

const skillDirectory = ".agents/skills/deliver-agent-cloudflare-change";
const skillPath = `${skillDirectory}/SKILL.md`;
const metadataPath = `${skillDirectory}/agents/openai.yaml`;
const policyPath = ".agents/guard/policy.json";
const corePath = ".agents/guard/project-guard.mjs";
const scenariosPath = ".agents/guard/scenarios.mjs";
const codexAdapterPath = ".codex/hooks/project-guard.mjs";
const claudeAdapterPath = ".claude/hooks/project-guard.mjs";
const codexHooksPath = ".codex/hooks.json";
const claudeSettingsPath = ".claude/settings.json";
const claudeSkillLink = ".claude/skills/deliver-agent-cloudflare-change";
const continuityGuide = ".docs/operations/agent-continuity.md";

for (const path of [
  skillPath,
  metadataPath,
  policyPath,
  corePath,
  scenariosPath,
  codexAdapterPath,
  claudeAdapterPath,
  codexHooksPath,
  claudeSettingsPath,
  continuityGuide,
  "CLAUDE.md",
]) {
  requireFile(path);
}

// Claude Code descubre `CLAUDE.md` con ese nombre exacto. Un sistema de
// archivos sensible a mayúsculas ignora cualquier otra grafía en silencio.
const rootEntries = readdirSync(root);
for (const entry of rootEntries) {
  if (entry !== "CLAUDE.md" && entry.toLowerCase() === "claude.md") {
    fail(`${entry}: Claude Code solo carga CLAUDE.md; renombra el archivo`);
  }
}

const claudeMemory = existsSync(join(root, "CLAUDE.md"))
  ? readFileSync(join(root, "CLAUDE.md"), "utf8")
  : "";
if (!/@AGENTS\.md/.test(claudeMemory)) {
  fail("CLAUDE.md: debe importar AGENTS.md con `@AGENTS.md`");
}

// El skill vive una sola vez en `.agents/skills` y Claude Code lo alcanza por
// symlink. Una copia física volvería a separar las instrucciones de entrega.
try {
  const linkPath = join(root, claudeSkillLink);
  if (!lstatSync(linkPath).isSymbolicLink()) {
    fail(`${claudeSkillLink}: debe ser un symlink a ${skillDirectory}`);
  } else if (
    realpathSync(linkPath) !== realpathSync(join(root, skillDirectory))
  ) {
    fail(`${claudeSkillLink}: el symlink no resuelve a ${skillDirectory}`);
  }
} catch (error) {
  fail(`${claudeSkillLink}: symlink ausente o roto (${error.message})`);
}

const skill = readFileSync(join(root, skillPath), "utf8");
const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
if (!frontmatter) {
  fail(`${skillPath}: falta frontmatter YAML`);
} else {
  if (!/^name:\s*deliver-agent-cloudflare-change$/m.test(frontmatter[1])) {
    fail(`${skillPath}: name no coincide con el directorio`);
  }
  const description = frontmatter[1].match(/^description:\s*(.+)$/m)?.[1] || "";
  if (description.length < 80 || !/Úsalo|Usalo/.test(description)) {
    fail(`${skillPath}: description debe explicar alcance y disparadores`);
  }
}

const metadata = readFileSync(join(root, metadataPath), "utf8");
const shortDescription =
  metadata.match(/short_description:\s*"([^"]+)"/)?.[1] || "";
if (shortDescription.length < 25 || shortDescription.length > 64) {
  fail(`${metadataPath}: short_description debe tener entre 25 y 64 caracteres`);
}
if (!metadata.includes("$deliver-agent-cloudflare-change")) {
  fail(`${metadataPath}: default_prompt debe mencionar el skill explícitamente`);
}

const policy = readJson(policyPath);
if (policy.version !== 1) fail(`${policyPath}: versión no soportada`);
if (
  policy.pushConfirmation?.environmentVariable !== "AGENT_PUSH_CONFIRMED" ||
  policy.pushConfirmation?.value !== "1"
) {
  fail(`${policyPath}: pushConfirmation debe exigir AGENT_PUSH_CONFIRMED=1`);
}
for (const path of policy.sourcesOfTruth || []) requireFile(path);
for (const key of [
  "implementationPrefixes",
  "documentationPrefixes",
  "architecturePrefixes",
  "deliverablePrefixes",
  "migrationPrefixes",
  "blockedCommandPatterns",
  "highConfidenceSecretPatterns",
]) {
  if (!Array.isArray(policy[key]) || policy[key].length === 0) {
    fail(`${policyPath}: ${key} debe ser una lista no vacía`);
  }
}

// Ambas integraciones son entregables del repositorio y deben auditarse igual.
for (const key of ["implementationPrefixes", "deliverablePrefixes"]) {
  for (const prefix of [".claude/", ".codex/", ".agents/"]) {
    if (!(policy[key] || []).includes(prefix)) {
      fail(`${policyPath}: ${key} debe incluir ${prefix}`);
    }
  }
}

for (const mapping of policy.documentationMap || []) {
  for (const document of mapping.documents || []) requireFile(document);
}

// Cada agente registra los mismos eventos contra su propio adaptador.
const requiredEvents = [
  "SessionStart",
  "SubagentStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
];

function validateHooks(path, hooks, adapterPath) {
  for (const event of requiredEvents) {
    const groups = hooks?.[event];
    if (!Array.isArray(groups) || groups.length === 0) {
      fail(`${path}: falta ${event}`);
      continue;
    }
    for (const group of groups) {
      for (const hook of group.hooks || []) {
        if (hook.type !== "command") {
          fail(`${path}: ${event} usa un tipo no ejecutable`);
        }
        const invocation = [hook.command, ...(hook.args || [])].join(" ");
        if (!invocation.includes(adapterPath)) {
          fail(`${path}: ${event} no referencia ${adapterPath}`);
        }
      }
    }
  }
}

validateHooks(codexHooksPath, readJson(codexHooksPath).hooks, codexAdapterPath);

const claudeSettings = readJson(claudeSettingsPath);
validateHooks(claudeSettingsPath, claudeSettings.hooks, claudeAdapterPath);

// Los hooks fallan abiertos por diseño. Las deny rules son el respaldo
// determinista y la única capa que cubre las referencias `@archivo`.
const denyRules = claudeSettings.permissions?.deny || [];
for (const rule of ["Read(./.dev.vars)", "Read(./.env)"]) {
  if (!denyRules.includes(rule)) {
    fail(`${claudeSettingsPath}: permissions.deny debe incluir ${rule}`);
  }
}
if (!denyRules.some((rule) => /deploy/i.test(rule))) {
  fail(
    `${claudeSettingsPath}: permissions.deny debe bloquear un despliegue directo`,
  );
}

// Los adaptadores solo declaran identidad; la lógica pertenece al núcleo.
for (const adapter of [codexAdapterPath, claudeAdapterPath]) {
  if (!existsSync(join(root, adapter))) continue;
  const source = readFileSync(join(root, adapter), "utf8");
  if (!source.includes("runHook") || !source.includes("project-guard.mjs")) {
    fail(`${adapter}: debe delegar en runHook del núcleo compartido`);
  }
}

if (
  process.env.GITHUB_EVENT_NAME?.startsWith("pull_request") &&
  process.env.GITHUB_EVENT_PATH
) {
  try {
    const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
    const body = event.pull_request?.body || "";
    const headings = ["Documentación", "ADR", "Roadmap", "Validación"];
    for (const [index, heading] of headings.entries()) {
      const next = headings[index + 1];
      const expression = new RegExp(
        `^##\\s+${heading}\\s*$([\\s\\S]*?)${next ? `(?=^##\\s+${next}\\s*$)` : "(?![\\s\\S])"}`,
        "im",
      );
      const content = body.match(expression)?.[1]
        ?.replace(/<!--[\s\S]*?-->/g, "")
        .trim();
      if (!content) fail(`PR: la sección ${heading} falta o está vacía`);
    }
  } catch (error) {
    fail(`PR: no se pudo validar el evento (${error.message})`);
  }
}

if (failures.length > 0) {
  console.error(failures.map((message) => `- ${message}`).join("\n"));
  process.exit(1);
}

console.log("Agent workflow configuration is valid.");
