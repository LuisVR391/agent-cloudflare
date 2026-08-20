import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import test from "node:test";

import { handleHook } from "./project-guard.mjs";

const repositoryRoot = join(import.meta.dirname, "..", "..");
const policy = JSON.parse(
  readFileSync(join(repositoryRoot, ".agents", "guard", "policy.json"), "utf8"),
);

// Simula el seguimiento en git de una migración ya versionada.
const trackedMigration = {
  runGit(args) {
    if (args.includes("ls-files") && args.at(-1) === "migrations/0001.sql") {
      return "migrations/0001.sql";
    }
    return "";
  },
};

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
  assert.equal(preTool("npm run check:staging"), null);
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

test("bloquea D1 remoto y force push", () => {
  const commands = [
    "npx wrangler d1 execute app --remote --file migrations/0001.sql",
    "git push --force-with-lease origin feature",
  ];
  for (const command of commands) {
    assert.equal(denied(preTool(command)), true, command);
  }
});

test("un despliegue exige la marca de autorización y conserva el dry-run", () => {
  const withoutConfirmation = preTool("npm run deploy:staging");
  assert.equal(denied(withoutConfirmation), true);
  assert.match(
    withoutConfirmation.hookSpecificOutput.permissionDecisionReason,
    /AGENT_DEPLOY_CONFIRMED=1/,
  );

  assert.equal(denied(preTool("npx wrangler deploy")), true);
  assert.equal(denied(preTool("npx wrangler versions deploy")), true);

  assert.equal(preTool("AGENT_DEPLOY_CONFIRMED=1 npm run deploy:staging"), null);
  assert.equal(preTool("AGENT_DEPLOY_CONFIRMED=1 npx wrangler deploy"), null);
});

// Cada clase de operación tiene su propia marca. Una autorización concedida
// para desplegar no puede habilitar una migración remota, un borrado ni una
// fusión: son decisiones distintas que el usuario aprueba por separado.
test("cada marca libera solo su propia operación", () => {
  const commands = [
    "AGENT_DEPLOY_CONFIRMED=1 npx wrangler r2 bucket delete customer-files",
    "AGENT_DEPLOY_CONFIRMED=1 npx wrangler d1 migrations apply app --remote",
    "AGENT_DEPLOY_CONFIRMED=1 gh pr merge 26 --squash",
    "AGENT_DEPLOY_CONFIRMED=1 npx wrangler secret put ZERNIO_TOKEN",
    "AGENT_DEPLOY_CONFIRMED=1 git push origin feature",
    "AGENT_MERGE_CONFIRMED=1 npm run deploy:staging",
    "AGENT_MIGRATION_CONFIRMED=1 npx wrangler r2 bucket delete customer-files",
    "AGENT_DESTRUCTIVE_CONFIRMED=1 npx wrangler secret put ZERNIO_TOKEN",
  ];
  for (const command of commands) {
    assert.equal(denied(preTool(command)), true, command);
  }
});

test("las operaciones autorizables se liberan con su marca", () => {
  const commands = [
    "AGENT_MIGRATION_CONFIRMED=1 npx wrangler d1 migrations apply app --remote",
    "AGENT_DESTRUCTIVE_CONFIRMED=1 npx wrangler r2 bucket delete customer-files",
    "AGENT_MERGE_CONFIRMED=1 gh pr merge 26 --squash",
  ];
  for (const command of commands) {
    assert.equal(preTool(command), null, command);
  }
});

// Un bloqueo autorizable indica cómo pedir la decisión sin abandonar el turno.
// Una prohibición permanente nunca lo hace: sugerir una pregunta implicaría que
// existe una autorización capaz de habilitarla.
test("solo los bloqueos autorizables invitan a preguntar en el turno", () => {
  const runtime = { inlineApprovalTool: "AskUserQuestion" };
  const reason = (command, withTool = true) =>
    preTool(command, {}, withTool ? runtime : {})
      .hookSpecificOutput.permissionDecisionReason;

  assert.match(reason("npm run deploy:staging"), /AskUserQuestion/);
  assert.match(reason("gh pr merge 26 --squash"), /AskUserQuestion/);
  assert.match(reason("git push origin feature"), /AskUserQuestion/);
  assert.doesNotMatch(reason("git push --force origin main"), /AskUserQuestion/);
  assert.doesNotMatch(
    reason("npx wrangler secret put ZERNIO_TOKEN"),
    /AskUserQuestion/,
  );
  // Un adaptador que no declara la herramienta conserva el motivo neutral.
  assert.doesNotMatch(reason("npm run deploy:staging", false), /AskUserQuestion/);
});

