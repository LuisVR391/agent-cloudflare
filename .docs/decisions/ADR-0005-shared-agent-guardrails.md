# ADR-0005: Núcleo neutral de guardrails para agentes de codificación

**Estado:** Aceptado

**Fecha:** 2026-07-30

## Contexto

El repositorio incorporó una capa repo-local para que Codex aplicara las reglas
de `AGENTS.md` con contexto automático, bloqueos de alto riesgo, recordatorios
documentales y un cierre trazable. Esa capa quedó dentro de `.codex/`: política
mecánica, ejecutor de hooks, escenarios simulados y validador de CI.

Al incorporar Claude Code aparece la misma necesidad con un contrato distinto.
Los eventos y el formato de decisión coinciden en lo esencial, pero las
herramientas no: Codex edita con `apply_patch` y entrega el parche completo en
`tool_input.command`, mientras Claude Code usa `Edit` y `Write` con una ruta
absoluta en `tool_input.file_path`. Además, Claude Code identifica el turno con
`prompt_id`, descubre el skill en `.claude/skills` y admite reglas de permisos
declarativas que Codex no tiene.

Duplicar la capa por agente habría creado dos políticas, dos ejecutores y dos
conjuntos de pruebas que divergen en silencio. Una regla corregida en una copia
dejaría de aplicarse en la otra sin que ningún control lo detecte, y
`AGENTS.md` perdería su condición de fuente única al competir con dos
interpretaciones mecánicas distintas.

## Decisión

La lógica de guardrails vive una sola vez en `.agents/guard/` y es neutral
respecto al agente:

- `policy.json` declara fuentes de verdad, prefijos, patrones sensibles,
  comandos bloqueados y mapa documental.
- `project-guard.mjs` evalúa cada evento y normaliza las herramientas de
  edición de todos los agentes soportados a operaciones `{ action, path }` con
  rutas relativas al repositorio.
- `scenarios.mjs` cubre las decisiones con las herramientas de ambos agentes.
- `validate-agent-config.mjs` verifica la configuración de todas las
  integraciones registradas.

Cada agente aporta únicamente un adaptador: el archivo de configuración que su
herramienta lee (`.codex/hooks.json`, `.claude/settings.json`) y un entrypoint
de pocas líneas que delega en `runHook` declarando su identidad y la forma de
invocar el skill. Un adaptador no contiene reglas, umbrales ni mensajes de
bloqueo.

El skill de entrega permanece en `.agents/skills/` y las integraciones lo
alcanzan por symlink, no por copia.

Una integración nueva se agrega registrando eventos, escribiendo su adaptador,
extendiendo la normalización de herramientas si su contrato lo requiere y
añadiendo escenarios de regresión. No se acepta una copia paralela de la
política ni del ejecutor.

Esta decisión gobierna la capa de herramientas de desarrollo. No modifica la
arquitectura del producto ni ninguna decisión de ADR-0001 a ADR-0004.

## Consecuencias

### Positivas

- Una regla se escribe, prueba y corrige una sola vez para todos los agentes.
- Las diferencias entre agentes quedan aisladas en adaptadores auditables.
- El validador detecta configuración ausente, symlinks rotos y referencias
  documentales inválidas en cualquier integración.
- `AGENTS.md` conserva una única interpretación mecánica.

### Costos y obligaciones

- Un cambio en el núcleo afecta a ambos agentes y exige escenarios que cubran
  las herramientas de los dos.
- Codex debe volver a confiar sus hooks porque el script referenciado cambió de
  contenido, aunque su ruta se conserve.
- El symlink del skill requiere `core.symlinks` habilitado al clonar en
  Windows.
- Las capacidades exclusivas de un agente, como las reglas `permissions.deny`
  de Claude Code, no tienen equivalente en el otro y deben documentarse como
  asimetrías explícitas en vez de darse por universales.
- Los hooks siguen fallando abiertos ante un error interno; el CI continúa
  siendo el control determinista.

## Alternativas consideradas

- **Copia independiente por agente:** rechazada porque duplica política,
  ejecutor y pruebas, y garantiza deriva sin detección.
- **Mantener el núcleo en `.codex/` e importarlo desde `.claude/`:** rechazada
  porque deja la lógica compartida bajo el nombre de un proveedor y sugiere una
  jerarquía que no existe entre integraciones.
- **Copiar el skill en cada directorio de agente:** rechazada porque separa las
  instrucciones de entrega en dos textos que hay que sincronizar a mano.
- **Sustituir el hook por reglas de permisos declarativas:** rechazada porque
  no expresan auditoría de diff, impacto documental ni el cierre trazable, y no
  existen en todos los agentes.

## Referencias

- [Reglas compartidas](../../AGENTS.md)
- [Continuidad de agentes de codificación](../operations/agent-continuity.md)
- [Roadmap de producto](../product/roadmap.md)
