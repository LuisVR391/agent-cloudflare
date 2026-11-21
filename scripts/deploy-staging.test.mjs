import assert from "node:assert/strict";
import { test } from "node:test";
import { deployStaging } from "./deploy-staging.mjs";
import {
  assertStagingBuild,
  stagingBucket,
  stagingConfigPath,
  stagingDatabase,
  stagingDatabaseId,
  stagingWorker,
} from "./validate-staging-build.mjs";

const approvedSha = "a".repeat(40);
const activeVersion = "11111111-2222-3333-4444-555555555555";
const argv = ["--sha", approvedSha, "--from-version", activeVersion];

function stagingConfig() {
  const queues = ["inbound", "outbound"].map((direction) => `${stagingWorker}-${direction}`);
  return {
    targetEnvironment: "staging",
    name: stagingWorker,
    workers_dev: true,
    no_bundle: true,
    main: "index.js",
    vars: { BETTER_AUTH_URL: "https://agent-cloudflare-staging.luisvr391.workers.dev" },
    secrets: { required: ["BETTER_AUTH_SECRET", "AUTH_SETUP_TOKEN", "ZERNIO_WEBHOOK_SECRET", "ZERNIO_API_KEY"] },
    ai: { binding: "AI" },
    assets: { binding: "ASSETS", directory: "../client", run_worker_first: true },
    d1_databases: [{ binding: "DB", database_name: stagingDatabase, database_id: stagingDatabaseId }],
    r2_buckets: [{ binding: "MEDIA_BUCKET", bucket_name: stagingBucket }],
    durable_objects: { bindings: [{ name: "CustomerSupportAgent", class_name: "CustomerSupportAgent" }] },
    queues: {
      producers: [
        { binding: "INBOUND_MESSAGES", queue: queues[0] },
        { binding: "OUTBOUND_MESSAGES", queue: queues[1] },
      ],
      consumers: queues.map((queue) => ({
        queue,
        dead_letter_queue: `${queue}-dlq`,
        max_batch_size: 10,
        max_batch_timeout: 1,
        max_retries: 5,
      })),
    },
  };
}

test("el artefacto solo admite los recursos aislados de staging", () => {
  assert.doesNotThrow(() => assertStagingBuild(stagingConfig(), ""));
  const invalid = [
    (config) => { config.name = "agent-cloudflare-production"; },
    (config) => { config.routes = [{ pattern: "production.example.com" }]; },
    (config) => { config.vars.BETTER_AUTH_URL = "https://staging.invalid"; },
    (config) => { config.d1_databases[0].database_id = "other-uuid"; },
    (config) => { config.r2_buckets[0].bucket_name = "agent-cloudflare-media"; },
    (config) => { config.queues.producers[1].queue = "agent-cloudflare-outbound"; },
    (config) => { config.queues.consumers[1].dead_letter_queue = "agent-cloudflare-outbound-dlq"; },
    (config) => { config.durable_objects.bindings[0].script_name = "agent-cloudflare-production"; },
    (config) => { config.ai.binding = "SOMETHING_ELSE"; },
    (config) => { config.main = "another-file.js"; },
    (config) => { config.assets.directory = "../unreviewed"; },
  ];
  for (const corrupt of invalid) {
    const config = stagingConfig();
    corrupt(config);
    assert.throws(() => assertStagingBuild(config, ""));
  }
  assert.throws(() => assertStagingBuild(stagingConfig(), "/api/dev/messages"), /ruta de desarrollo/);
  assert.throws(() => assertStagingBuild(stagingConfig(), "inbound-fixture"), /simulador/);
});

