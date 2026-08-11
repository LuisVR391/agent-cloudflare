# Continuidad de agentes de codificación

Esta guía describe la capa repo-local que ayuda a un agente de codificación a
aplicar las reglas, validaciones y trazabilidad de Agent Cloudflare de forma
consistente. La [fuente normativa sigue siendo `AGENTS.md`](../../AGENTS.md);
los skills y hooks solo cargan contexto, automatizan verificaciones y detienen
riesgos inequívocos.

El repositorio soporta dos integraciones: **Codex** y **Claude Code**. Ambas
comparten un núcleo neutral para que una regla se escriba, pruebe y mantenga
una sola vez. La decisión está registrada en
[ADR-0005](../decisions/ADR-0005-shared-agent-guardrails.md).

## Componentes

| Componente | Responsabilidad |
| --- | --- |
| [Skill de entrega](../../.agents/skills/deliver-agent-cloudflare-change/SKILL.md) | Organiza inspección, alcance, implementación, documentación, validación y publicación. |
| [Política mecánica](../../.agents/guard/policy.json) | Declara fuentes de verdad, rutas, secretos, comandos bloqueados y mapa documental. |
| [Núcleo del guardrail](../../.agents/guard/project-guard.mjs) | Evalúa cada evento sin registrar el prompt, payload o secreto recibido. |
| [Validador](../../.agents/guard/validate-agent-config.mjs) | Comprueba estructura, referencias, configuración de ambas integraciones y cuerpo del PR en CI. |
| [Pruebas simuladas](../../.agents/guard/scenarios.mjs) | Verifica decisiones permitidas, bloqueos, recordatorios y cierre de turno. |
| [Hooks de Codex](../../.codex/hooks.json) y [su adaptador](../../.codex/hooks/project-guard.mjs) | Registran los eventos de Codex y declaran la identidad del agente. |
| [Ajustes de Claude Code](../../.claude/settings.json) y [su adaptador](../../.claude/hooks/project-guard.mjs) | Registran los eventos de Claude Code, sus permisos denegados y la identidad del agente. |

Los adaptadores no contienen reglas. Solo declaran cómo se identifica el agente
y cómo se invoca el skill; toda decisión pertenece al núcleo compartido.

## Descubrimiento y confianza

### Codex

Codex descubre automáticamente el skill desde `.agents/skills` al trabajar
dentro del repositorio. Puede invocarse explícitamente con:

```text
$deliver-agent-cloudflare-change
```

Los hooks locales solo se cargan en un proyecto confiable y sus comandos
requieren revisión humana. Después de actualizar la rama:

1. Inicia o reinicia Codex desde cualquier directorio dentro del repositorio.
2. Ejecuta `/skills` y confirma que aparece
   `deliver-agent-cloudflare-change`.
3. Ejecuta `/hooks`.
4. Revisa el origen `.codex/hooks.json`, el comando exacto y los eventos.
5. Confía la definición únicamente si coincide con el código revisado.

Codex registra la confianza contra el hash de la definición. Un cambio futuro
en los hooks requerirá una revisión nueva. No se debe usar
`--dangerously-bypass-hook-trust` como flujo habitual.

### Claude Code

Claude Code carga [`CLAUDE.md`](../../CLAUDE.md), que importa `AGENTS.md` con
`@AGENTS.md`. El skill se descubre desde `.claude/skills`, que es un symlink al
directorio único en `.agents/skills`. Se invoca con:

```text
/deliver-agent-cloudflare-change
```

Los hooks y las reglas de permisos de `.claude/settings.json` se aplican
después de aceptar el diálogo de confianza del directorio de trabajo. Después
de actualizar la rama:

1. Inicia o reinicia Claude Code dentro del repositorio y acepta la confianza
   del proyecto solo si revisaste el contenido de `.claude/`.
2. Ejecuta `/skills` y confirma que aparece
   `deliver-agent-cloudflare-change`.
3. Ejecuta `/hooks` y revisa el origen `Project Settings`, el comando exacto y
   los eventos registrados.
4. Ejecuta `/permissions` y confirma las reglas denegadas.

Un cambio en `.claude/settings.json` vuelve a requerir revisión. Al clonar en
Windows, el symlink del skill necesita `git config core.symlinks true` o
permisos de enlace simbólico; sin eso, Claude Code no encontrará el skill
aunque el resto de la integración funcione.

