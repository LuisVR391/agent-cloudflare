# Roadmap de Agent Cloudflare

Este documento muestra el estado aceptado del producto en `main`. La
[guía de arquitectura y producto](../guia-arquitectura-producto.md) conserva
la visión y las explicaciones técnicas; este roadmap registra entregables,
dependencias, criterios de salida y evidencia verificable.

GitHub es la evidencia de ejecución. Un entregable solo se considera completado
cuando satisface sus criterios y el PR correspondiente está fusionado en
`main`.

## Estados

| Estado | Significado |
| --- | --- |
| Planificado | El entregable está acordado, pero no tiene implementación activa. |
| En progreso | Existe trabajo activo para satisfacer sus criterios. |
| Bloqueado | Una dependencia o autorización impide avanzar. |
| Completado | Los criterios están satisfechos y la evidencia está fusionada en `main`. |

## Estado general

| Fase | Estado | Dependencia | Criterio de salida |
| --- | --- | --- | --- |
| 0. Fundamentos | En progreso | Ninguna | Fundamentos documentales, datos, seguridad y entornos validados; staging preparado sin crear producción sin autorización. |
| 1. WhatsApp funcional | Planificado | Fase 0 | Mensajes de WhatsApp procesados de extremo a extremo con seguridad, durabilidad, inbox y handoff humano. |
| 2. CRM | Planificado | Fase 1 | El flujo comercial desde contacto hasta cita puede operarse y medirse desde el CRM. |
| 3. Agentes | Planificado | Fase 2 | Agentes versionados usan conocimiento y herramientas autorizadas con aislamiento y supervisión. |
| 4. Automatización | Planificado | Fase 3 | Procesos de seguimiento se ejecutan como Workflows durables, recuperables y observables. |
| 5. Mejora continua | Planificado | Fase 4 | Los cambios se evalúan, aprueban, publican y revierten de forma segura; el MVP queda cerrado. |
| 6. Expansión | Planificado | Fase 5 y MVP validado | El núcleo admite nuevos canales, paquetes empresariales y la evolución controlada a SaaS. |

## Fase 0 — Fundamentos

**Objetivo:** establecer las decisiones, datos, controles de acceso y entornos
necesarios para construir capacidades de producto sin comprometer el
aislamiento multiempresa.