// Una migración remota producía efectos sin exigir ninguna autorización.
test("una migración remota exige su marca", () => {
  const blocked = preTool("npx wrangler d1 migrations apply app --remote");
  assert.equal(denied(blocked), true);
  assert.match(
    blocked.hookSpecificOutput.permissionDecisionReason,
    /AGENT_MIGRATION_CONFIRMED=1/,
  );
});

// Con la red habilitada en el sandbox del agente, estos comandos ya no
// escalan a una aprobación externa: el bloqueo determinista es el único
// control que queda antes de un efecto remoto.
test("bloquea secretos remotos, mutaciones de GitHub y publicación", () => {
  const commands = [
    "npx wrangler secret put ZERNIO_TOKEN",
    "npx wrangler secret bulk delete secrets.json",
    "gh release create v0.2.0",
    "gh api -X DELETE repos/example/agents/issues/comments/1",
    "npm publish --access public",
  ];
  for (const command of commands) {
    assert.equal(denied(preTool(command)), true, command);
  }
});

test("conserva la inspección remota y la creación de un PR", () => {
  const commands = [
    "gh pr create --fill",
    "gh pr view 26",
    "gh api repos/example/agents/pulls/26",
    "curl -sS https://api.github.com/repos/example/agents/pulls/26",
    "curl -sS 'https://api.github.com/repos/example/agents/pulls?state=open'",
    "npx wrangler secret list",
    "npx wrangler versions list",
  ];
  for (const command of commands) {
    assert.equal(preTool(command, {}, staged("")), null, command);
  }
});

// Publicar por la API es el camino habitual del repositorio, así que crear y
// editar un PR, un issue o un comentario no puede exigir una marca. Lo que sí
// la exige es cambiar el estado, porque fusiona, cierra o reabre.
test("permite crear y editar por la API de GitHub", () => {
  const commands = [
    "curl -sS -X POST https://api.github.com/repos/example/agents/pulls --data @body.json",
    "curl -sS -X PATCH https://api.github.com/repos/example/agents/pulls/45 --data @body.json",
    "curl -sS -X POST https://api.github.com/repos/example/agents/issues/45/comments --data @comment.json",
    "gh api -X PATCH repos/example/agents/pulls/45 -f title=Nuevo",
  ];
  for (const command of commands) {
    assert.equal(preTool(command, {}, staged("")), null, command);
  }
});

test("fusionar, cerrar o reabrir por la API exige su marca", () => {
  const merge =
    "curl -sS -X PUT https://api.github.com/repos/example/agents/pulls/45/merge";
  const close =
    'curl -sS -X PATCH https://api.github.com/repos/example/agents/issues/45 -d \'{"state":"closed"}\'';
  for (const command of [merge, close]) {
    const blocked = preTool(command);
    assert.equal(denied(blocked), true, command);
    assert.match(
      blocked.hookSpecificOutput.permissionDecisionReason,
      /AGENT_MERGE_CONFIRMED=1/,
      command,
    );
  }
  assert.equal(preTool(`AGENT_MERGE_CONFIRMED=1 ${merge}`, {}, staged("")), null);
});

test("bloquea por la API lo que ninguna autorización habilita", () => {
  const commands = [
    "curl -sS -X DELETE https://api.github.com/repos/example/agents/issues/comments/1",
    "curl -sS -X POST https://api.github.com/repos/example/agents/releases --data @release.json",
    "curl -sS -X PUT https://api.github.com/repos/example/agents/actions/secrets/TOKEN --data @secret.json",
    "curl -sS -X POST https://api.github.com/repos/example/agents/actions/workflows/ci.yml/dispatches",
  ];
  for (const command of commands) {
    const blocked = preTool(command);
    assert.equal(denied(blocked), true, command);
    assert.doesNotMatch(
      blocked.hookSpecificOutput.permissionDecisionReason,
      /AGENT_MERGE_CONFIRMED/,
      command,
    );
  }
});