## Comportamiento por evento

Ambas integraciones registran los mismos seis eventos y comparten las mismas
decisiones. La diferencia está en las herramientas que observan: Codex edita
con `apply_patch`, Claude Code con `Edit` y `Write`. El núcleo normaliza ambas
formas, incluidas las rutas absolutas que exige Claude Code.

### Inicio de sesión y subagentes

`SessionStart` y `SubagentStart` agregan contexto breve con las fuentes de
verdad y las restricciones críticas. No copian documentos completos en el
prompt.

### Prompt del usuario

`UserPromptSubmit` bloquea patrones de secreto de alta confianza, como llaves
privadas y tokens con formatos inequívocos. El mensaje de rechazo nunca repite
el valor detectado. Esta revisión es una defensa adicional, no un escáner
exhaustivo; un secreto expuesto debe rotarse.

### Antes de usar herramientas

`PreToolUse` bloquea:

- cualquier despliegue que no sea `--dry-run` sin autorización explícita;
- ejecución remota de D1 y eliminación de recursos Cloudflare;
- escritura o borrado de secretos con `wrangler secret`;
- mutación del repositorio remoto con `gh` (`pr merge`, `pr close`,
  `release create`, `repo delete`, `secret set`, `workflow run`) y `gh api` con
  un método `POST`, `PUT`, `PATCH` o `DELETE`;
- `npm publish`;
- `git reset --hard`, `git clean` forzado y force push;
- cualquier `git push` sin confirmación explícita del usuario;
- publicación de `.env`, `.dev.vars`, llaves privadas y archivos equivalentes;
- edición o eliminación de migraciones existentes.

La inspección remota sigue permitida: `gh pr view`, `gh api` en lectura,
`wrangler secret list` y `gh pr create` no se bloquean, porque no producen un
efecto irreversible y el hook ya audita el diff antes de crear un PR.

Los agentes pueden crear commits locales atómicos sin una aprobación adicional.
Antes de publicar, deben mostrar la rama, los commits y las validaciones,
solicitar confirmación y esperar la respuesta. Una vez confirmada la publicación
de ese estado concreto, el comando debe usar:

```bash
AGENT_PUSH_CONFIRMED=1 git push
```

La marca solo habilita un push normal en ese comando; no representa una
autorización persistente ni evita el bloqueo de force push. Crear una migración
nueva sí está permitido. Antes de commit, push o creación
de PR, el hook audita el diff disponible. Un cambio arquitectónico requiere un
ADR o la declaración `ADR: no aplica — <motivo concreto>`; un cambio de
entregable requiere actualizar el roadmap o declarar
`Roadmap: no aplica — <motivo concreto>`. La implementación sin documentación
produce una advertencia visible.

El despliegue sigue la misma forma que la publicación. `AGENTS.md` exige
autorización explícita para el entorno y el artefacto actuales; una vez
recibida, el comando la declara en sí mismo:

```bash
AGENT_DEPLOY_CONFIRMED=1 npm run deploy:staging
```

La marca libera únicamente ese comando. No se reutiliza para otro despliegue,
no amplía el permiso a producción ni a la eliminación de recursos, y no levanta
ningún otro bloqueo: `wrangler secret`, los borrados de recursos y el force push
siguen denegados aunque la marca esté presente. `--dry-run` y
`npm run check:staging` nunca se bloquean, porque son parte del gate de
validación.

Esta marca sustituye la ausencia deliberada de excepción mecánica que tenía el
guardrail antes de habilitar la red en el sandbox del agente. Mientras la red
estaba restringida, un despliegue escalaba a una aprobación externa; sin esa
escalada, la marca es el único punto en que la autorización queda registrada
antes del efecto remoto.

Los hooks fallan abiertos si su propia lectura o ejecución interna falla, salvo
cuando ya reconocieron una acción prohibida. Esto evita inmovilizar el
repositorio por un fallo del guardrail; el CI sigue siendo el control
determinista.

### Después de editar y al cerrar

