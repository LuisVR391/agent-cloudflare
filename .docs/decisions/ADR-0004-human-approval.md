# ADR-0004: Aprobación humana para mejoras sensibles

**Estado:** Aceptado

**Fecha:** 2026-07-30

## Contexto

Los agentes y supervisores futuros podrán detectar problemas y proponer cambios
en prompts, conocimiento, herramientas, pipelines y automatizaciones. Aplicar
esas propuestas directamente en producción permitiría que una salida no
confiable altere comportamiento empresarial, permisos o comunicaciones con
clientes sin revisión.

La trazabilidad exige distinguir una propuesta, su evaluación, la aprobación y
la versión que finalmente se publicó.

## Decisión

Los agentes pueden analizar y proponer mejoras, pero no aprobarlas ni
publicarlas por sí mismos.

Todo cambio sensible seguirá este flujo:

1. Registrar el problema y la evidencia.
2. Proponer un cambio identificable.
3. Ejecutar evaluaciones contra la versión vigente.
4. Mostrar resultados, riesgos y alcance a una persona autorizada.
5. Registrar aprobación o rechazo en backend.
6. Crear una versión inmutable.
7. Publicar de forma controlada y observable.
8. Conservar una ruta de rollback y auditoría.

La autorización se validará en backend. Ni el prompt, el modelo ni una
herramienta pueden otorgarse permisos o sustituir la aprobación. Los datos de
evaluación y publicación permanecerán aislados por organización y no incluirán
secretos ni información personal innecesaria.

Este control aplica, como mínimo, a agentes, prompts, versiones, conocimiento,
tools, pipelines, automatizaciones y cambios de producción.

## Consecuencias

### Positivas

- Una salida del modelo no cambia producción sin control humano.
- Cada versión puede vincularse con evidencia, evaluaciones y un aprobador.
- Publicación y rollback son acciones auditables.
- Las propuestas rechazadas siguen aportando trazabilidad sin alterar el
  runtime.

### Costos y obligaciones

- El flujo requiere estados explícitos y permisos de aprobación.
- Las evaluaciones y artefactos deben ser reproducibles y comparables.
- Publicar es una operación distinta de aprobar.
- Rollback debe restaurar una versión conocida sin borrar el historial.
- Automatizar evaluaciones no autoriza automatizar la aprobación.
- La implementación concreta pertenece a la Fase 5 y no se crea en este issue.

## Alternativas consideradas

- **Autoaprobación cuando una métrica mejora:** rechazada porque una evaluación
  incompleta no representa todos los riesgos empresariales o de seguridad.
- **Editar la versión vigente en sitio:** rechazada porque elimina
  reproducibilidad, atribución y rollback.
- **Usar el prompt como control:** rechazado porque las instrucciones al modelo
  no son una barrera de autorización.
- **Aprobación verbal o fuera del sistema:** rechazada porque no produce
  evidencia durable ni auditable.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md)
- [Contratos transversales](../architecture/contracts.md)
- [Roadmap de producto](../product/roadmap.md)
