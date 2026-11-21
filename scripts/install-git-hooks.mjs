import { execFileSync, spawnSync } from "node:child_process";
import { accessSync, constants, existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";

const cwd = path.resolve(import.meta.dirname, "..");
const git = (args) => execFileSync("git", args, { cwd, encoding: "utf8" }).trim();

try {
  const configured = spawnSync("git", ["config", "--get", "core.hooksPath"], { cwd, encoding: "utf8" });
  if (configured.error || ![0, 1].includes(configured.status)) {
    throw new Error("No se pudo leer core.hooksPath.");
  }
  if (configured.status === 0) {
    throw new Error("Ya existe core.hooksPath. Integra el comando de .githooks/pre-push en ese hook.");
  }

  const destination = git(["rev-parse", "--path-format=absolute", "--git-path", "hooks/pre-push"]);
  const hook = readFileSync(path.join(cwd, ".githooks/pre-push"), "utf8");

  if (existsSync(destination)) {
    if (readFileSync(destination, "utf8") !== hook) {
      throw new Error(`Se conserva el hook existente en ${destination}. Integra el comando de .githooks/pre-push allí.`);
    }
    accessSync(destination, constants.X_OK);
  } else {
    mkdirSync(path.dirname(destination), { recursive: true });
    writeFileSync(destination, hook, { flag: "wx", mode: 0o755 });
  }
  console.log("Hook pre-push de Agent Cloudflare activo.");
} catch (error) {
  console.error(error.message);
  process.exitCode = 1;
}
