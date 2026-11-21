import { execFileSync } from "node:child_process";
import { join } from "node:path";
import { parseArgs } from "node:util";
import {
  stagingBucket,
  stagingConfigPath,
  stagingDatabase,
  stagingDatabaseId,
  stagingWorker,
  validateStagingBuild,
} from "./validate-staging-build.mjs";

const root = join(import.meta.dirname, "..");
const wranglerPath = join(root, "node_modules/wrangler/bin/wrangler.js");
const wranglerEnvironment = { WRANGLER_CI_OVERRIDE_NAME: stagingWorker };

function releaseRequest(args, env) {
  if (env.AGENT_DEPLOY_CONFIRMED !== "1") {
    throw new Error("Se requiere autorización explícita para staging, el SHA y la versión activa revisada.");
  }
  const { values } = parseArgs({
    args,
    options: {
      sha: { type: "string", multiple: true },
      "from-version": { type: "string", multiple: true },
    },
  });
  const sha = values.sha?.[0];
  if (values.sha?.length !== 1 || !/^[a-f0-9]{40}$/.test(sha)) {
    throw new Error("Indica un único SHA completo aprobado con --sha.");
  }
  const fromVersion = values["from-version"]?.[0];
  if (values["from-version"]?.length !== 1 || !/^[a-f0-9]{8}(?:-[a-f0-9]{4}){3}-[a-f0-9]{12}$/i.test(fromVersion)) {
    throw new Error("Indica una única versión activa revisada con --from-version.");
  }
  return { sha, fromVersion: fromVersion.toLowerCase() };
}

function execute(command, args, capture = false, environment) {
  return execFileSync(command, args, {
    cwd: root,
    env: { ...process.env, ...environment },
    encoding: "utf8",
    stdio: ["ignore", capture ? "pipe" : "inherit", "inherit"],
    timeout: capture ? 30_000 : undefined,
  });
}

function verifyResources(wrangler, consumers) {
  const databases = JSON.parse(wrangler(["d1", "list", "--json"]));
  const matches = databases.filter(({ name }) => name === stagingDatabase);
  if (matches.length !== 1 || matches[0].uuid !== stagingDatabaseId) {
    throw new Error("La D1 del artefacto no corresponde a la D1 de staging de la cuenta autenticada.");
  }

  const bucket = JSON.parse(wrangler(["r2", "bucket", "info", stagingBucket, "--json"]));
  if (bucket.name !== stagingBucket) throw new Error("No se pudo confirmar el bucket de staging.");

  for (const { queue, dead_letter_queue: dlq } of consumers) {
    for (const name of [queue, dlq]) {
      const info = wrangler(["queues", "info", name]);
      if (!info.split(/\r?\n/).includes(`Queue Name: ${name}`)) {
        throw new Error(`No se pudo confirmar la cola de staging ${name}.`);
      }
    }
  }
}

function verifyActiveVersion(wrangler, fromVersion) {
  const { versions } = JSON.parse(wrangler(["deployments", "status", "--name", stagingWorker, "--json"]));
  if (versions?.length !== 1 || versions[0].version_id !== fromVersion || versions[0].percentage !== 100) {
    throw new Error("La versión activa cambió o recibe tráfico repartido. Revisa staging antes de publicar.");
  }
}

export function deployStaging(args, {
  env = process.env,
  run = execute,
  validateBuild = validateStagingBuild,
} = {}) {
  const { sha, fromVersion } = releaseRequest(args, env);
  if (!env.npm_execpath) throw new Error("Ejecuta el comando npm indicado en la guía de staging.");

  function verifyCandidate() {
    const head = run("git", ["rev-parse", "HEAD"], true).trim();
    const changes = run("git", ["status", "--porcelain=v1", "--untracked-files=all"], true).trim();
    if (head !== sha || changes) {
      throw new Error("HEAD debe coincidir con el SHA aprobado y el árbol de trabajo debe estar limpio.");
    }
  }

  const wrangler = (command, capture = true) => run(
    process.execPath,
    [wranglerPath, ...command, "--config", stagingConfigPath],
    capture,
    wranglerEnvironment,
  );
  verifyCandidate();
  run(process.execPath, [env.npm_execpath, "run", "check"], false, wranglerEnvironment);
  verifyCandidate();

  const { queues } = validateBuild();
  verifyResources(wrangler, queues.consumers);
  verifyCandidate();
  validateBuild();
  verifyActiveVersion(wrangler, fromVersion);

  console.log(`Publicando ${sha} en ${stagingWorker} desde la versión ${fromVersion}.`);
  wrangler(["deploy", "--name", stagingWorker], false);
}

if (import.meta.main) {
  try {
    deployStaging(process.argv.slice(2));
  } catch (error) {
    console.error(error.message);
    process.exitCode = 1;
  }
}