| Entregable | Estado | Dependencia | Evidencia |
| --- | --- | --- | --- |
| Guía de arquitectura y producto | Completado | Ninguna | [Issue #1](https://github.com/LuisVR391/agent-cloudflare/issues/1) y [PR #2](https://github.com/LuisVR391/agent-cloudflare/pull/2) |
| Modelo de dominio | Completado | Guía rectora | [Issue #1](https://github.com/LuisVR391/agent-cloudflare/issues/1) y [PR #2](https://github.com/LuisVR391/agent-cloudflare/pull/2) |
| Propiedad de datos | Completado | Modelo de dominio | [Issue #1](https://github.com/LuisVR391/agent-cloudflare/issues/1) y [PR #2](https://github.com/LuisVR391/agent-cloudflare/pull/2) |
| Contratos transversales | Completado | Modelo de dominio y propiedad de datos | [Issue #1](https://github.com/LuisVR391/agent-cloudflare/issues/1) y [PR #2](https://github.com/LuisVR391/agent-cloudflare/pull/2) |
| Roadmap verificable | Completado | Fundamentos documentales iniciales | [Issue #3](https://github.com/LuisVR391/agent-cloudflare/issues/3) y [PR #8](https://github.com/LuisVR391/agent-cloudflare/pull/8) |
| Reglas de desarrollo y ADRs | Completado | Roadmap | [Issue #4](https://github.com/LuisVR391/agent-cloudflare/issues/4) y [PR #9](https://github.com/LuisVR391/agent-cloudflare/pull/9) |
| Continuidad de agentes con skills y hooks de Codex | Completado | Reglas de desarrollo y ADRs | [Issue #10](https://github.com/LuisVR391/agent-cloudflare/issues/10) y [PR #11](https://github.com/LuisVR391/agent-cloudflare/pull/11) |
| Continuidad de agentes con Claude Code sobre guardrails compartidos | Completado | Continuidad de agentes con Codex ([Issue #10](https://github.com/LuisVR391/agent-cloudflare/issues/10)) | [Issue #12](https://github.com/LuisVR391/agent-cloudflare/issues/12), [PR #11](https://github.com/LuisVR391/agent-cloudflare/pull/11) y [ADR-0005](../decisions/ADR-0005-shared-agent-guardrails.md) |
| D1, migraciones y pruebas locales multiempresa | Completado | Reglas y ADRs de #4 | [Issue #5](https://github.com/LuisVR391/agent-cloudflare/issues/5), [PR #13](https://github.com/LuisVR391/agent-cloudflare/pull/13) y [ADR-0006](../decisions/ADR-0006-d1-schema-conventions.md) |
| Autenticación, roles y aislamiento multiempresa | Completado | D1 y migraciones de #5 | [Issue #6](https://github.com/LuisVR391/agent-cloudflare/issues/6), [PR #14](https://github.com/LuisVR391/agent-cloudflare/pull/14), [ADR-0007](../decisions/ADR-0007-better-auth-and-organization-context.md), [modelo de seguridad](../architecture/security-model.md) y [operación](../operations/authentication.md) |
| Entornos y staging | Planificado | Fundamentos anteriores (#4, #5 y #6) | [Issue #7](https://github.com/LuisVR391/agent-cloudflare/issues/7) |
| Visión especializada de producto | Planificado | Guía rectora | Issue aún no creado |
| Overview de arquitectura | Planificado | Guía rectora y ADRs | Issue aún no creado |

El estado completado de cada entregable entra en vigor al fusionarse en `main`
el PR enlazado como evidencia.

**Criterio de salida:** la visión y el overview especializados están vigentes;
las decisiones fundamentales están aceptadas; D1 y sus migraciones funcionan en
local y pruebas; la autenticación, autorización y separación por organización
están verificadas; y existe una ruta reproducible y aislada hacia staging.

## Fase 1 — WhatsApp funcional

**Objetivo:** recibir y responder mensajes de WhatsApp de manera segura,
asíncrona y durable, con visibilidad operativa e intervención humana.

**Dependencia:** Fase 0 completada.

**Entregables resumidos:** webhook con verificación de token y firma,
normalización y deduplicación, colas de entrada y salida, conversación durable
con orden y buffer, inbox y handoff humano.

**Criterio de salida:** un mensaje válido recorre el flujo completo, los
reintentos no duplican efectos, la conversación conserva orden y estado, y un
colaborador autorizado puede verla e intervenir.

## Fase 2 — CRM

**Objetivo:** convertir las conversaciones en un proceso comercial operable y
medible.

**Dependencia:** Fase 1 completada.

**Entregables resumidos:** contactos e identidades, conversaciones y
asignaciones, equipos, pipeline y oportunidades, notas y tareas, citas y
métricas iniciales.

**Criterio de salida:** un colaborador autorizado puede gestionar, sin cruzar
organizaciones, el recorrido de un contacto desde la conversación hasta una
cita y consultar métricas básicas del proceso.

## Fase 3 — Agentes

**Objetivo:** permitir que cada empresa configure agentes seguros, trazables y
adaptados a su conocimiento.

**Dependencia:** Fase 2 completada.

**Entregables resumidos:** configuración y versiones de agentes, RAG aislado
por empresa, herramientas con autorización en backend, routing, memoria
permitida, modo supervisado, presupuesto y failover.

**Criterio de salida:** una versión identificable del agente responde con
conocimiento autorizado, solo ejecuta herramientas permitidas y deja evidencia
observable de decisiones, fallos y costos.

## Fase 4 — Automatización

**Objetivo:** ejecutar procesos largos de atención y seguimiento sin depender
de una solicitud o proceso efímero.

**Dependencia:** Fase 3 completada.

**Entregables resumidos:** reglas y disparadores, Workflows durables,
seguimientos, confirmaciones, campañas, reactivación y recordatorios.

**Criterio de salida:** las automatizaciones autorizadas sobreviven esperas y
fallos, reintentan sin duplicar efectos y pueden observarse, detenerse y
recuperarse.

## Fase 5 — Mejora continua

**Objetivo:** mejorar agentes y flujos con evidencia y control humano, y cerrar
el alcance del MVP.

**Dependencia:** Fase 4 completada.

**Entregables resumidos:** supervisión, evaluaciones, propuestas con evidencia,
aprobación humana, publicación versionada, analítica y rollback.

**Criterio de salida:** una propuesta puede compararse con la versión vigente,
ser aprobada por una persona autorizada, publicarse gradualmente y revertirse;
además, todos los criterios del MVP están verificados de extremo a extremo.

## Fase 6 — Expansión

**Objetivo:** extender el producto más allá del primer canal y giro sin crear
forks del núcleo.

**Dependencia:** Fase 5 completada y MVP validado.

**Entregables resumidos:** adaptadores para nuevos canales, paquetes
empresariales configurables y evolución de instancias aisladas hacia una
operación SaaS multiempresa.

**Criterio de salida:** al menos un nuevo canal y un nuevo paquete empresarial
se integran mediante contratos comunes, y la evolución SaaS mantiene
aislamiento, seguridad, portabilidad y operación verificables.

## Mantenimiento

Todo PR que complete, bloquee o cambie el estado de un entregable debe
actualizar su fila en este roadmap y enlazar el issue y el PR correspondientes
como evidencia. Los cambios de estado no usan porcentajes ni se anticipan antes
de que exista trabajo verificable.
