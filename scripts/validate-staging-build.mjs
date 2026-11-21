import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

const repositoryRoot = join(import.meta.dirname, "..");
export const stagingConfigPath = "dist/agent_cloudflare/wrangler.json";
export const stagingWorker = "agent-cloudflare-staging";
export const stagingDatabase = "agent-cloudflare-staging-db";
export const stagingDatabaseId = "b3eaa1ce-1dbb-46dd-90b9-0aea49ee87f3";
export const stagingBucket = "agent-cloudflare-staging-media";

export function assertStagingBuild(config, workerBundle) {
  assert.equal(config.targetEnvironment, "staging");
  assert.equal(config.name, stagingWorker);
  assert.equal(config.workers_dev, true);
  assert.equal(Object.hasOwn(config, "env"), false);
  assert(!config.route && !config.routes?.length, "Staging debe servir solo en workers.dev.");
  assert.equal(config.main, "index.js");
  assert.equal(config.no_bundle, true);
  assert.equal(config.assets?.binding, "ASSETS");
  assert.equal(config.assets?.directory, "../client");
  assert.equal(config.assets?.run_worker_first, true);
  assert.equal(config.ai?.binding, "AI");
  assert.deepEqual(config.services ?? [], []);
  assert.deepEqual(config.durable_objects?.bindings, [
    { name: "CustomerSupportAgent", class_name: "CustomerSupportAgent" },
  ]);

  assert(
    config.vars?.BETTER_AUTH_URL === "https://agent-cloudflare-staging.luisvr391.workers.dev",
    "El origen de autenticación debe corresponder a staging.",
  );
  assert.deepEqual(Object.keys(config.vars), ["BETTER_AUTH_URL"]);
  assert.deepEqual(config.secrets?.required, [
    "BETTER_AUTH_SECRET",
    "AUTH_SETUP_TOKEN",
    "ZERNIO_WEBHOOK_SECRET",
    "ZERNIO_API_KEY",
  ]);

  assert.equal(config.d1_databases?.length, 1);
  const [database] = config.d1_databases;
  assert.equal(database.binding, "DB");
  assert.equal(database.database_name, stagingDatabase);
  assert.equal(database.database_id, stagingDatabaseId);
  assert.deepEqual(config.r2_buckets, [
    { binding: "MEDIA_BUCKET", bucket_name: stagingBucket },
  ]);

  assert.equal(config.queues?.producers?.length, 2);
  assert.equal(config.queues?.consumers?.length, 2);
  for (const [direction, binding] of [
    ["inbound", "INBOUND_MESSAGES"],
    ["outbound", "OUTBOUND_MESSAGES"],
  ]) {
    const queue = `${stagingWorker}-${direction}`;
    const producer = config.queues.producers.find((entry) => entry.binding === binding);
    const consumer = config.queues.consumers.find((entry) => entry.queue === queue);
    assert.equal(producer?.queue, queue);
    assert.equal(consumer?.dead_letter_queue, `${queue}-dlq`);
    assert.equal(consumer?.max_batch_size, 10);
    assert.equal(consumer?.max_batch_timeout, 1);
    assert.equal(consumer?.max_retries, 5);
  }

  assert(!workerBundle.includes("/api/dev/"), "El bundle contiene una ruta de desarrollo.");
  assert(!workerBundle.includes("inbound-fixture"), "El bundle contiene el simulador local.");
}

export function validateStagingBuild() {
  const config = JSON.parse(readFileSync(join(repositoryRoot, stagingConfigPath), "utf8"));
  const workerBundle = readFileSync(join(repositoryRoot, "dist/agent_cloudflare/index.js"), "utf8");
  assertStagingBuild(config, workerBundle);
  return config;
}

if (import.meta.main) {
  validateStagingBuild();
  console.log("Configuración del artefacto de staging validada.");
}
