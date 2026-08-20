# ADR-0016: Ciclo de entrega multi-agente con verificación independiente

**Estado:** Aceptado

**Fecha:** 2026-08-19

## Contexto

[ADR-0005](./ADR-0005-shared-agent-guardrails.md) estableció un núcleo neutral
de guardrails y un skill de entrega compartido por Codex y Claude Code. Esa capa
resolvió qué reglas se aplican y cómo se auditan, pero dejó abierta la forma del
trabajo: un solo turno investiga, decide, implementa, prueba y juzga el
resultado.

Esa concentración tiene dos costos comprobables. El primero es de criterio:
quien escribió el código evalúa su propio cumplimiento, y una explicación que ya
tiene en contexto convierte al juez en cómplice. El segundo es de contexto: el
turno que ejecuta `npm run check` absorbe el volcado completo de dos suites, dos
compilaciones y un `deploy --dry-run`, y vuelve a leer esa salida en cada turno
posterior de la misma entrega.

Claude Code puede delegar en subagentes con herramientas, modelo y restricciones
propias. Codex no ofrece un equivalente con el mismo contrato: sus agentes se
declaran en otro formato y no admiten las mismas restricciones por definición.
Exigir paridad obligaría a escribir cada rol dos veces y a sincronizar a mano
dos textos que divergirían en silencio, que es exactamente lo que ADR-0005
rechazó para la política.

## Decisión

El repositorio incorpora una capa de ciclo de entrega que **solo consume Claude
Code**, sin tocar el núcleo neutral ni el skill compartido.

- Los roles se declaran en `.claude/agents/`: tres implementadores acotados por
  dominio —`worker-backend`, `client-ui` y `d1-schema`— y dos agentes sin
  capacidad de escritura, `revisor` y `corredor`.
- **Quien implementa no verifica.** El `revisor` no recibe herramientas de
  edición y su definición registra el adaptador `.claude/hooks/readonly-guard.mjs`
  en `PreToolUse`. Ese adaptador delega en el núcleo con un rol que evalúa una
  lista de comandos permitidos: cualquier binario, argumento o forma de shell que
  escriba se rechaza.
- **El corredor absorbe la salida larga.** Ejecuta los comandos del ciclo con un
  modelo declarado explícitamente, y devuelve un marcador en vez del volcado.
- El plan de la rama vive fuera de git, en `.plans/<slug>/SPEC.md`, y
  `SessionStart` lo recupera cuando su frontmatter corresponde a la rama actual.
- La asimetría es deliberada y se documenta: Codex conserva el skill de entrega y
  la ruta lineal, que siguen siendo suficientes para cumplir `AGENTS.md`.

Las reglas siguen viviendo una sola vez en `.agents/guard/`. El rol de solo
lectura es una regla del núcleo, no del adaptador, y llega con sus escenarios de
regresión. Ningún subagente ejecuta un efecto remoto: el push, el despliegue, la
migración remota y la fusión siguen siendo del turno principal, que es el único
que puede pedir la autorización.

Esta decisión gobierna la capa de herramientas de desarrollo. No modifica la
arquitectura del producto ni ninguna decisión de ADR-0001 a ADR-0015.

## Consecuencias

### Positivas

- El cumplimiento de un criterio lo evalúa quien no lo implementó, y esa
  independencia está garantizada por herramientas ausentes, no por una
  instrucción del prompt.
- La salida de las suites deja de ocupar el contexto de la entrega completa.
- Cada dominio recibe solo las reglas que le tocan, en vez de una copia del
  reglamento entero.
- El validador detecta un subagente ausente, un rol de lectura con herramientas
  de escritura o un revisor sin su hook.

### Costos y obligaciones

- La capa es asimétrica: una entrega hecha con Codex sigue el camino lineal y no
  reproduce el ciclo. La documentación debe decirlo en vez de dar por universal
  lo que solo un agente ofrece.
- Hay más superficie que mantener: cinco definiciones de rol que deben seguir
  reflejando `AGENTS.md` sin convertirse en una segunda copia suya.
- El guardrail no observa las llamadas a herramientas MCP, así que un subagente
  que escriba por esa vía queda fuera de `PreToolUse`. El control sigue siendo el
  diff y `npm run check`.
- El rol de solo lectura falla cerrado: un comando de inspección legítimo que no
  esté en la lista se rechaza y hay que declararlo en la política.

## Alternativas consideradas

- **Replicar los subagentes en Codex:** rechazada porque duplica cada prompt en
  dos formatos sin generador común y garantiza deriva, el mismo motivo por el
  que ADR-0005 rechazó duplicar la política.
- **Confiar la independencia del revisor a su prompt:** rechazada porque una
  instrucción no es un control. Un agente con herramientas de escritura termina
  corrigiendo lo que debía reportar.
- **Restringir al revisor con una lista de comandos prohibidos:** rechazada
  porque cualquier binario no previsto la evade; la lista de permitidos falla
  cerrado.
- **Registrar el hook de solo lectura en `.claude/settings.json`:** rechazada
  porque aplicaría a todos los turnos, incluidos los que deben implementar.
- **Versionar el SPEC y los findings:** rechazada porque son artefactos de la
  rama que los produce. Lo permanente vive en el issue, el cuerpo del PR y
  `.docs/`.

## Referencias

- [Reglas compartidas](../../AGENTS.md)
- [Continuidad de agentes de codificación](../operations/agent-continuity.md)
- [ADR-0005: Núcleo neutral de guardrails](./ADR-0005-shared-agent-guardrails.md),
  que esta decisión extiende sin sustituir
- [ADR-0004: Aprobación humana para mejoras sensibles](./ADR-0004-human-approval.md)
- [Issue #67](https://github.com/LuisVR391/agent-cloudflare/issues/67)