`PostToolUse` sugiere documentos relacionados una sola vez por turno. Codex
identifica el turno con `turn_id` y Claude Code con `prompt_id`; si ninguno está
disponible, la sugerencia degrada a una vez por sesión. `Stop` exige que la
entrega incluya `Documentación`, `ADR`, `Roadmap` y `Validación`. Si faltan,
solicita una sola continuación; `stop_hook_active` evita un bucle. Ese cierre se
pide en todos los turnos, incluidos los conversacionales.

Los marcadores de deduplicación se guardan bajo el directorio temporal del
sistema, separados por agente. No se persisten prompts, respuestas, comandos
completos ni secretos.

## Entorno de ejecución del agente

Los guardrails de este repositorio son deterministas y locales: se evalúan en
`.agents/guard/` y no dependen de que un servicio remoto responda. Conviene que
la CLI del agente tampoco dependa de uno.

El gate obligatorio `npm run check` termina en `check:staging`, que ejecuta
`wrangler types` y `wrangler deploy --dry-run`. Ambos necesitan red. Con un
sandbox que la restringe, cada entrega escala a una aprobación externa; si ese
revisor no está disponible, la entrega se detiene por indisponibilidad y no por
política.

Codex se configura en `~/.codex/config.toml`, fuera del repositorio y por
máquina:

```toml
approvals_reviewer = "user"
approval_policy = "on-request"
sandbox_mode = "workspace-write"

[sandbox_workspace_write]
network_access = true
```

`codex doctor` debe reportar `restricted fs + enabled network · approval
OnRequest`. `approvals_reviewer = "user"` evita enrutar cada aprobación al
modelo remoto `codex-auto-review`, que deniega la acción cuando está saturado.
`trust_level = "trusted"` en la entrada `[projects]` solo omite el diálogo de
confianza del proyecto; no altera las aprobaciones.

Habilitar la red elimina la escalada implícita que antes frenaba a `gh`,
`wrangler` y `npm`. Esa protección se repone con los patrones bloqueados de la
sección anterior, que se evalúan localmente y no pueden fallar por la capacidad
de un servicio.

## Permisos denegados en Claude Code

`.claude/settings.json` declara reglas `permissions.deny` como respaldo
determinista del hook:

- lectura de `.env`, `.dev.vars`, llaves privadas y certificados;
- `git push --force`, `-f` y `--force-with-lease`.

Estas reglas cubren un hueco real: una referencia `@archivo` no ejecuta ninguna
herramienta, por lo que `PreToolUse` nunca la observa y solo una deny rule
impide que un secreto entre en contexto.

Su alcance es distinto al del hook y no lo sustituye. Las reglas de `Bash`
conservan el bloqueo determinista de force push. El hook mantiene el análisis
de ejecución remota de D1 y borrados; la autorización de despliegue se rige por
`AGENTS.md`. Codex no tiene un equivalente declarativo y depende únicamente
del hook.

## Validación determinista

Ejecuta:

```bash
npm run check:agents
npm run check
git diff --check
```

`check:agents` valida el frontmatter y metadata del skill, los JSON, el symlink
de `.claude/skills`, el nombre exacto de `CLAUDE.md`, los archivos
referenciados, los eventos registrados por cada agente, las reglas denegadas, la
sintaxis Node.js y quince escenarios simulados. En un evento `pull_request`,
también exige contenido real bajo las secciones `Documentación`, `ADR`,
`Roadmap` y `Validación`.

La plantilla de PR incluye esas secciones. Los comentarios HTML no cuentan
como contenido y una sección vacía falla el CI.

La configuración de staging añade dos superficies explícitas: `npm run
check:staging` ejecuta únicamente build y dry-run, mientras `npm run
deploy:staging` sigue siendo un despliegue real y el guardrail lo bloquea para
agentes. No existe un script de producción.

## Mantenimiento

- Escribe cada regla nueva en el núcleo, nunca en un adaptador.
- Actualiza la política y sus pruebas en el mismo PR.
- Agrega un caso de regresión por cada nueva regla de bloqueo y cúbrelo con las
  herramientas de ambos agentes cuando aplique.
- Mantén las descripciones del skill enfocadas para que la invocación implícita
  no se active en preguntas informativas.
- Prefiere advertencias para decisiones contextuales y bloqueos para riesgos de
  alta confianza.
- No conviertas el hook en una segunda copia de `AGENTS.md`.
- Actualiza esta guía cuando cambien eventos, comandos, confianza o límites.
