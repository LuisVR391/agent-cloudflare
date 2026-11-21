import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import {
  constants, copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import test from "node:test";
import { checkGitHubEvent, checkPullRequest, checkPush, checkRange, documentationProblems } from "./check-delivery.mjs";

const root = path.resolve(import.meta.dirname, "..");
const source = "src/worker/integrations/zernio/webhook.ts";
const docs = ".docs/modules/zernio-whatsapp-channel.md";
const contactDocs = ".docs/modules/contacts-and-conversations.md";
const zero = "0".repeat(40);
const body = [
  "## Documentación\nSe actualizó la ficha.",
  "## ADR\nNo aplica porque el contrato se conserva.",
  "## Roadmap\nEl entregable sigue en revisión.",
  "## Validación\nSuite verde.",
].join("\n\n");

const edit = (file, status = "M") => ({ file, status });
const gitEnv = { ...process.env, GIT_CONFIG_NOSYSTEM: "1", GIT_CONFIG_GLOBAL: "/dev/null" };

function newRepository(t) {
  const cwd = mkdtempSync(path.join(tmpdir(), "agent-cloudflare-delivery-"));
  t.after(() => rmSync(cwd, { recursive: true, force: true }));
  const git = (...args) => execFileSync("git", args, {
    cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"], env: gitEnv,
  }).trim();
  const write = (file, content) => {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    writeFileSync(path.join(cwd, file), content);
  };
  const commit = (message) => {
    git("add", "-A");
    git("-c", "core.hooksPath=/dev/null", "commit", "-qm", message);
    return git("rev-parse", "HEAD");
  };

  git("init", "-q", "-b", "main");
  git("config", "user.name", "Test");
  git("config", "user.email", "test@example.invalid");
  git("config", "commit.gpgsign", "false");
  write("README.md", "base");
  const base = commit("base");
  git("update-ref", "refs/remotes/origin/main", base);
  return { cwd, git, write, commit, base };
}

test("exige documentación pertinente por área y acepta cambios de pruebas", () => {
  const crm = edit("src/worker/contact-api.ts");
  assert.equal(documentationProblems([edit(source), edit(contactDocs)]).length, 1);
  assert.equal(documentationProblems([edit(source), crm, edit(docs)]).length, 1);
  assert.deepEqual(documentationProblems([edit(source), crm, edit(docs), edit(contactDocs)]), []);
  assert.deepEqual(documentationProblems([edit("test/health.test.ts")]), []);
  assert.deepEqual(documentationProblems([edit("scripts/delivery.test.mjs")]), []);
  assert.equal(documentationProblems([edit(source), edit(docs, "D")]).length, 1);

  const runtime = ".docs/modules/conversation-runtime.md";
  const tool = "src/worker/agents/tool-catalog.ts";
  assert.match(documentationProblems([edit(tool), edit(runtime)])[0], /tools-and-permissions/);
  assert.deepEqual(documentationProblems([edit(tool), edit(".docs/modules/tools-and-permissions.md")]), []);
});

test("permite documentar migraciones nuevas y bloquea modificar SQL existente", () => {
  const migration = "migrations/0022_example.sql";
  const guide = edit("migrations/README.md");
  assert.match(documentationProblems([edit(migration), guide])[0], /inmutable/);
  assert.match(documentationProblems([edit(migration, "D"), guide])[0], /inmutable/);
  assert.deepEqual(documentationProblems([edit(migration, "A"), guide]), []);
  assert.deepEqual(documentationProblems([guide]), []);
});

test("valida los commits nuevos del primer y segundo push", (t) => {
  const { cwd, git, write, commit } = newRepository(t);
  const push = (head, old, remote = "origin") =>
    checkPush(`refs/heads/work ${head} refs/heads/work ${old}\n`, remote, cwd);

  write(source, "primera versión");
  assert.match(push(commit("cambio sin ficha"), zero)[0], /zernio-whatsapp-channel/);
  write(docs, "ficha de la primera versión");
  const first = commit("actualiza ficha");
  assert.deepEqual(push(first, zero), []);
  assert.throws(() => push(first, zero, "other"), /referencia local/);
  write(source, "siguiente versión");
  const second = commit("siguiente cambio");
  assert.match(push(second, first)[0], /zernio-whatsapp-channel/);
  write(docs, "ficha del segundo push");
  assert.deepEqual(push(commit("ficha nueva"), first), []);
  assert.match(push(first, second)[0], /conservar el historial/);
  const missing = git("rev-parse", "HEAD");
  assert.throws(() => checkPush(`refs/heads/work ${missing}\n`, "origin", cwd), /inválidas/);
});

test("detecta rutas de credenciales en commits salientes aunque se retiren después", (t) => {
  const { cwd, write, commit, base } = newRepository(t);
  const secretPath = ".dev.vars";
  write(secretPath, "PLACEHOLDER=ficticio");
  const withSecret = commit("fixture temporal");
  rmSync(path.join(cwd, secretPath));
  const removed = commit("retira fixture");
  assert.deepEqual(checkRange(base, removed, cwd), [`Archivo de credenciales en el historial que saldrá: ${secretPath}.`]);
  assert.deepEqual(checkRange(withSecret, removed, cwd), []);
  assert.deepEqual(documentationProblems([edit(".env.example")]), []);
});

test("valida solo cambios aportados por el PR desde su ancestro común", (t) => {
  const { cwd, git, write, commit, base } = newRepository(t);
  git("switch", "-qc", "work");
  write(source, "cambio en el webhook");
  const headWithoutDocs = commit("cambio sin ficha");
  git("switch", "-q", "main");
  write("src/worker/contact-api.ts", "avance independiente de main");
  const main = commit("cambio en main");

  const pr = (sha) => ({ pull_request: { base: { sha: main }, head: { sha }, body } });
  const problems = checkGitHubEvent("pull_request", pr(headWithoutDocs), cwd);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /zernio-whatsapp-channel/);
  git("switch", "-q", "work");
  write(docs, "ficha del webhook");
  const head = commit("documentación");
  assert.deepEqual(checkGitHubEvent("pull_request", pr(head), cwd), []);
  assert.deepEqual(checkGitHubEvent("push", { before: base, after: head }, cwd), []);
  assert.throws(() => checkGitHubEvent("pull_request", { pull_request: {} }, cwd), /SHA/);
});

