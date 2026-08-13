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
| 0. Fundamentos | Completado | Ninguna | Fundamentos documentales, datos, seguridad y entornos validados; staging preparado sin crear producción sin autorización. |
| 1. WhatsApp funcional | Completado | Fase 0 | Mensajes de WhatsApp procesados de extremo a extremo con seguridad, durabilidad, inbox y handoff humano. |
| 2. CRM | En progreso | Fase 1 | El flujo comercial desde contacto hasta cita puede operarse y medirse desde el CRM. |
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
| Entornos y staging | Completado | Fundamentos anteriores (#4, #5 y #6) | [Issue #7](https://github.com/LuisVR391/agent-cloudflare/issues/7) y [PR #15](https://github.com/LuisVR391/agent-cloudflare/pull/15) |
| Visión especializada de producto | Completado | Guía rectora | [Issue #16](https://github.com/LuisVR391/agent-cloudflare/issues/16) y [PR #17](https://github.com/LuisVR391/agent-cloudflare/pull/17) |
| Overview de arquitectura | Completado | Guía rectora y ADRs | [PR #18](https://github.com/LuisVR391/agent-cloudflare/pull/18) |

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

**Seguimiento:** [Issue #19](https://github.com/LuisVR391/agent-cloudflare/issues/19),
con cortes de persistencia e inbox [#22](https://github.com/LuisVR391/agent-cloudflare/issues/22),
runtime durable [#23](https://github.com/LuisVR391/agent-cloudflare/issues/23),
salida humana inicial [#21](https://github.com/LuisVR391/agent-cloudflare/issues/21),
corrección y reconciliación de salida [#25](https://github.com/LuisVR391/agent-cloudflare/issues/25) y
medios/validación [#20](https://github.com/LuisVR391/agent-cloudflare/issues/20).

| Entregable | Estado | Dependencia | Evidencia |
| --- | --- | --- | --- |
| Persistencia canónica e inbox consultable | Completado | Fase 0 | [Issue #22](https://github.com/LuisVR391/agent-cloudflare/issues/22) y [PR #24](https://github.com/LuisVR391/agent-cloudflare/pull/24) |
| Runtime durable y actualización en vivo | Completado | Persistencia de #22 | [Issue #23](https://github.com/LuisVR391/agent-cloudflare/issues/23) y [PR #24](https://github.com/LuisVR391/agent-cloudflare/pull/24) |
| Salida humana y reconciliación de entregas | Completado | Runtime de #23 | [Issue #21](https://github.com/LuisVR391/agent-cloudflare/issues/21) y [PR #24](https://github.com/LuisVR391/agent-cloudflare/pull/24) |
| Corrección del envío humano y `message.sent` | Completado | Salida de #21 | [Issue #25](https://github.com/LuisVR391/agent-cloudflare/issues/25) y [PR #26](https://github.com/LuisVR391/agent-cloudflare/pull/26) |
| Contrato de envío y reconciliación de estados | Completado | Corrección de #25 | [PR #27](https://github.com/LuisVR391/agent-cloudflare/pull/27) |
| Medios en R2 y validación del recorrido real | Completado | Contrato de envío | [Issue #20](https://github.com/LuisVR391/agent-cloudflare/issues/20) y [PR #29](https://github.com/LuisVR391/agent-cloudflare/pull/29) |

**Entregables resumidos:** adaptador bidireccional de Zernio, webhook con firma
HMAC, resolución confiable de cuenta y organización, normalización y
deduplicación, estados de entrega, colas de entrada y salida, conversación
durable con orden y buffer, inbox y handoff humano.

**Criterio de salida:** un mensaje válido recorre Zernio y la infraestructura
Cloudflare de extremo a extremo, los reintentos no duplican recepción ni
envío, la conversación conserva orden y estado, y un colaborador autorizado
puede verla e intervenir desde Agent Cloudflare.

**Estado:** completado el 2026-08-12, validado con tráfico real en staging
sobre la versión `0997e8f9-c9e1-4d21-a316-6cadeb9ea3ab` y las migraciones
`0001` a `0009`:

| Criterio | Evidencia |
| --- | --- |
| Recepción única y con orden | Mensajes de texto, imagen y audio procesados una sola vez; eventos en `processed` sin reintentos. |
| Respuesta humana entregada | Recorrido `En cola → Enviado → Entregado → Leído` con los estados reconciliados desde el canal. |
| Reintentos sin efectos duplicados | Idempotencia por clave estable y deduplicación de eventos verificadas en pruebas y en staging. |
| Medios conservados | Imagen y audio copiados a R2 bajo el prefijo de su organización y descargables desde el inbox. |
| Aislamiento entre organizaciones | Consultas y descargas acotadas por organización activa, cubiertas por pruebas. |

Los mensajes salientes anteriores a la corrección del contrato de envío
permanecen en `delivery_unknown`: no conservan el identificador del proveedor y
vincularlos por contenido o proximidad temporal está prohibido. El producto no
emite acuses de lectura hacia el contacto, por la limitación de coexistencia
descrita en el [canal de Zernio](../modules/zernio-whatsapp-channel.md).

## Fase 2 — CRM

**Objetivo:** convertir las conversaciones en un proceso comercial operable y
medible.

**Dependencia:** Fase 1 completada.

**Seguimiento:** [Issue #33](https://github.com/LuisVR391/agent-cloudflare/issues/33),
con cortes de contactos [#34](https://github.com/LuisVR391/agent-cloudflare/issues/34),
equipo y asignación [#35](https://github.com/LuisVR391/agent-cloudflare/issues/35),
pipeline y oportunidades [#36](https://github.com/LuisVR391/agent-cloudflare/issues/36),
notas y tareas [#37](https://github.com/LuisVR391/agent-cloudflare/issues/37),
citas [#38](https://github.com/LuisVR391/agent-cloudflare/issues/38) y
métricas iniciales [#39](https://github.com/LuisVR391/agent-cloudflare/issues/39).

| Entregable | Estado | Dependencia | Evidencia |
| --- | --- | --- | --- |
| Contactos con ficha, teléfono y etiquetas | Completado | Fase 1 | [Issue #34](https://github.com/LuisVR391/agent-cloudflare/issues/34) y [PR #41](https://github.com/LuisVR391/agent-cloudflare/pull/41) |
| Equipo, invitaciones y asignación de conversaciones | Completado | Contactos de #34 | [Issue #35](https://github.com/LuisVR391/agent-cloudflare/issues/35), [PR #44](https://github.com/LuisVR391/agent-cloudflare/pull/44) y [ADR-0011](../decisions/ADR-0011-collaborator-invitations.md) |
| Servicios, pipeline y oportunidades | Planificado | Contactos de #34 | [Issue #36](https://github.com/LuisVR391/agent-cloudflare/issues/36) y [ADR-0010](../decisions/ADR-0010-crm-commercial-model.md) |
| Notas y tareas con responsable | Planificado | Equipo de #35 | [Issue #37](https://github.com/LuisVR391/agent-cloudflare/issues/37) |
| Citas desde la conversación | Planificado | Equipo de #35 y pipeline de #36 | [Issue #38](https://github.com/LuisVR391/agent-cloudflare/issues/38) |
| Métricas iniciales del proceso | Planificado | Entregables #36, #37 y #38 | [Issue #39](https://github.com/LuisVR391/agent-cloudflare/issues/39) y [ADR-0012](../decisions/ADR-0012-initial-metrics.md) |

La evidencia de un entregable `Planificado` es su issue, no una capacidad
disponible. Cada corte pasa a `Completado` al fusionarse en `main` el PR que
satisface su criterio, y agrega ese PR a su fila.

**Entregables resumidos:** contactos e identidades, conversaciones y
asignaciones, equipos, pipeline y oportunidades, notas y tareas, citas y
métricas iniciales.

**Decisiones de la fase:**
[ADR-0011](../decisions/ADR-0011-collaborator-invitations.md) está `Aceptado`
desde el corte de equipo. [ADR-0010](../decisions/ADR-0010-crm-commercial-model.md)
y [ADR-0012](../decisions/ADR-0012-initial-metrics.md) siguen `Propuesto`; cada
corte cambia a `Aceptado` el ADR que adopta.

**Requisito transversal:** el catálogo de permisos se siembra hoy únicamente
durante la instalación, de modo que una organización ya instalada no recibiría
los permisos que introduce un corte. Cada corte añade una migración aditiva que
inserta sus permisos y los concede a los roles existentes por `role_key`, y una
prueba que verifica que una instalación nueva y una migrada producen el mismo
catálogo. La misma regla aplica a la siembra por organización del pipeline
inicial.

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
