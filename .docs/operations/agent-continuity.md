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
| [Skill de shadcn](../../.agents/skills/shadcn/SKILL.md) | Aporta el contexto real del proyecto, las convenciones del CLI y las reglas de composición de la interfaz. |
| [Servidor MCP para Claude Code](../../.mcp.json) y [para Codex](../../.codex/config.toml) | Declaran el servidor de shadcn en cada agente para consultar e instalar desde los registros. |
| [Lockfile de skills](../../skills-lock.json) | Fija el origen y el hash de cada skill externa para que su versión sea reproducible. |

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
2. Ejecuta `/skills` y confirma que aparecen
   `deliver-agent-cloudflare-change` y `shadcn`.
3. Ejecuta `/hooks`.
4. Revisa el origen `.codex/hooks.json`, el comando exacto y los eventos.
5. Confía la definición únicamente si coincide con el código revisado.
6. Ejecuta `codex mcp list` y confirma el servidor `shadcn`.

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
   del proyecto solo si revisaste el contenido de `.claude/` y `.mcp.json`.
2. Ejecuta `/skills` y confirma que aparecen
   `deliver-agent-cloudflare-change` y `shadcn`.
3. Ejecuta `/hooks` y revisa el origen `Project Settings`, el comando exacto y
   los eventos registrados.
4. Ejecuta `/permissions` y confirma las reglas denegadas.
5. Ejecuta `/mcp` y confirma que `shadcn` aparece como `Connected`.

Un cambio en `.claude/settings.json` vuelve a requerir revisión. Al clonar en
Windows, los symlinks de `.claude/skills` necesitan
`git config core.symlinks true` o permisos de enlace simbólico; sin eso, Claude
Code no encontrará ninguna skill aunque el resto de la integración funcione.

## Herramientas MCP y skills de terceros

Todo lo que describe esta sección es **herramienta de desarrollo local**. No se
despliega, no entra en el bundle del Worker, no declara bindings ni recursos
Cloudflare y no añade por sí misma dependencias de runtime. Un agente no debe
presentarla como una capacidad del producto ni tratar su salida como aprobada:
lo que el CLI de shadcn escriba se revisa en el diff, con las mismas reglas de
alcance, pruebas y documentación que cualquier otro código.

Eso incluye las dependencias. Un componente del registro puede exigir un paquete
propio —`@shadcn/react` para el desplazamiento del hilo— y ese paquete sí entra
en el bundle del cliente. Instalar un componente no autoriza su dependencia: se
declara, se fija a una versión exacta y se justifica en la entrega igual que
cualquier otra.

La interfaz del cliente es un proyecto shadcn/ui —`components.json`, Tailwind
v4, base `radix` e iconos `lucide`—, así que el repositorio declara dos piezas
para trabajar sobre ella sin adivinar APIs:

| Pieza | Qué aporta |
| --- | --- |
| Skill `shadcn` | Inyecta el contexto real del proyecto con `shadcn info --json` y fija las convenciones de composición, formularios, iconos y theming. |
| Servidor MCP `shadcn` | Permite buscar, inspeccionar e instalar componentes de los registros configurados desde el propio agente. |

La skill vive una sola vez en `.agents/skills/shadcn`, la ruta universal que
Codex descubre, y `.claude/skills/shadcn` es un symlink relativo a ese
directorio, igual que la skill de entrega. Su origen y su hash quedan fijados
en [`skills-lock.json`](../../skills-lock.json); se actualiza con
`npx skills update shadcn` y el cambio se revisa como cualquier otro diff.

El servidor MCP se declara por separado en cada agente, con el mismo comando:

```json
// .mcp.json — Claude Code
{ "mcpServers": { "shadcn": { "command": "npx", "args": ["shadcn@latest", "mcp"] } } }
```

```toml
# .codex/config.toml — Codex
[mcp_servers.shadcn]
command = "npx"
args = ["shadcn@latest", "mcp"]
```

`npm run check:agents` exige que ambas declaraciones coincidan; un servidor
disponible en un solo agente produciría entregas que el otro no puede
reproducir.

Tres límites conviene tenerlos presentes:

- **Codex solo lee `.codex/config.toml` en un proyecto confiable.** Sin esa
  confianza, `codex mcp list` no muestra el servidor y hay que declararlo por
  máquina con `codex mcp add shadcn -- npx shadcn@latest mcp`. Codex Desktop
  puede ignorar la configuración de proyecto.
- **Claude Code pide aprobar el `.mcp.json` del proyecto** la primera vez que
  se abre el repositorio, y vuelve a pedirlo si el archivo cambia.
- **El guardrail no observa las llamadas a herramientas MCP.** `PreToolUse`
  solo registra `Bash`, `Edit` y `Write`, así que un servidor MCP escribe
  archivos fuera de esa cobertura. La revisión del diff y `npm run check` son
  el control real.

