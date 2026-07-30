# Continuidad de agentes con Codex

Esta guía describe la capa repo-local que ayuda a Codex a aplicar las reglas,
validaciones y trazabilidad de Agent Cloudflare de forma consistente. La
[fuente normativa sigue siendo `AGENTS.md`](../../AGENTS.md); los skills y hooks
solo cargan contexto, automatizan verificaciones y detienen riesgos
inequívocos.

## Componentes

| Componente | Responsabilidad |
| --- | --- |
| [Skill de entrega](../../.agents/skills/deliver-agent-cloudflare-change/SKILL.md) | Organiza inspección, alcance, implementación, documentación, validación y publicación. |
| [Política mecánica](../../.codex/agent-policy.json) | Declara fuentes de verdad, rutas, secretos, comandos bloqueados y mapa documental. |
| [Configuración de hooks](../../.codex/hooks.json) | Registra los eventos repo-locales que ejecuta Codex. |
| [Ejecutor](../../.codex/hooks/project-guard.mjs) | Evalúa cada evento sin registrar el prompt, payload o secreto recibido. |
| [Validador](../../.codex/hooks/validate-agent-config.mjs) | Comprueba estructura, referencias, configuración y cuerpo del PR en CI. |
| [Pruebas simuladas](../../.codex/hooks/project-guard.scenarios.mjs) | Verifica decisiones permitidas, bloqueos, recordatorios y cierre de turno. |

La configuración es específica de Codex. La adaptación para Claude queda fuera
de este entregable y se realizará después de validar este flujo.

## Descubrimiento y confianza

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

## Comportamiento por evento

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

- despliegues que no sean `--dry-run`;
- ejecución remota de D1 y eliminación de recursos Cloudflare;
- `git reset --hard`, `git clean` forzado y force push;
- cualquier `git push` sin confirmación explícita del usuario;
- publicación de `.env`, `.dev.vars`, llaves privadas y archivos equivalentes;
- edición o eliminación de migraciones existentes.

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

Los hooks fallan abiertos si su propia lectura o ejecución interna falla, salvo
cuando ya reconocieron una acción prohibida. Esto evita inmovilizar el
repositorio por un fallo del guardrail; el CI sigue siendo el control
determinista.

### Después de editar y al cerrar

`PostToolUse` sugiere documentos relacionados una sola vez por turno. `Stop`
exige que la entrega incluya `Documentación`, `ADR`, `Roadmap` y `Validación`.
Si faltan, solicita una sola continuación; `stop_hook_active` evita un bucle.

Los marcadores de deduplicación se guardan bajo el directorio temporal del
sistema. No se persisten prompts, respuestas, comandos completos ni secretos.

## Validación determinista

Ejecuta:

```bash
npm run check:agents
npm run check
git diff --check
```

`check:agents` valida el frontmatter y metadata del skill, los JSON, los
archivos referenciados, la sintaxis Node.js y once escenarios simulados. En un
evento `pull_request`, también exige contenido real bajo las secciones
`Documentación`, `ADR`, `Roadmap` y `Validación`.

La plantilla de PR incluye esas secciones. Los comentarios HTML no cuentan
como contenido y una sección vacía falla el CI.

## Mantenimiento

- Actualiza la política y sus pruebas en el mismo PR.
- Agrega un caso de regresión por cada nueva regla de bloqueo.
- Mantén las descripciones del skill enfocadas para que la invocación implícita
  no se active en preguntas informativas.
- Prefiere advertencias para decisiones contextuales y bloqueos para riesgos de
  alta confianza.
- No conviertas el hook en una segunda copia de `AGENTS.md`.
- Actualiza esta guía cuando cambien eventos, comandos, confianza o límites.