function fixture({
  commits = [approvedSha],
  changes = "",
  remoteVersion = activeVersion,
  traffic = 100,
  databaseId = stagingDatabaseId,
  bucketName = stagingBucket,
  missingQueue,
  checkFailure,
  buildFailure,
} = {}) {
  const operations = [];
  let headsRead = 0;
  const options = {
    env: { AGENT_DEPLOY_CONFIRMED: "1", npm_execpath: "npm-cli.js" },
    validateBuild() {
      operations.push("artefacto");
      if (buildFailure) throw new Error("artefacto incorrecto");
      return stagingConfig();
    },
    run(command, args, capture, environment) {
      if (command === "git") {
        assert.equal(capture, true);
        operations.push(args[0]);
        if (args[0] === "rev-parse") return commits[Math.min(headsRead++, commits.length - 1)];
        assert.deepEqual(args, ["status", "--porcelain=v1", "--untracked-files=all"]);
        return changes;
      }
      assert.equal(command, process.execPath);
      assert.deepEqual(environment, { WRANGLER_CI_OVERRIDE_NAME: stagingWorker });
      const [cli, ...argv] = args;
      if (cli === "npm-cli.js") {
        operations.push("suite");
        assert.deepEqual(argv, ["run", "check"]);
        if (checkFailure) throw new Error("suite fallida");
        return;
      }
      assert.match(cli, /node_modules\/wrangler\/bin\/wrangler\.js$/);
      assert.deepEqual(argv.slice(-2), ["--config", stagingConfigPath]);
      assert(!argv.includes("--env"));
      const query = argv.slice(0, -2);
      if (query[0] === "deploy") {
        operations.push("publicación simulada");
        assert.deepEqual(query, ["deploy", "--name", stagingWorker]);
        assert.equal(capture, false);
        return;
      }
      assert.equal(capture, true);
      operations.push(query.join(" "));
      switch (query[0]) {
        case "d1":
          assert.deepEqual(query, ["d1", "list", "--json"]);
          return JSON.stringify([{ name: stagingDatabase, uuid: databaseId }]);
        case "r2":
          assert.deepEqual(query, ["r2", "bucket", "info", stagingBucket, "--json"]);
          return JSON.stringify({ name: bucketName });
        case "queues":
          assert.equal(query[1], "info");
          return query[2] === missingQueue ? "Queue Name: other" : `Queue Name: ${query[2]}`;
        case "deployments":
          assert.deepEqual(query, ["deployments", "status", "--name", stagingWorker, "--json"]);
          return JSON.stringify({ versions: [{ version_id: remoteVersion, percentage: traffic }] });
        default:
          assert.fail(`Llamada inesperada: ${query.join(" ")}`);
      }
    },
  };
  return { options, operations };
}

test("la CLI exige autorización, SHA y versión completos y rechaza opciones extras", () => {
  const { options, operations } = fixture();
  assert.throws(() => deployStaging(argv, { ...options, env: {} }), /autorización/);
  assert.throws(() => deployStaging(["--sha", "abc"], options), /SHA completo/);
  assert.throws(() => deployStaging(["--sha", approvedSha], options), /versión activa/);
  assert.throws(() => deployStaging([...argv, "--sha", approvedSha], options), /único SHA/);
  for (const flag of ["--env", "--config", "--secrets-file"]) {
    assert.throws(() => deployStaging([...argv, flag, "value"], options), /Unknown option/);
  }
  assert.deepEqual(operations, []);
});

test("un árbol sucio, el SHA cambiado o un check fallido detienen la publicación", () => {
  for (const [input, pattern] of [
    [{ changes: "?? local.txt" }, /árbol de trabajo/],
    [{ commits: ["b".repeat(40)] }, /SHA aprobado/],
    [{ commits: [approvedSha, "b".repeat(40)] }, /SHA aprobado/],
    [{ checkFailure: true }, /suite fallida/],
    [{ buildFailure: true }, /artefacto incorrecto/],
  ]) {
    const { options, operations } = fixture(input);
    assert.throws(() => deployStaging(argv, options), pattern);
    assert(!operations.includes("publicación simulada"));
    assert(!operations.some((operation) => operation.startsWith("d1 ")));
  }
});

test("una discrepancia en recursos, versión activa o tráfico impide publicar", () => {
  for (const [input, pattern] of [
    [{ databaseId: "other" }, /D1/],
    [{ bucketName: "other" }, /bucket/],
    [{ missingQueue: `${stagingWorker}-outbound-dlq` }, /cola/],
    [{ remoteVersion: "22222222-2222-2222-2222-222222222222" }, /versión activa/],
    [{ traffic: 50 }, /tráfico repartido/],
  ]) {
    const { options, operations } = fixture(input);
    assert.throws(() => deployStaging(argv, options), pattern);
    assert(!operations.includes("publicación simulada"));
  }
});

test("solo ejecuta el comando de publicación después de validar la suite, el artefacto y staging", () => {
  const { options, operations } = fixture();
  deployStaging(argv, options);
  assert.deepEqual(operations, [
    "rev-parse", "status", "suite", "rev-parse", "status", "artefacto",
    "d1 list --json",
    `r2 bucket info ${stagingBucket} --json`,
    `queues info ${stagingWorker}-inbound`,
    `queues info ${stagingWorker}-inbound-dlq`,
    `queues info ${stagingWorker}-outbound`,
    `queues info ${stagingWorker}-outbound-dlq`,
    "rev-parse", "status", "artefacto",
    `deployments status --name ${stagingWorker} --json`,
    "publicación simulada",
  ]);
});