// La auditoría del diff se disparaba solo con `gh pr create`. Publicar por la
// API la evitaría, y con ella la comprobación de documentación, ADR y roadmap.
test("audita el diff también al crear el PR por la API", () => {
  const command =
    "curl -sS -X POST https://api.github.com/repos/example/agents/pulls --data @body.json";
  const blocked = preTool(command, {}, staged("M\tsrc/worker/index.ts"));
  assert.equal(denied(blocked), true);
  assert.match(
    blocked.hookSpecificOutput.permissionDecisionReason,
    /documentación|ADR|Roadmap/i,
  );
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

test("apply_patch permite crear una migración y bloquea editar una existente", () => {
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
    trackedMigration,
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
    trackedMigration,
  );
  assert.equal(denied(updated), true);
});

test("Edit y Write aplican la misma regla de migraciones con rutas absolutas", () => {
  const editExisting = handleHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      cwd: repositoryRoot,
      tool_input: {
        file_path: join(repositoryRoot, "migrations/0001.sql"),
        old_string: "SELECT 1;",
        new_string: "SELECT 2;",
      },
    },
    policy,
    trackedMigration,
  );
  assert.equal(denied(editExisting), true);
  assert.match(
    editExisting.hookSpecificOutput.permissionDecisionReason,
    /migrations\/0001\.sql/,
  );

  const writeNew = handleHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      cwd: repositoryRoot,
      tool_input: {
        file_path: join(repositoryRoot, "migrations/0002.sql"),
        content: "SELECT 2;\n",
      },
    },
    policy,
    trackedMigration,
  );
  assert.equal(writeNew, null);

  const writeSource = handleHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Write",
      cwd: repositoryRoot,
      tool_input: {
        file_path: join(repositoryRoot, "src/worker/index.ts"),
        content: "export default {};\n",
      },
    },
    policy,
    trackedMigration,
  );
  assert.equal(writeSource, null);
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

test("PostToolUse resuelve rutas absolutas y deduplica por agente", () => {
  const input = {
    hook_event_name: "PostToolUse",
    tool_name: "Edit",
    session_id: `test-${Date.now()}`,
    prompt_id: "claude-docs",
    cwd: repositoryRoot,
    tool_input: { file_path: join(repositoryRoot, "src/worker/index.ts") },
  };
  const first = handleHook(input, policy, { agent: "claude" });
  const repeated = handleHook(input, policy, { agent: "claude" });
  const otherAgent = handleHook(input, policy, { agent: "codex" });

  assert.match(first.hookSpecificOutput.additionalContext, /documentación/i);
  assert.equal(repeated, null);
  assert.match(
    otherAgent.hookSpecificOutput.additionalContext,
    /documentación/i,
  );
});

