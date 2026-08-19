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
const claudeReadOnlyAdapterPath = ".claude/hooks/readonly-guard.mjs";
const codexHooksPath = ".codex/hooks.json";
const claudeSettingsPath = ".claude/settings.json";
const codexConfigPath = ".codex/config.toml";
const claudeMcpPath = ".mcp.json";
const skillsLockPath = "skills-lock.json";
const continuityGuide = ".docs/operations/agent-continuity.md";

// Skills propias del repositorio y skills traídas de un origen externo. Ambas
// viven una sola vez en `.agents/skills`; la segunda lista además debe quedar
// fijada en el lockfile para que la versión sea reproducible.
const ownSkills = [
  "deliver-agent-cloudflare-change",
  "plan-agent-cloudflare-change",
  "run-agent-cloudflare-cycle",
];
const vendoredSkills = ["shadcn"];

// Servidores MCP que ambos agentes deben ofrecer. Son herramientas de
// desarrollo local, no parte del artefacto desplegado.
const sharedMcpServers = ["shadcn"];

for (const path of [
  skillPath,
  metadataPath,
  policyPath,
  corePath,
  scenariosPath,
  codexAdapterPath,
  claudeAdapterPath,
  claudeReadOnlyAdapterPath,
  codexHooksPath,
  claudeSettingsPath,
  codexConfigPath,
  claudeMcpPath,
  skillsLockPath,
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

// Cada skill vive una sola vez en `.agents/skills`, que Codex descubre, y
// Claude Code la alcanza por symlink. Una copia física volvería a separar las
// instrucciones entre ambos agentes.
for (const name of [...ownSkills, ...vendoredSkills]) {
  const directory = `.agents/skills/${name}`;
  const link = `.claude/skills/${name}`;
  requireFile(`${directory}/SKILL.md`);
  try {
    const linkPath = join(root, link);
    if (!lstatSync(linkPath).isSymbolicLink()) {
      fail(`${link}: debe ser un symlink a ${directory}`);
    } else if (
      realpathSync(linkPath) !== realpathSync(join(root, directory))
    ) {
      fail(`${link}: el symlink no resuelve a ${directory}`);
    }
  } catch (error) {
    fail(`${link}: symlink ausente o roto (${error.message})`);
  }
}

// Una skill externa sin entrada en el lockfile no se puede actualizar ni
// auditar: `npx skills update` deja de reconocerla y su versión se vuelve
// indeterminada.
const skillsLock = readJson(skillsLockPath);
for (const name of vendoredSkills) {
  const entry = skillsLock.skills?.[name];
  if (!entry?.source || !entry?.computedHash) {
    fail(`${skillsLockPath}: ${name} debe declarar source y computedHash`);
  }
}

// Cada skill propia se descubre por su descripción: si no explica alcance y
// disparadores, la invocación implícita se activa donde no toca o no se activa
// donde debería.
for (const name of ownSkills) {
  const currentSkillPath = `.agents/skills/${name}/SKILL.md`;
  const currentMetadataPath = `.agents/skills/${name}/agents/openai.yaml`;
  requireFile(currentMetadataPath);

  if (existsSync(join(root, currentSkillPath))) {
    const skill = readFileSync(join(root, currentSkillPath), "utf8");
    const frontmatter = skill.match(/^---\n([\s\S]*?)\n---/);
    if (!frontmatter) {
      fail(`${currentSkillPath}: falta frontmatter YAML`);
    } else {
      if (!new RegExp(`^name:\\s*${name}$`, "m").test(frontmatter[1])) {
        fail(`${currentSkillPath}: name no coincide con el directorio`);
      }
      const description =
        frontmatter[1].match(/^description:\s*(.+)$/m)?.[1] || "";
      if (description.length < 80 || !/Úsalo|Usalo/.test(description)) {
        fail(`${currentSkillPath}: description debe explicar alcance y disparadores`);
      }
    }
  }

  if (!existsSync(join(root, currentMetadataPath))) continue;
  const metadata = readFileSync(join(root, currentMetadataPath), "utf8");
  const shortDescription =
    metadata.match(/short_description:\s*"([^"]+)"/)?.[1] || "";
  if (shortDescription.length < 25 || shortDescription.length > 64) {
    fail(
      `${currentMetadataPath}: short_description debe tener entre 25 y 64 caracteres`,
    );
  }
  if (!metadata.includes(`$${name}`)) {
    fail(
      `${currentMetadataPath}: default_prompt debe mencionar el skill explícitamente`,
    );
  }
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
// `.mcp.json` y el lockfile de skills viven en la raíz y quedarían fuera de esa
// auditoría si no se declararan aquí.
for (const key of ["implementationPrefixes", "deliverablePrefixes"]) {
  for (const prefix of [
    ".claude/",
    ".codex/",
    ".agents/",
    ".mcp.json",
    "skills-lock.json",
  ]) {
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

// Un servidor MCP declarado para un solo agente produce entregas que el otro
// no puede reproducir. Node no trae parser TOML: la sección se acota por
// encabezado y se comparan comando y argumentos contra `.mcp.json`.
function tomlSection(source, heading) {
  const lines = source.split("\n");
  const start = lines.findIndex((line) => line.trim() === `[${heading}]`);
  if (start === -1) return null;
  const rest = lines.slice(start + 1);
  const end = rest.findIndex((line) => /^\s*\[/.test(line));
  return (end === -1 ? rest : rest.slice(0, end)).join("\n");
}

function tomlString(section, key) {
  const expression = new RegExp(`^\\s*${key}\\s*=\\s*"([^"]*)"`, "m");
  return section.match(expression)?.[1] ?? null;
}

function tomlStringArray(section, key) {
  const expression = new RegExp(`^\\s*${key}\\s*=\\s*\\[([^\\]]*)\\]`, "m");
  const raw = section.match(expression)?.[1];
  if (raw === undefined) return null;
  return [...raw.matchAll(/"([^"]*)"/g)].map((match) => match[1]);
}

const claudeMcp = readJson(claudeMcpPath);
const codexConfig = existsSync(join(root, codexConfigPath))
  ? readFileSync(join(root, codexConfigPath), "utf8")
  : "";

for (const name of sharedMcpServers) {
  const declared = claudeMcp.mcpServers?.[name];
  if (!declared?.command || !Array.isArray(declared.args)) {
    fail(`${claudeMcpPath}: mcpServers.${name} debe declarar command y args`);
    continue;
  }
  const section = tomlSection(codexConfig, `mcp_servers.${name}`);
  if (section === null) {
    fail(`${codexConfigPath}: falta [mcp_servers.${name}]`);
    continue;
  }
  const command = tomlString(section, "command");
  const args = tomlStringArray(section, "args");
  if (
    command !== declared.command ||
    JSON.stringify(args) !== JSON.stringify(declared.args)
  ) {
    fail(
      `${codexConfigPath}: [mcp_servers.${name}] no coincide con ${claudeMcpPath}`,
    );
  }
}

// Los adaptadores solo declaran identidad; la lógica pertenece al núcleo.
for (const adapter of [
  codexAdapterPath,
  claudeAdapterPath,
  claudeReadOnlyAdapterPath,
]) {
  if (!existsSync(join(root, adapter))) continue;
  const source = readFileSync(join(root, adapter), "utf8");
  if (!source.includes("runHook") || !source.includes("project-guard.mjs")) {
    fail(`${adapter}: debe delegar en runHook del núcleo compartido`);
  }
}


// Los subagentes son la única pieza asimétrica de la integración: Codex no los
// consume y conserva la ruta lineal del skill de entrega. La decisión está en
// ADR-0016. Se validan igual que el resto porque su definición es entregable.
const subagentDirectory = ".claude/agents";
const implementerAgents = ["worker-backend", "client-ui", "d1-schema"];
const readOnlyAgents = ["revisor", "corredor"];

for (const name of [...implementerAgents, ...readOnlyAgents]) {
  const agentPath = `${subagentDirectory}/${name}.md`;
  if (!existsSync(join(root, agentPath))) {
    fail(`${agentPath}: subagente requerido ausente`);
    continue;
  }
  const definition = readFileSync(join(root, agentPath), "utf8");
  const frontmatter = definition.match(/^---\n([\s\S]*?)\n---/);
  if (!frontmatter) {
    fail(`${agentPath}: falta frontmatter YAML`);
    continue;
  }
  const block = frontmatter[1];
  if (!new RegExp(`^name:\\s*${name}$`, "m").test(block)) {
    fail(`${agentPath}: name no coincide con el archivo`);
  }
  const description = block.match(/^description:\s*(.+)$/m)?.[1] || "";
  if (description.length < 80) {
    fail(`${agentPath}: description debe explicar alcance y disparadores`);
  }
  // Un agente que verifica o solo ejecuta comandos no puede escribir: sin esta
  // línea dejaría de ser independiente de lo que juzga.
  if (readOnlyAgents.includes(name)) {
    const disallowed = block.match(/^disallowedTools:\s*(.+)$/m)?.[1] || "";
    for (const tool of ["Edit", "Write"]) {
      if (!disallowed.includes(tool)) {
        fail(`${agentPath}: disallowedTools debe incluir ${tool}`);
      }
    }
    if (/^tools:.*\b(Edit|Write)\b/m.test(block)) {
      fail(`${agentPath}: tools no puede declarar herramientas de escritura`);
    }
  }
}

// El revisor es el único que corre comandos sobre el código que juzga, así que
// su restricción tiene que estar en su propia definición.
const reviewerDefinition = existsSync(join(root, `${subagentDirectory}/revisor.md`))
  ? readFileSync(join(root, `${subagentDirectory}/revisor.md`), "utf8")
  : "";
if (!reviewerDefinition.includes(claudeReadOnlyAdapterPath)) {
  fail(`${subagentDirectory}/revisor.md: debe registrar ${claudeReadOnlyAdapterPath} en PreToolUse`);
}

// El rol de solo lectura es una lista de comandos permitidos. Si queda vacía,
// el agente no puede verificar nada; si desaparece, deja de estar restringido.
for (const key of [
  "allowedCommands",
  "allowedGitSubcommands",
  "allowedNpmScripts",
  "blockedArgumentPatterns",
  "blockedShellPatterns",
]) {
  if (!Array.isArray(policy.readOnlyRole?.[key]) || policy.readOnlyRole[key].length === 0) {
    fail(`${policyPath}: readOnlyRole.${key} debe ser una lista no vacía`);
  }
}
if (!policy.planArtifacts?.directory || !policy.planArtifacts?.specFileName) {
  fail(`${policyPath}: planArtifacts debe declarar directory y specFileName`);
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
