import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..");
const generatedConfigPath = join(
  repositoryRoot,
  "dist",
  "agent_cloudflare",
  "wrangler.json",
);
const config = JSON.parse(readFileSync(generatedConfigPath, "utf8"));

assert.equal(config.targetEnvironment, "staging");
assert.equal(config.name, "agent-cloudflare-staging");
assert.equal(config.workers_dev, true);
assert.equal(Object.hasOwn(config, "env"), false);
assert.deepEqual(config.secrets?.required, [
  "BETTER_AUTH_SECRET",
  "AUTH_SETUP_TOKEN",
  "ZERNIO_WEBHOOK_SECRET",
  "ZERNIO_API_KEY",
]);

const database = config.d1_databases?.find(({ binding }) => binding === "DB");
assert.equal(database?.database_name, "agent-cloudflare-staging-db");
assert.notEqual(database?.database_id, "local-development-placeholder");
assert.notEqual(database?.database_id, "production-not-provisioned");

const bucket = config.r2_buckets?.find(
  ({ binding }) => binding === "MEDIA_BUCKET",
);
assert.equal(bucket?.bucket_name, "agent-cloudflare-staging-media");

const inboundProducer = config.queues?.producers?.find(
  ({ binding }) => binding === "INBOUND_MESSAGES",
);
assert.equal(inboundProducer?.queue, "agent-cloudflare-staging-inbound");
const inboundConsumer = config.queues?.consumers?.find(
  ({ queue }) => queue === "agent-cloudflare-staging-inbound",
);
assert.equal(inboundConsumer?.max_batch_size, 10);
assert.equal(inboundConsumer?.max_retries, 5);

// El utillaje de desarrollo no puede viajar en el artefacto: una ruta capaz de
// inyectar mensajes falsos en un entorno real es justo lo que el guard de
// `import.meta.env.DEV` debe eliminar. Si esta comprobación falla, el bundle
// dejó dentro el enganche y no debe publicarse.
const workerBundle = readFileSync(
  join(repositoryRoot, "dist", "agent_cloudflare", "index.js"),
  "utf8",
);
assert.equal(
  workerBundle.includes("/api/dev/"),
  false,
  "El bundle del Worker contiene una ruta de desarrollo.",
);
assert.equal(
  workerBundle.includes("inbound-fixture"),
  false,
  "El bundle del Worker contiene el módulo de simulación local.",
);

const authOrigin = new URL(config.vars?.BETTER_AUTH_URL);
assert.equal(authOrigin.protocol, "https:");
assert.equal(authOrigin.pathname, "/");
assert.equal(authOrigin.search, "");
assert.equal(authOrigin.hash, "");
assert.equal(
  authOrigin.hostname === "staging.invalid" ||
    /^agent-cloudflare-staging\.[a-z0-9-]+\.workers\.dev$/.test(
      authOrigin.hostname,
    ),
  true,
);

console.log("Staging build configuration is isolated and valid.");
