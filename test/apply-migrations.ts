import { applyD1Migrations, type D1Migration } from "cloudflare:test";
import { env } from "cloudflare:workers";
import { beforeAll } from "vitest";

// `TEST_MIGRATIONS` lo inyecta `vitest.config.ts` y solo existe durante las
// pruebas, por lo que no forma parte del `Env` del Worker desplegado.
type TestEnv = Cloudflare.Env & { TEST_MIGRATIONS: D1Migration[] };

// Cada archivo de prueba corre con almacenamiento aislado, de modo que las
// migraciones se aplican siempre desde una base vacía.
beforeAll(async () => {
  const testEnv = env as TestEnv;

  await applyD1Migrations(testEnv.DB, testEnv.TEST_MIGRATIONS);
});
