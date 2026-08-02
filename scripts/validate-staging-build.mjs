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
]);

const database = config.d1_databases?.find(({ binding }) => binding === "DB");
assert.equal(database?.database_name, "agent-cloudflare-staging-db");
assert.notEqual(database?.database_id, "local-development-placeholder");
assert.notEqual(database?.database_id, "production-not-provisioned");

const bucket = config.r2_buckets?.find(
  ({ binding }) => binding === "MEDIA_BUCKET",
);
assert.equal(bucket?.bucket_name, "agent-cloudflare-staging-media");

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
