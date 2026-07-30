import { existsSync, readFileSync } from "node:fs";
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

const skillPath =
  ".agents/skills/deliver-agent-cloudflare-change/SKILL.md";
const metadataPath =
  ".agents/skills/deliver-agent-cloudflare-change/agents/openai.yaml";
const hookScriptPath = ".codex/hooks/project-guard.mjs";
const scenariosPath = ".codex/hooks/project-guard.scenarios.mjs";

for (const path of [
  skillPath,
  metadataPath,
  ".codex/agent-policy.json",
  ".codex/hooks.json",
  hookScriptPath,
  scenariosPath,
]) {
  requireFile(path);
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

const policy = readJson(".codex/agent-policy.json");
if (policy.version !== 1) fail(".codex/agent-policy.json: versión no soportada");
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
    fail(`.codex/agent-policy.json: ${key} debe ser una lista no vacía`);
  }
}

const config = readJson(".codex/hooks.json");
const requiredEvents = [
  "SessionStart",
  "SubagentStart",
  "UserPromptSubmit",
  "PreToolUse",
  "PostToolUse",
  "Stop",
];
for (const event of requiredEvents) {
  const groups = config.hooks?.[event];
  if (!Array.isArray(groups) || groups.length === 0) {
    fail(`.codex/hooks.json: falta ${event}`);
    continue;
  }
  for (const group of groups) {
    for (const hook of group.hooks || []) {
      if (hook.type !== "command") {
        fail(`.codex/hooks.json: ${event} usa un tipo no ejecutable`);
      }
      if (!hook.command?.includes(hookScriptPath)) {
        fail(`.codex/hooks.json: ${event} no referencia ${hookScriptPath}`);
      }
    }
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
