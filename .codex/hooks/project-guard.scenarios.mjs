import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import test from "node:test";

import { handleHook } from "./project-guard.mjs";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const policy = JSON.parse(
  readFileSync(join(repositoryRoot, ".codex", "agent-policy.json"), "utf8"),
);

function preTool(command, overrides = {}, runtime = {}) {
  return handleHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Bash",
      cwd: repositoryRoot,
      tool_input: { command },
      ...overrides,
    },
    policy,
    runtime,
  );
}

function denied(output) {
  return output?.hookSpecificOutput?.permissionDecision === "deny";
}

function staged(status) {
  return {
    runGit(args) {
      if (args.join(" ") === "diff --cached --name-status") return status;
      return "";
    },
  };
}

test("SessionStart carga contexto breve y fuentes de verdad", () => {
  const output = handleHook(
    { hook_event_name: "SessionStart", source: "startup" },
    policy,
  );
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /AGENTS\.md.*roadmap/i,
  );
});

test("SubagentStart hereda reglas críticas", () => {
  const output = handleHook(
    { hook_event_name: "SubagentStart", agent_type: "worker" },
    policy,
  );
  assert.match(output.hookSpecificOutput.additionalContext, /migraciones/i);
});

test("un comando seguro no se altera", () => {
  assert.equal(preTool("npm run test"), null);
  assert.equal(preTool("npx wrangler deploy --dry-run"), null);
});

test("git push requiere confirmación explícita y conserva el bloqueo de force push", () => {
  const withoutConfirmation = preTool("git push origin feature");
  assert.equal(denied(withoutConfirmation), true);
  assert.match(
    withoutConfirmation.hookSpecificOutput.permissionDecisionReason,
    /confirmación explícita/i,
  );

  const confirmed = preTool(
    "AGENT_PUSH_CONFIRMED=1 git push origin feature",
    {},
    staged(""),
  );
  assert.equal(confirmed, null);

  const confirmedForcePush = preTool(
    "AGENT_PUSH_CONFIRMED=1 git push --force-with-lease origin feature",
  );
  assert.equal(denied(confirmedForcePush), true);
  assert.match(
    confirmedForcePush.hookSpecificOutput.permissionDecisionReason,
    /force push/i,
  );
});

test("bloquea despliegues, D1 remoto, borrados y force push", () => {
  const commands = [
    "npx wrangler deploy",
    "npx wrangler d1 execute app --remote --file migrations/0001.sql",
    "npx wrangler r2 bucket delete customer-files",
    "git push --force-with-lease origin feature",
  ];
  for (const command of commands) {
    assert.equal(denied(preTool(command)), true, command);
  }
});

test("bloquea secretos de alta confianza sin repetirlos", () => {
  const secret = "sk-abcdefghijklmnopqrstuvwxyz123456";
  const output = handleHook(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: `Configura ${secret}`,
    },
    policy,
  );
  assert.equal(output.decision, "block");
  assert.doesNotMatch(JSON.stringify(output), new RegExp(secret));
});

test("permite crear una migración y bloquea editar una existente", () => {
  const runtime = {
    runGit(args) {
      if (args.includes("ls-files") && args.at(-1) === "migrations/0001.sql") {
        return "migrations/0001.sql";
      }
      return "";
    },
  };
  const added = handleHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      cwd: repositoryRoot,
      tool_input: {
        command:
          "*** Begin Patch\n*** Add File: migrations/0002.sql\n+SELECT 2;\n*** End Patch\n",
      },
    },
    policy,
    runtime,
  );
  assert.equal(added, null);

  const updated = handleHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "apply_patch",
      cwd: repositoryRoot,
      tool_input: {
        command:
          "*** Begin Patch\n*** Update File: migrations/0001.sql\n@@\n-SELECT 1;\n+SELECT 2;\n*** End Patch\n",
      },
    },
    policy,
    runtime,
  );
  assert.equal(denied(updated), true);
});

test("bloquea un archivo sensible antes de commit", () => {
  const output = preTool(
    'git commit -m "Roadmap: no aplica — prueba local segura"',
    {},
    staged("A\t.env"),
  );
  assert.equal(denied(output), true);
  assert.match(output.hookSpecificOutput.permissionDecisionReason, /\.env/);
});

test("advierte una implementación sin documentación", () => {
  const output = preTool(
    'git commit -m "Roadmap: no aplica — no cambia un entregable"',
    {},
    staged("A\tsrc/feature.ts"),
  );
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /implementación sin documentación/i,
  );
});

test("acepta justificaciones explícitas de ADR y roadmap", () => {
  const output = preTool(
    'git commit -m "ADR: no aplica — conserva decisiones vigentes" -m "Roadmap: no aplica — no cambia estado"',
    {},
    staged("M\twrangler.jsonc\nM\tREADME.md"),
  );
  assert.equal(output, null);
});

test("PostToolUse recuerda documentación una sola vez por turno", () => {
  const input = {
    hook_event_name: "PostToolUse",
    tool_name: "apply_patch",
    session_id: `test-${Date.now()}`,
    turn_id: "docs",
    tool_input: {
      command:
        "*** Begin Patch\n*** Update File: src/worker/index.ts\n@@\n-old\n+new\n*** End Patch\n",
    },
  };
  const first = handleHook(input, policy);
  const second = handleHook(input, policy);
  assert.match(first.hookSpecificOutput.additionalContext, /documentación/i);
  assert.equal(second, null);
});

test("Stop exige el cierre una vez y acepta las cuatro secciones", () => {
  const missing = handleHook(
    {
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message: "Cambio terminado.",
    },
    policy,
  );
  assert.equal(missing.decision, "block");

  const repeated = handleHook(
    {
      hook_event_name: "Stop",
      stop_hook_active: true,
      last_assistant_message: "Cambio terminado.",
    },
    policy,
  );
  assert.equal(repeated.continue, true);

  const complete = handleHook(
    {
      hook_event_name: "Stop",
      stop_hook_active: false,
      last_assistant_message:
        "### Documentación\nLista.\n### ADR\nNo aplica.\n### Roadmap\nListo.\n### Validación\nOK.",
    },
    policy,
  );
  assert.equal(complete.continue, true);
});
