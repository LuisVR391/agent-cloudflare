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
| 2. CRM | Completado | Fase 1 | El flujo comercial desde contacto hasta cita puede operarse y medirse desde el CRM. |
| 3. Agentes | En progreso | Fase 2 | Agentes versionados usan conocimiento y herramientas autorizadas con aislamiento y supervisión. |
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
| Servicios, pipeline y oportunidades | Completado | Contactos de #34 | [Issue #36](https://github.com/LuisVR391/agent-cloudflare/issues/36), [ADR-0010](../decisions/ADR-0010-crm-commercial-model.md) y los cortes [PR #45](https://github.com/LuisVR391/agent-cloudflare/pull/45), [PR #47](https://github.com/LuisVR391/agent-cloudflare/pull/47) y el de oportunidades |
| Notas y tareas con responsable | Completado | Equipo de #35 | [Issue #37](https://github.com/LuisVR391/agent-cloudflare/issues/37), [PR #49](https://github.com/LuisVR391/agent-cloudflare/pull/49) y el [módulo de notas y tareas](../modules/appointments-and-tasks.md) |
| Citas desde la conversación | Completado | Equipo de #35 y pipeline de #36 | [Issue #38](https://github.com/LuisVR391/agent-cloudflare/issues/38), los cortes [PR #50](https://github.com/LuisVR391/agent-cloudflare/pull/50) y el de la agenda, y el [módulo de notas, tareas y citas](../modules/appointments-and-tasks.md) |
| Métricas iniciales del proceso | Completado | Entregables #36, #37 y #38 | [Issue #39](https://github.com/LuisVR391/agent-cloudflare/issues/39), [PR #52](https://github.com/LuisVR391/agent-cloudflare/pull/52), [ADR-0012](../decisions/ADR-0012-initial-metrics.md) y el [módulo de métricas iniciales](../modules/initial-metrics.md) |

La evidencia de un entregable `Planificado` es su issue, no una capacidad
disponible. `En progreso` significa que parte de su alcance ya está en `main` y
la fila dice exactamente cuál. Cada corte pasa a `Completado` al fusionarse en
`main` el PR que satisface su criterio, y agrega ese PR a su fila.

**Entregables resumidos:** contactos e identidades, conversaciones y
asignaciones, equipos, pipeline y oportunidades, notas y tareas, citas y
métricas iniciales.

**Decisiones de la fase:**
[ADR-0011](../decisions/ADR-0011-collaborator-invitations.md) está `Aceptado`
desde el corte de equipo. [ADR-0010](../decisions/ADR-0010-crm-commercial-model.md)
está `Aceptado` desde el corte de oportunidades, que adopta su decisión central:
la oportunidad es lo que recorre un pipeline configurable. La zona horaria de la
organización que ese mismo ADR decide entró con el primer corte de las citas de
#38, su primer consumidor real.
[ADR-0012](../decisions/ADR-0012-initial-metrics.md) está `Aceptado` desde el
corte de métricas, que publica su superficie con rango obligatorio y acotado sin
crear ninguna tabla de agregación.

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