`shadcn@latest` se resuelve en cada arranque del servidor: la versión puede
cambiar sin aviso y el primer arranque descarga el paquete. Es una decisión
deliberada para seguir al registro oficial, y el servidor MCP sigue invocándose
así.

El paquete `shadcn` sí está declarado como `devDependency` con versión exacta,
pero no para ejecutar el CLI: `src/client/styles.css` importa su
`shadcn/tailwind.css`, que aporta las utilidades que los componentes del registro
dan por hechas (`shimmer` en `Attachment`, `scroll-fade-*` en
`MessageScroller`). Es una dependencia de build cuyo contenido se inlinea en el
CSS compilado; queda fijada porque cambia con el CLI. Los detalles están en
[ADR-0009](../decisions/ADR-0009-client-ui-composition.md).

El registro por defecto no usa credenciales y `components.json` no declara
registros privados, así que ningún token entra en este flujo. Si algún día se
configura un registro privado, su token pertenece a `.env.local` y nunca al
repositorio.

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

`PreToolUse` distingue dos clases de bloqueo. Los **autorizables** esperan una
decisión del usuario y se liberan con la marca de su clase:

| Operación | Marca |
| --- | --- |
| Despliegue que no sea `--dry-run` | `AGENT_DEPLOY_CONFIRMED=1` |
| `wrangler d1 migrations apply --remote` | `AGENT_MIGRATION_CONFIRMED=1` |
| `git push` de la rama y commits actuales | `AGENT_PUSH_CONFIRMED=1` |
| Fusionar, cerrar o reabrir un PR o issue, por CLI o por la API | `AGENT_MERGE_CONFIRMED=1` |
| Eliminación de un recurso Cloudflare | `AGENT_DESTRUCTIVE_CONFIRMED=1` |

Las **prohibiciones permanentes** no se liberan con ninguna marca, porque no
existe autorización que las habilite:

- escritura o borrado de secretos con `wrangler secret` o `gh secret`;
- ejecución remota arbitraria sobre D1 con `wrangler d1 execute --remote`;
- publicación de releases, alteración del repositorio remoto y `gh workflow run`,
  y sus equivalentes por la API: cualquier `DELETE`, y `POST`, `PUT` o `PATCH`
  sobre releases, secretos, variables, `dispatches` o transferencia;
- `npm publish`;
- `git reset --hard`, `git clean` forzado y force push;
- publicación de `.env`, `.dev.vars`, llaves privadas y archivos equivalentes;
- edición o eliminación de migraciones existentes.

Un agente con canal para consultar al usuario dentro de la entrega recibe además,
en el propio motivo del bloqueo autorizable, la instrucción de pedir esa decisión
sin interrumpir el trabajo. El adaptador lo declara con `inlineApprovalTool`; los
que no lo declaran conservan el motivo neutral. Las prohibiciones permanentes
nunca reciben esa invitación, para no sugerir una autorización inexistente.

La inspección remota sigue permitida: la lectura por la API, `wrangler secret
list` y la creación de un PR no se bloquean, porque no producen un efecto
irreversible y el hook audita el diff antes de crear el PR. Esa auditoría
reconoce tanto `gh pr create` como `POST /repos/:owner/:repo/pulls`, de modo que
publicar por la API no la evita.

Crear y editar PRs, issues y comentarios por la API tampoco se bloquea: es el
camino habitual del repositorio, descrito en [`AGENTS.md`](../../AGENTS.md). Lo
que sí exige la marca de fusión es cambiar el estado, y el guardrail lo detecta
por el endpoint `/pulls/:n/merge` o por el `state` escrito en el propio comando.
Por eso el cuerpo que cambia estado no puede ir en un archivo: en un archivo el
efecto deja de ser visible para el hook.

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

La marca libera únicamente ese comando. No se reutiliza para otro despliegue, no
amplía el permiso a producción y no levanta ningún bloqueo de otra clase: una
migración remota, una fusión o un borrado exigen la suya, y `wrangler secret` o
el force push siguen denegados aunque cualquier marca esté presente. `--dry-run`
y `npm run check:staging` nunca se bloquean, porque son parte del gate de
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

`check:agents` valida el frontmatter y metadata del skill de entrega, los JSON,
los symlinks de `.claude/skills` y el `SKILL.md` de cada skill, el origen y el
hash de las skills externas en `skills-lock.json`, la paridad del servidor MCP
entre `.mcp.json` y `.codex/config.toml`, el nombre exacto de `CLAUDE.md`, los
archivos referenciados, los eventos registrados por cada agente, las reglas
denegadas, la sintaxis Node.js y los escenarios simulados de `scenarios.mjs`.
En un evento `pull_request`,
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
- Antes de traer una skill o un servidor MCP externo, revisa su contenido, deja
  la copia canónica en `.agents/skills`, declara el servidor en ambos agentes y
  registra la skill en `skills-lock.json`.
- Actualiza esta guía cuando cambien eventos, comandos, confianza o límites.