test("SessionStart usa la invocación del skill propia de cada agente", () => {
  const claude = handleHook(
    { hook_event_name: "SessionStart", source: "startup" },
    policy,
    { skillCommand: "/deliver-agent-cloudflare-change" },
  );
  const codex = handleHook(
    { hook_event_name: "SessionStart", source: "startup" },
    policy,
    { skillCommand: "$deliver-agent-cloudflare-change" },
  );
  assert.match(
    claude.hookSpecificOutput.additionalContext,
    /\/deliver-agent-cloudflare-change/,
  );
  assert.match(
    codex.hookSpecificOutput.additionalContext,
    /\$deliver-agent-cloudflare-change/,
  );
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

test("el rol de solo lectura rechaza cualquier escritura", () => {
  const readOnly = { role: "readOnly" };

  const edit = handleHook(
    {
      hook_event_name: "PreToolUse",
      tool_name: "Edit",
      cwd: repositoryRoot,
      tool_input: { file_path: join(repositoryRoot, "src/worker/index.ts") },
    },
    policy,
    readOnly,
  );
  assert.equal(denied(edit), true);
  assert.match(
    edit.hookSpecificOutput.permissionDecisionReason,
    /verifica y no modifica/i,
  );

  const escrituras = [
    "echo 'x' > src/worker/index.ts",
    "sed -i 's/a/b/' src/worker/index.ts",
    "rm -rf test",
    "git commit -m 'fix'",
    "npm run deploy:staging",
    "cat README.md | tee copia.md",
    "grep -r $(cat lista.txt) src",
    "npx prettier --write src",
  ];
  for (const command of escrituras) {
    assert.equal(denied(preTool(command, {}, readOnly)), true, command);
  }
});

test("el rol de solo lectura permite inspeccionar y correr pruebas", () => {
  const readOnly = { role: "readOnly" };
  const lecturas = [
    "cat src/worker/index.ts",
    "sed -n '1,40p' AGENTS.md",
    "grep -rn organizationId src/worker",
    "git diff --name-status",
    "git log --oneline -5",
    "npm run test:client",
    "npm run check:agents",
    "find migrations -name '*.sql'",
  ];
  for (const command of lecturas) {
    assert.equal(preTool(command, {}, readOnly), null, command);
  }
});

test("sin el rol de solo lectura las reglas generales no cambian", () => {
  assert.equal(preTool("sed -i 's/a/b/' src/worker/index.ts"), null);
  assert.equal(preTool("cat README.md | tee copia.md"), null);
});

test("SessionStart recupera el plan activo de la rama", () => {
  const workspace = mkdtempSync(join(tmpdir(), "agent-cloudflare-plan-"));
  const planDirectory = join(workspace, ".plans", "issue-56-herramientas");
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(
    join(planDirectory, "SPEC.md"),
    [
      "---",
      "feature: Herramientas con autorización en backend",
      "slug: issue-56-herramientas",
      "issue: 56",
      "rama: feat/issue-56-herramientas",
      "estado: activo",
      "---",
      "",
      "# Herramientas",
    ].join("\n"),
  );
  const branchRunner = {
    runGit(args) {
      if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
        return "feat/issue-56-herramientas";
      }
      return "";
    },
  };

  const conPlan = handleHook(
    { hook_event_name: "SessionStart", source: "startup", cwd: workspace },
    policy,
    branchRunner,
  );
  assert.match(
    conPlan.hookSpecificOutput.additionalContext,
    /plan activo: Herramientas con autorización en backend/,
  );
  assert.match(
    conPlan.hookSpecificOutput.additionalContext,
    /\.plans\/issue-56-herramientas\/SPEC\.md/,
  );

  const otraRama = handleHook(
    { hook_event_name: "SessionStart", source: "startup", cwd: workspace },
    policy,
    {
      runGit(args) {
        if (args.join(" ") === "rev-parse --abbrev-ref HEAD") return "main";
        return "";
      },
    },
  );
  assert.doesNotMatch(
    otraRama.hookSpecificOutput.additionalContext,
    /plan activo/,
  );

  rmSync(workspace, { recursive: true, force: true });
});

test("UserPromptSubmit recuerda el skill según la intención", () => {
  function prompt(text, runtime = {}) {
    return handleHook(
      { hook_event_name: "UserPromptSubmit", prompt: text, cwd: repositoryRoot },
      policy,
      { skillCommand: "/deliver-agent-cloudflare-change", ...runtime },
    );
  }

  const planear = prompt("Vamos a planear el corte de herramientas autorizadas");
  assert.match(
    planear.hookSpecificOutput.additionalContext,
    /plan-agent-cloudflare-change/,
  );

  // Sin acentos y en minúsculas: el recordatorio debe seguir apareciendo.
  const sinAcentos = prompt("planificacion del corte de conocimiento");
  assert.match(
    sinAcentos.hookSpecificOutput.additionalContext,
    /plan-agent-cloudflare-change/,
  );

  const implementar = prompt("implementa el endpoint de herramientas");
  assert.match(
    implementar.hookSpecificOutput.additionalContext,
    /no tiene plan/i,
  );

  // Una pregunta informativa no dispara ningún recordatorio.
  assert.equal(prompt("¿dónde vive el catálogo de permisos?"), null);

  // El prefijo del skill lo aporta cada agente.
  const codex = prompt("planea el corte", {
    skillCommand: "$deliver-agent-cloudflare-change",
  });
  assert.match(
    codex.hookSpecificOutput.additionalContext,
    /\$plan-agent-cloudflare-change/,
  );
});

test("con plan activo el recordatorio apunta al ciclo", () => {
  const workspace = mkdtempSync(join(tmpdir(), "agent-cloudflare-routing-"));
  const planDirectory = join(workspace, ".plans", "issue-56-herramientas");
  mkdirSync(planDirectory, { recursive: true });
  writeFileSync(
    join(planDirectory, "SPEC.md"),
    [
      "---",
      "feature: Herramientas con autorización en backend",
      "slug: issue-56-herramientas",
      "rama: feat/issue-56-herramientas",
      "estado: activo",
      "---",
    ].join("\n"),
  );

  const output = handleHook(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: "retomamos la implementación",
      cwd: workspace,
    },
    policy,
    {
      skillCommand: "/deliver-agent-cloudflare-change",
      runGit(args) {
        if (args.join(" ") === "rev-parse --abbrev-ref HEAD") {
          return "feat/issue-56-herramientas";
        }
        return "";
      },
    },
  );
  assert.match(
    output.hookSpecificOutput.additionalContext,
    /run-agent-cloudflare-cycle/,
  );

  rmSync(workspace, { recursive: true, force: true });
});

test("el bloqueo de secretos tiene precedencia sobre el recordatorio", () => {
  const secret = "sk-0123456789abcdef0123456789abcdef";
  const output = handleHook(
    {
      hook_event_name: "UserPromptSubmit",
      prompt: `implementa esto con ${secret}`,
      cwd: repositoryRoot,
    },
    policy,
    { skillCommand: "/deliver-agent-cloudflare-change" },
  );
  assert.equal(output.decision, "block");
  assert.doesNotMatch(JSON.stringify(output), new RegExp(secret));
});