**Seguimiento:** [Issue #53](https://github.com/LuisVR391/agent-cloudflare/issues/53),
con cortes de agentes y versiones [#54](https://github.com/LuisVR391/agent-cloudflare/issues/54),
ejecución en la conversación [#55](https://github.com/LuisVR391/agent-cloudflare/issues/55),
herramientas autorizadas [#56](https://github.com/LuisVR391/agent-cloudflare/issues/56),
conocimiento y recuperación aislada [#57](https://github.com/LuisVR391/agent-cloudflare/issues/57),
routing entre agentes [#58](https://github.com/LuisVR391/agent-cloudflare/issues/58),
memoria autorizada del contacto [#59](https://github.com/LuisVR391/agent-cloudflare/issues/59),
modo supervisado [#60](https://github.com/LuisVR391/agent-cloudflare/issues/60) y
presupuesto, costos y failover [#61](https://github.com/LuisVR391/agent-cloudflare/issues/61).

| Entregable | Estado | Dependencia | Evidencia |
| --- | --- | --- | --- |
| Agentes configurables y sus versiones | Completado | Fase 2 | [Issue #54](https://github.com/LuisVR391/agent-cloudflare/issues/54), los cortes [PR #63](https://github.com/LuisVR391/agent-cloudflare/pull/63) y el del panel, [ADR-0014](../decisions/ADR-0014-configurable-agents-and-published-versions.md) y el [módulo de agentes y versiones](../modules/agents-and-versions.md) |
| Ejecución del agente en la conversación | Completado | Agentes de #54 | [Issue #55](https://github.com/LuisVR391/agent-cloudflare/issues/55), [PR #66](https://github.com/LuisVR391/agent-cloudflare/pull/66), [ADR-0015](../decisions/ADR-0015-model-provider-and-agent-runs.md), el [módulo de proveedores de modelo](../modules/model-providers.md) y el [runtime de conversación](../modules/conversation-runtime.md) |
| Herramientas con autorización en backend | Planificado | Ejecución de #55 | [Issue #56](https://github.com/LuisVR391/agent-cloudflare/issues/56) |
| Conocimiento empresarial y recuperación aislada | Planificado | Ejecución de #55 | [Issue #57](https://github.com/LuisVR391/agent-cloudflare/issues/57) |
| Routing entre agentes | Planificado | Ejecución de #55 | [Issue #58](https://github.com/LuisVR391/agent-cloudflare/issues/58) |
| Memoria autorizada del contacto | Planificado | Ejecución de #55 | [Issue #59](https://github.com/LuisVR391/agent-cloudflare/issues/59) |
| Modo supervisado con aprobación humana | Planificado | Ejecución de #55 | [Issue #60](https://github.com/LuisVR391/agent-cloudflare/issues/60) |
| Presupuesto, costos y failover | Planificado | Ejecución de #55, herramientas de #56 y conocimiento de #57 | [Issue #61](https://github.com/LuisVR391/agent-cloudflare/issues/61) |

La evidencia de un entregable `Planificado` es su issue, no una capacidad
disponible. La fase pasa a `En progreso` cuando exista trabajo verificable en
`main`, y cada corte pasa a `Completado` al fusionarse el PR que satisface su
criterio, agregando ese PR a su fila.

**Entregables resumidos:** configuración y versiones de agentes, RAG aislado
por empresa, herramientas con autorización en backend, routing, memoria
permitida, modo supervisado, presupuesto y failover.

**Decisiones de la fase:**
[ADR-0014](../decisions/ADR-0014-configurable-agents-and-published-versions.md)
está `Aceptado` desde el corte de agentes y versiones, que adopta su decisión
central: la versión es una revisión inmutable y revertir reactiva la anterior en
vez de derivar una copia.
[ADR-0015](../decisions/ADR-0015-model-provider-and-agent-runs.md) está
`Aceptado` desde el corte de ejecución, y resuelve dos de las que el épico
enumeraba: la capa común de proveedor —con Workers AI como primero— y la
habilitación del modo, que ocurre por conversación al elegir un agente publicado,
sin mover ninguna conversación existente. Las restantes —forma del conocimiento,
contrato de herramienta, alcance de la memoria y medición del costo— siguen sin
registrar, sin reservar números de ADR; cada corte registra la suya en el PR que
la adopta.

**Requisito transversal:** se mantiene la regla de la Fase 2 sobre el catálogo de
permisos. Cada corte declara sus permisos para instalaciones nuevas, agrega una
migración aditiva que los inserta y los concede a los roles existentes por
`role_key`, y una prueba que verifica que una instalación nueva y una migrada
producen el mismo catálogo.

El corte de agentes es la excepción que confirma la regla y queda registrada
aquí: no introduce ningún permiso. `agents.read` y `agents.manage` se declaran
en el catálogo de instalación desde el commit que creó la migración `0002`, y
`seedOwner` es la única ruta de instalación, así que ninguna organización
instalada carece de ellos. No hay catálogo que propagar, de modo que `0019` no
lleva esa sección y la prueba comprueba directamente que `owner` y `manager` los
tienen y `operator` no.

El corte de ejecución tampoco introduce permisos: decidir que un agente atienda
una conversación es gestionarla, y `conversations.manage` ya es ese privilegio.
Por eso `0020` tampoco lleva sección de catálogo.

**Recursos nuevos:** el índice vectorial que exige el conocimiento de #57 no
existe en ningún entorno. Se crea con autorización explícita para el entorno
concreto, en el corte que lo necesita, y no se anticipa en producción.

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
