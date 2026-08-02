import path from "node:path";
import {
  cloudflareTest,
  readD1Migrations,
} from "@cloudflare/vitest-pool-workers";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [
    cloudflareTest(async () => {
      // Las migraciones se leen en Node y se inyectan como binding de prueba
      // para aplicarlas dentro del Worker sobre una base vacía.
      const migrations = await readD1Migrations(
        path.join(import.meta.dirname, "migrations"),
      );

      return {
        main: "./src/worker/index.ts",
        wrangler: {
          configPath: "./wrangler.test.jsonc",
        },
        miniflare: {
          bindings: {
            TEST_MIGRATIONS: migrations,
            BETTER_AUTH_SECRET:
              "test-only-better-auth-secret-at-least-thirty-two-characters",
            AUTH_SETUP_TOKEN: "test-only-setup-token",
            BETTER_AUTH_URL: "https://example.com",
          },
        },
      };
    }),
  ],
  test: {
    include: ["test/**/*.test.ts"],
    exclude: ["test/client/**"],
    setupFiles: ["./test/apply-migrations.ts"],
  },
});
