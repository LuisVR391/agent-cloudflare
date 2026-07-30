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
pruebas. El [README principal](../README.md) mantiene el resumen verificable
del estado actual.

## Estados documentales

| Estado | Significado |
| --- | --- |
| Vigente | Describe una decisión aceptada o comportamiento implementado y verificado |
| En elaboración | Tiene alcance definido, pero aún necesita validación o contenido |
| Pendiente | Se creará en una fase futura; no representa comportamiento disponible |

Cuando una decisión arquitectónica cambie, se registrará mediante un ADR. Los
documentos especializados enlazarán a la guía en vez de duplicar grandes
secciones.

## Mapa documental

### Base actual

| Documento | Estado | Fase | Propósito |
| --- | --- | --- | --- |
| [Guía de arquitectura y producto](./guia-arquitectura-producto.md) | Vigente | 0 | Visión, principios, arquitectura objetivo, alcance y fases |
| [README del repositorio](../README.md) | Vigente | 0 | Entrada al proyecto y estado real de implementación |
| [Seguridad](../SECURITY.md) | Vigente | 0 | Reglas mínimas para secretos, webhooks, datos y procesamiento |
| [Contribución](../CONTRIBUTING.md) | Vigente | 0 | Flujo local y convenciones actuales |

### Fase 0 — Fundamentos

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `product/vision.md` | Pendiente | Audiencia, problema, alcance del MVP y criterios de éxito |
| `product/roadmap.md` | Pendiente | Entregables, dependencias y criterios de salida por fase |
| `architecture/overview.md` | Pendiente | Componentes, límites y flujo general |
| [Modelo de dominio](./architecture/domain-model.md) | Vigente | Lenguaje, entidades, relaciones e invariantes multiempresa |
| [Propiedad de datos](./architecture/data-ownership.md) | Vigente | Fuentes de verdad y ciclo de vida de los datos |
| `architecture/security-model.md` | Pendiente | Autenticación, autorización, aislamiento y auditoría |
| [Contratos transversales](./architecture/contracts.md) | Vigente | Contratos compartidos, identificadores e idempotencia |
| `operations/environments.md` | Pendiente | Local, staging, producción, bindings y secretos |
| `decisions/ADR-0001-cloudflare-native.md` | Pendiente | Adopción de la arquitectura Cloudflare-native |
| `decisions/ADR-0002-d1-source-of-truth.md` | Pendiente | D1 como fuente relacional empresarial |
| `decisions/ADR-0003-conversation-agent.md` | Pendiente | Runtime durable por conversación |
| `decisions/ADR-0004-human-approval.md` | Pendiente | Aprobación humana y rollback para mejoras |

### Fase 1 — WhatsApp funcional

| Documento planificado | Estado | Contenido |
| --- | --- | --- |
| `architecture/message-lifecycle.md` | Pendiente | Webhook, normalización, colas, runtime y salida |
| `modules/whatsapp-channel.md` | Pendiente | Verificación, firmas, payloads y adaptador de Meta |
| `modules/conversation-runtime.md` | Pendiente | Identidad, buffer, orden, modos y concurrencia |
| `modules/inbox-and-handoff.md` | Pendiente | Actualización en tiempo real e intervención humana |
| `operations/whatsapp-setup.md` | Pendiente | Configuración segura de la aplicación y número |

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
