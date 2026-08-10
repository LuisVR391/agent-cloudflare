# Documentación de Agent Cloudflare

Este directorio concentra la documentación de producto, arquitectura,
seguridad y operación. Su objetivo es mantener separadas la visión del sistema,
las decisiones aceptadas, el comportamiento implementado y el trabajo
pendiente.

## Fuente rectora

La [guía de arquitectura y producto](./guia-arquitectura-producto.md) define la
visión, los límites del MVP, la propiedad de los datos y la secuencia general
de implementación.

La guía describe el sistema objetivo. Una capacidad solo se considera
implementada cuando existe evidencia en código, configuración, migraciones y
pruebas. El [roadmap de producto](./product/roadmap.md) mantiene el estado
aceptado, sus dependencias y la evidencia de ejecución. El
[README principal](../README.md) conserva el resumen del estado actual.

## Estados documentales

| Estado | Significado |
| --- | --- |
| Vigente | Describe una decisión aceptada o comportamiento implementado y verificado |
| En elaboración | Tiene alcance definido, pero aún necesita validación o contenido |
| Pendiente | Se creará en una fase futura; no representa comportamiento disponible |

Cuando una decisión arquitectónica cambie, se registrará mediante un ADR. Los
documentos especializados enlazarán a la guía en vez de duplicar grandes
secciones. El [índice de decisiones](./decisions/README.md) define sus estados,
estructura y proceso de sustitución.

## Mapa documental

### Base actual

| Documento | Estado | Fase | Propósito |
| --- | --- | --- | --- |
| [Guía de arquitectura y producto](./guia-arquitectura-producto.md) | Vigente | 0 | Visión, principios, arquitectura objetivo, alcance y fases |
| [Roadmap de producto](./product/roadmap.md) | Vigente | 0 | Estado verificable, dependencias, criterios de salida y evidencia |
| [Reglas compartidas](../AGENTS.md) | Vigente | 0 | Principios, restricciones, validaciones y flujo de contribución |
| [Decisiones arquitectónicas](./decisions/README.md) | Vigente | 0 | Índice y ciclo de vida de los ADRs |
| [README del repositorio](../README.md) | Vigente | 0 | Entrada al proyecto y estado real de implementación |
| [Seguridad](../SECURITY.md) | Vigente | 0 | Reglas mínimas para secretos, webhooks, datos y procesamiento |
| [Contribución](../CONTRIBUTING.md) | Vigente | 0 | Flujo local y convenciones actuales |
| [Continuidad de agentes de codificación](./operations/agent-continuity.md) | Vigente | 0 | Skill, hooks, confianza, guardrails y validación repo-local para Codex y Claude Code |
| [Base de datos local](./operations/local-database.md) | Vigente | 0 | Binding, migraciones, inspección y pruebas de D1 en local |
| [Operación de autenticación](./operations/authentication.md) | Vigente | 0 | Secretos, instalación inicial, acceso local y recuperación |
| [Instrucciones para Claude Code](../CLAUDE.md) | Vigente | 0 | Punto de entrada que importa las reglas compartidas |

### Fase 0 — Fundamentos

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| [Visión especializada de producto](./product/vision.md) | Vigente | Audiencia, problema, alcance del MVP y criterios de éxito |
| `architecture/overview.md` | Pendiente | Componentes, límites y flujo general |
| [Modelo de dominio](./architecture/domain-model.md) | Vigente | Lenguaje, entidades, relaciones e invariantes multiempresa |
| [Propiedad de datos](./architecture/data-ownership.md) | Vigente | Fuentes de verdad y ciclo de vida de los datos |
| [Modelo de seguridad](./architecture/security-model.md) | Vigente | Autenticación, autorización, aislamiento y auditoría |
| [Contratos transversales](./architecture/contracts.md) | Vigente | Contratos compartidos, identificadores e idempotencia |
| [Entornos y staging](./operations/environments.md) | Vigente | Local, staging, producción, bindings, secretos, despliegue y rollback |
| [ADR-0001: Arquitectura Cloudflare-native](./decisions/ADR-0001-cloudflare-native.md) | Vigente | Servicios Cloudflare mediante bindings y responsabilidades separadas |
| [ADR-0002: D1 como fuente de verdad](./decisions/ADR-0002-d1-source-of-truth.md) | Vigente | Autoridad empresarial y relacional, migraciones y proyecciones |
| [ADR-0003: Runtime durable por conversación](./decisions/ADR-0003-conversation-agent.md) | Vigente | Coordinación viva y aislada mediante Durable Objects |
| [ADR-0004: Aprobación humana](./decisions/ADR-0004-human-approval.md) | Vigente | Evaluación, autorización, publicación versionada y rollback |
| [ADR-0005: Guardrails compartidos de agentes](./decisions/ADR-0005-shared-agent-guardrails.md) | Vigente | Núcleo neutral, adaptadores por agente y skill sin copias |
| [ADR-0006: Convenciones de esquema en D1](./decisions/ADR-0006-d1-schema-conventions.md) | Vigente | Identificadores, timestamps, aislamiento, migraciones y repositorios |
| [ADR-0007: Better Auth y contexto organizacional](./decisions/ADR-0007-better-auth-and-organization-context.md) | Vigente | Sesiones en D1, instalación cerrada y autorización por organización |
| [ADR-0008: Zernio como adaptador de WhatsApp](./decisions/ADR-0008-zernio-whatsapp-adapter.md) | Vigente | Canal bidireccional externo sin delegar datos ni runtime empresarial |