test("CI pide una vez, en orden y con contenido, las cuatro secciones del PR", () => {
  const empty = body.replace("Suite verde.", "<!-- pendiente -->");
  assert.deepEqual(checkPullRequest(body.replaceAll("\n", "\r\n")), []);
  assert.deepEqual(checkPullRequest(`${empty}\n\n## Riesgos\nUn riesgo.`), ["PR: completa Validación."]);
  assert.match(checkPullRequest(`${body}\n\n## ADR\nRepetido.`)[0], /en este orden/);
  assert.match(checkPullRequest(body.replace("## ADR", "## Roadmap").replace("## Roadmap\nEl", "## ADR\nEl"))[0], /en este orden/);
});

test("instala un hook ejecutable y conserva pre-push propios y core.hooksPath", (t) => {
  const { cwd, git, write, base, commit } = newRepository(t);
  for (const file of [".githooks/pre-push", ".agents/guard/documentation.json", ".agents/guard/policy.json",
    "scripts/install-git-hooks.mjs", "scripts/check-delivery.mjs"]) {
    mkdirSync(path.dirname(path.join(cwd, file)), { recursive: true });
    copyFileSync(path.join(root, file), path.join(cwd, file));
  }

  const installed = path.join(cwd, ".git/hooks/pre-push");
  const install = () => spawnSync(process.execPath, ["scripts/install-git-hooks.mjs"], { cwd, encoding: "utf8", env: gitEnv });
  git("config", "--local", "core.hooksPath", "my-hooks");
  assert.equal(install().status, 1);
  assert.equal(existsSync(installed), false);
  git("config", "--local", "--unset", "core.hooksPath");
  assert.equal(install().status, 0);
  assert.equal(readFileSync(installed, "utf8"), readFileSync(path.join(root, ".githooks/pre-push"), "utf8"));
  assert.ok(statSync(installed).mode & constants.S_IXUSR);
  assert.equal(install().status, 0);

  // Ejecuta el hook real con la entrada que usa Git, sin escribir en ningún remoto.
  write(".docs/operations/entrega.md", "guía para el contenido de la fixture");
  write(source, "cambio en el webhook");
  const runHook = (head) => spawnSync(installed, ["origin", "unused"], {
    cwd,
    encoding: "utf8",
    env: { ...gitEnv, PATH: path.dirname(process.execPath) + path.delimiter + process.env.PATH },
    input: `refs/heads/work ${head} refs/heads/work ${base}\n`,
  });
  const rejected = runHook(commit("sin ficha de Zernio"));
  assert.equal(rejected.status, 1);
  assert.match(rejected.stderr, /zernio-whatsapp-channel/);
  write(docs, "ficha actualizada");
  assert.equal(runHook(commit("con ficha de Zernio")).status, 0);

  writeFileSync(installed, "hook propio");
  assert.equal(install().status, 1);
  assert.equal(readFileSync(installed, "utf8"), "hook propio");
});
