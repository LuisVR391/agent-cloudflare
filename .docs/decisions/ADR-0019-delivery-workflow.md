# ADR-0019 — Entrega con documentación vigente y seguimiento en Notion

**Estado:** Aceptado

Entra en vigor cuando se fusione este cambio en `main`.

## Contexto

El ciclo de [ADR-0016](./ADR-0016-multi-agent-delivery-cycle.md) dependía de
roles, SPEC y hooks de sesión. El flujo de Dialow conserva la revisión y las
pruebas con reglas compartidas, historial en GitHub y pendientes en Notion.

## Decisión

- `AGENTS.md` define las reglas. El equipo elige cómo planificar y dividir el
  trabajo. Se retiran la plantilla obligatoria, los roles fijos y los hooks
  que cargaban el ciclo o imprimían un formato de cierre.
- Notion registra pendientes, acuerdos de alcance y dependencias. GitHub
  registra la ejecución y la revisión. `.docs/` explica el comportamiento
  vigente y la operación por módulos. Se actualiza la documentación afectada
  junto con el código.
- El hook Git comprueba documentación en los commits de cada push. CI comprueba
  el alcance completo del PR. Antes de fusionar y antes de desplegar se revisa
  el código y se verifican las pruebas sobre el candidato.
- Los guardrails compartidos de
  [ADR-0005](./ADR-0005-shared-agent-guardrails.md) y la política de
  [GitHub por API](./ADR-0013-github-operations-by-api.md) siguen vigentes.
  La conciliación de Notion queda a cargo de quien entrega el cambio.

## Consecuencias

El hook Git requiere instalación por clon. La comprobación por rutas detecta
archivos relacionados y la revisión comprueba que su contenido explique el
cambio. CI aporta evidencia de pruebas y el runbook conserva las autorizaciones
y verificaciones propias de staging.

## Alternativas consideradas

Mantener el ciclo anterior exigiría conservar instrucciones, roles y eventos
que solo una herramienta podía ejecutar completos. Automatizar la edición de
Notion desde los hooks perdería la decisión humana sobre el alcance y las
tarjetas relacionadas.

## Referencias

Sustituye [ADR-0016](./ADR-0016-multi-agent-delivery-cycle.md) al entrar en
vigor. El [runbook de entrega](../operations/entrega.md) explica la operación
actual. Seguimiento en [issue #75](https://github.com/LuisVR391/agent-cloudflare/issues/75).