### Fase 1 — WhatsApp funcional

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `architecture/message-lifecycle.md` | Pendiente | Webhook, normalización, colas, runtime y salida |
| `modules/zernio-whatsapp-channel.md` | Pendiente | Firma, payloads, estados y adaptador bidireccional de Zernio |
| `modules/conversation-runtime.md` | Pendiente | Identidad, buffer, orden, modos y concurrencia |
| `modules/inbox-and-handoff.md` | Pendiente | Actualización en tiempo real e intervención humana |
| `operations/zernio-whatsapp-setup.md` | Pendiente | Conexión manual de cuentas, webhook y secretos por entorno |

### Fase 2 — CRM

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `modules/contacts-and-conversations.md` | Pendiente | Contactos, identidades, conversaciones y asignaciones |
| `modules/teams-and-permissions.md` | Pendiente | Miembros, roles y permisos |
| `modules/pipelines.md` | Pendiente | Pipelines, etapas, transiciones y oportunidades |
| `modules/appointments-and-tasks.md` | Pendiente | Agenda, citas, tareas y seguimientos |
| `modules/initial-metrics.md` | Pendiente | Métricas operativas y comerciales iniciales |

### Fase 3 — Agentes

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `modules/agents-and-versions.md` | Pendiente | Configuración, publicación, historial y rollback |
| `modules/tools-and-permissions.md` | Pendiente | Catálogo, autorización y auditoría de herramientas |
| `modules/knowledge-and-rag.md` | Pendiente | Ingesta, metadatos, búsqueda y aislamiento |
| `modules/routing-and-memory.md` | Pendiente | Asignación, contexto y memoria autorizada |
| `modules/model-providers.md` | Pendiente | Interfaz de modelos, presupuesto y failover |

### Fase 4 — Automatización

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `modules/automations.md` | Pendiente | Reglas, disparadores, acciones y ejecución |
| `modules/workflows.md` | Pendiente | Procesos largos, reintentos, esperas y recuperación |
| `modules/campaigns-and-reminders.md` | Pendiente | Seguimientos, confirmaciones y reactivación |

### Fase 5 — Mejora continua

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `modules/supervisor.md` | Pendiente | Análisis de conversaciones y detección de problemas |
| `modules/evaluations.md` | Pendiente | Casos, métricas y comparación de versiones |
| `modules/improvement-proposals.md` | Pendiente | Evidencia, aprobación, publicación y rollback |
| `architecture/observability.md` | Pendiente | Logs, trazas, costos, redacción y correlación |

### Fase 6 — Expansión

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `architecture/channel-adapters.md` | Pendiente | Contrato para nuevos canales |
| `business-packs/overview.md` | Pendiente | Núcleo común y paquetes por giro |
| `architecture/multitenancy-evolution.md` | Pendiente | Evolución de instancias aisladas a SaaS multiempresa |

## Estrategia futura de issues

Los issues se registrarán después de completar la documentación mínima de la
fase correspondiente:

1. Crear un issue de seguimiento por fase con objetivo, dependencias y criterio
   de salida.
2. Dividirlo en capacidades pequeñas o flujos verticales verificables.
3. Incluir en cada issue alcance, fuera de alcance, contratos afectados,
   seguridad, observabilidad, pruebas y documentación.
4. Evitar issues que mezclen varias fuentes de verdad o varias fases sin una
   dependencia explícita.
5. Cerrar una capacidad únicamente cuando código, configuración, pruebas y
   documentación coincidan.

Los documentos de módulo definirán responsabilidades y contratos antes de la
implementación. Las funciones, rutas, schemas y detalles internos se
documentarán cuando existan en el código para no convertir diseños
especulativos en supuestas interfaces públicas.
