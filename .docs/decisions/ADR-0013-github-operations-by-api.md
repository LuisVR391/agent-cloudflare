# ADR-0013: Operaciones de GitHub por API con autorización por clase

**Estado:** Aceptado

**Fecha:** 2026-08-13

## Contexto

[ADR-0005](./ADR-0005-shared-agent-guardrails.md) fijó un núcleo neutral de
guardrails que bloquea de forma determinista los efectos remotos de un agente.
Para GitHub, ese núcleo distinguía la CLI de la API: `gh pr create` quedaba
permitido y cualquier `gh api` con método `POST`, `PUT`, `PATCH` o `DELETE`
quedaba prohibido sin excepción, porque «altera el repositorio remoto sin dejar
la auditoría de un flujo revisado».

Esa frontera resultó ser accidental, no conceptual. Al publicar el catálogo de
servicios apareció el caso que la rompe:

- El cuerpo del PR debe llevar los encabezados que valida `npm run check`. Si se
  crea incompleto, corregirlo exige **editarlo**, y editarlo es un `PATCH`.
- La CLI instalada no puede hacerlo: `gh pr edit` consulta Projects clásicos,
  retirados por GitHub, y falla antes de enviar nada.
- Resultado: una operación permitida por la política —modificar el texto de un
  PR que el propio agente acaba de crear— quedaba imposible, mientras que la
  misma operación por CLI habría estado autorizada.

La prohibición tampoco protegía lo que decía proteger. El riesgo real no está en
el método HTTP, sino en el **efecto**: fusionar, cerrar, borrar, publicar un
release o escribir un secreto no se parecen a corregir un párrafo.

## Decisión

### La API es el camino de las operaciones con GitHub

Issues, PRs, comentarios y estado del CI se consultan y escriben contra
`https://api.github.com`. La CLI deja de ser el medio previsto; el token se
obtiene con `gh auth token` y se usa solo como credencial, nunca escrito en un
archivo, en la URL ni en un log.

La API es preferible por una razón que va más allá del bug: el método y el
endpoint quedan escritos en el comando, y es exactamente eso lo que el guardrail
puede leer para decidir.

### El bloqueo se define por efecto, no por método

| Operación | Tratamiento |
| --- | --- |
| Leer cualquier recurso | Permitida |
| Crear o editar PRs, issues y comentarios | Permitida |
| Fusionar, cerrar o reabrir | `AGENT_MERGE_CONFIRMED=1` |
| Borrar cualquier recurso | Prohibida |
| Releases, secretos, variables, `dispatches`, transferencia | Prohibida |

El cambio de estado se detecta por el endpoint `/pulls/:n/merge` o por el
`state` presente en el propio comando. De ahí una obligación: **el cuerpo que
cambia estado se escribe inline, no en un archivo**. En un archivo, el efecto
deja de ser visible para el hook y la autorización dejaría de significar algo.

### Crear un PR sigue auditando el diff

La auditoría de documentación, ADR y roadmap se disparaba con `gh pr create`.
Ahora también con `POST /repos/:owner/:repo/pulls`, de modo que publicar por la
API no evita la comprobación.

## Consecuencias

### Positivas

- Desaparece la asimetría que permitía crear un PR y prohibía corregirlo.
- El guardrail bloquea por efecto, que es lo que importa, y su mensaje explica
  qué autorización lo habilita cuando existe alguna.
- Un solo camino para GitHub hace el comportamiento del agente predecible y las
  llamadas comparables entre sesiones.

### Costos y obligaciones

- La detección del cambio de estado es textual: un `state` escondido en un
  archivo escaparía al hook. Por eso la regla exige escribirlo inline, y esa
  exigencia depende de que el agente la respete.
- `curl` es más verboso que la CLI y obliga a construir el JSON a mano.
- El token sigue dependiendo de `gh auth token`. Si se decide eliminar la CLI
  por completo, habrá que proveer la credencial por otra vía.
- Cada endpoint sensible nuevo de GitHub debe evaluarse contra esta tabla; la
  lista de prohibiciones no se descubre sola.

## Alternativas consideradas

- **Mantener toda mutación por API prohibida:** rechazada. Dejaba el flujo de
  entrega dependiendo de una CLI rota y obligaba a pedir intervención manual
  para corregir el texto de un PR propio.
- **Permitir toda mutación por API sin marca:** rechazada. Fusionar y cerrar son
  decisiones del usuario, y borrar es irreversible; el criterio de una marca por
  clase de efecto ya está fijado en [`AGENTS.md`](../../AGENTS.md).
- **Bloquear también la CLI `gh`:** descartada por ahora. La CLI conserva usos
  legítimos —leer checks, obtener el token— y bloquearla no añadiría seguridad,
  porque el guardrail ya evalúa `gh api` con las mismas reglas que `curl`.
- **Inspeccionar el archivo de `--data @` para detectar cambios de estado:**
  descartada. El hook analiza comandos, no el sistema de archivos; leer el
  archivo introduciría una condición de carrera entre la comprobación y el
  envío.

## Referencias

- [ADR-0005: Guardrails compartidos de agentes](./ADR-0005-shared-agent-guardrails.md)
- [Reglas compartidas](../../AGENTS.md)
- [Continuidad de agentes de codificación](../operations/agent-continuity.md)
- [Sunset de Projects clásicos](https://github.blog/changelog/2024-05-23-sunset-notice-projects-classic/)
