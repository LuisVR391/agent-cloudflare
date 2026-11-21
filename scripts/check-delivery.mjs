import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import path from "node:path";

const root = path.resolve(import.meta.dirname, "..");
const rules = JSON.parse(readFileSync(new URL("../.agents/guard/documentation.json", import.meta.url)))
  .map(({ paths, documents }) => ({ paths: new RegExp(paths), documents }));
const policy = JSON.parse(readFileSync(new URL("../.agents/guard/policy.json", import.meta.url)));
const sensitive = policy.sensitivePathPatterns.map((source) => new RegExp(source, "i"));
const samples = policy.sensitivePathAllowPatterns.map((source) => new RegExp(source, "i"));
const sha = /^(?:[a-f0-9]{40}|[a-f0-9]{64})$/;
const zero = /^0{40}(?:0{24})?$/;
const migration = /^migrations\/.+\.sql$/;
const testFile = /^(?:test\/|tests\/)|(?:\.test|\.spec)\.[^/]+$|(?:^|\/)vitest[^/]*\.config\.[^/]+$/;
const requiredHeadings = ["Documentación", "ADR", "Roadmap", "Validación"];

const git = (args, cwd = root) => execFileSync("git", args, {
  cwd, encoding: "utf8", stdio: ["ignore", "pipe", "pipe"],
});

export function documentationProblems(changes, committedPaths = []) {
  const problems = [];
  const updated = new Set(changes.filter(({ status }) => status !== "D").map(({ file }) => file));
  for (const file of new Set([...updated, ...committedPaths])) {
    if (sensitive.some((pattern) => pattern.test(file)) && !samples.some((pattern) => pattern.test(file))) {
      problems.push(`Archivo de credenciales en el historial que saldrá: ${file}.`);
    }
  }

  const missing = new Map();
  for (const { status, file } of changes) {
    if (migration.test(file) && status !== "A") {
      problems.push(`La migración aplicada es inmutable: ${file}.`);
    }
    if (testFile.test(file)) continue;
    const rule = rules.find((entry) => entry.paths.test(file));
    if (!rule || rule.documents.some((document) => updated.has(document))) continue;
    const files = missing.get(rule) ?? [];
    files.push(file);
    missing.set(rule, files);
  }
  for (const [rule, files] of missing) {
    problems.push(`${files.join(", ")} requiere actualizar: ${rule.documents.join(" o ")}.`);
  }
  return problems;
}

export function checkRange(base, head, cwd = root) {
  if (!sha.test(base) || !sha.test(head)) throw new Error("Se requieren dos SHA completos.");
  const diff = git(["diff", "--name-status", "--no-renames", "-z", base, head, "--"], cwd).split("\0");
  const changes = [];
  for (let i = 0; i + 1 < diff.length; i += 2) {
    changes.push({ status: diff[i], file: diff[i + 1] });
  }
  const history = git([
    "log", "--format=", "--no-renames", "--diff-merges=first-parent", "--diff-filter=AMT",
    "--name-only", "-z", `${base}..${head}`, "--",
  ], cwd).split("\0").filter(Boolean);
  return documentationProblems(changes, history);
}

export function checkPush(input, remote, cwd = root) {
  const problems = new Set();
  for (const line of input.trim().split("\n").filter(Boolean)) {
    const fields = line.split(/\s+/);
    const [, head, ref, old] = fields;
    if (fields.length !== 4 || !sha.test(head) || !sha.test(old) || !ref) {
      throw new Error("Git entregó referencias de push inválidas.");
    }
    if (!ref.startsWith("refs/heads/") || zero.test(head)) continue;

    let from = old;
    if (zero.test(old)) {
      if (!/^[A-Za-z0-9_./-]+$/.test(remote)) throw new Error("Se requiere un remoto Git registrado.");
      try {
        from = git(["merge-base", `refs/remotes/${remote}/main`, head], cwd).trim();
      } catch {
        throw new Error(`No se pudo comparar la rama nueva con ${remote}/main. Actualiza la referencia local de ese remoto y verifica que compartan historial.`);
      }
    }
    if (git(["merge-base", from, head], cwd).trim() !== from) {
      problems.add(`${ref}: el push debe conservar el historial del destino.`);
      continue;
    }
    for (const problem of checkRange(from, head, cwd)) problems.add(problem);
  }
  return [...problems];
}

export function checkPullRequest(body) {
  const clean = body.replace(/<!--[\s\S]*?-->/g, "");
  const sections = [...clean.matchAll(/^##[ \t]+([^\r\n]+)\r?\n([\s\S]*?)(?=^##[ \t]+|(?![\s\S]))/gm)];
  const relevant = sections
    .map(([, heading, content]) => ({ heading: heading.trim(), content: content.trim() }))
    .filter(({ heading }) => requiredHeadings.includes(heading));
  const problems = requiredHeadings
    .filter((heading) => !relevant.some((section) => section.heading === heading && section.content))
    .map((heading) => `PR: completa ${heading}.`);

  if (problems.length === 0 && relevant.map(({ heading }) => heading).join("\n") !== requiredHeadings.join("\n")) {
    problems.push("PR: usa una vez y en este orden Documentación, ADR, Roadmap y Validación.");
  }
  return problems;
}

export function checkGitHubEvent(eventName, event, cwd = root) {
  if (eventName === "pull_request") {
    const pr = event.pull_request;
    if (!sha.test(pr?.base?.sha) || !sha.test(pr?.head?.sha)) {
      throw new Error("El evento de PR no contiene los SHA de base y cabeza.");
    }
    const ancestor = git(["merge-base", pr.base.sha, pr.head.sha], cwd).trim();
    return [...checkRange(ancestor, pr.head.sha, cwd), ...checkPullRequest(pr.body ?? "")];
  }
  if (eventName === "push") {
    if (!sha.test(event.before) || !sha.test(event.after)) throw new Error("El evento de push no contiene los SHA.");
    if (zero.test(event.before) || zero.test(event.after)) return [];
    return checkRange(event.before, event.after, cwd);
  }
  throw new Error("Se requiere un evento de GitHub Actions pull_request o push.");
}

if (import.meta.main) {
  try {
    const [mode, base, head] = process.argv.slice(2);
    let problems;
    if (mode === "pre-push") {
      problems = checkPush(readFileSync(0, "utf8"), base ?? "");
    } else if (mode === "ci" && process.env.GITHUB_EVENT_PATH) {
      const event = JSON.parse(readFileSync(process.env.GITHUB_EVENT_PATH, "utf8"));
      problems = checkGitHubEvent(process.env.GITHUB_EVENT_NAME, event);
    } else if (mode === "range") {
      problems = checkRange(base, head);
    } else {
      throw new Error("Usa pre-push <remoto>, ci en GitHub Actions o range <base> <head>.");
    }
    if (problems.length) throw new Error(problems.join("\n"));
    console.log("Control de documentación y entrega aprobado.");
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
