# Propiedad y ciclo de vida de los datos

## Propósito

Cada dato de Agent Cloudflare debe tener una única fuente de verdad. Otros
servicios pueden conservar proyecciones, referencias o estados de ejecución,
pero no competir por la autoridad del mismo dato.

## Matriz de propiedad

| Categoría | Fuente de verdad | Responsabilidad |
| --- | --- | --- |
| Organizaciones, usuarios, membresías, roles y permisos | D1 | Configuración empresarial y autorización |
| Canales y referencias de credenciales | D1 | Configuración del canal, nunca el secreto |
| Contactos e identidades externas | D1 | Perfil empresarial y resolución de identidad |
| Conversaciones, mensajes e historial | D1 | Registro canónico consultable |
| Intentos y estados de entrega saliente | D1 | Idempotencia y reconciliación empresarial |
| Metadatos de adjuntos y clave opaca | D1 | Autorización y referencia al binario |
| Agentes, sus versiones y el historial de publicación | D1 | Configuración publicada y trazabilidad de qué revisión estuvo viva ([ADR-0014](../decisions/ADR-0014-configurable-agents-and-published-versions.md)) |
| Asignación de un agente a una conversación y permisos de herramienta | D1 | Todavía conceptual: llegan con la ejecución del agente y su catálogo de herramientas |
| Catálogo de servicios | D1 | Dato relacional que se agenda, se cobra y se cuenta |
| Pipeline y sus etapas | D1 | Configuración comercial por organización, con orden explícito |
| Oportunidades e historial de etapa | D1 | Estado comercial y evidencia de cómo avanzó |
| Notas del contacto | D1 | Lo que el equipo entendió, con su autor y su origen |
| Tareas con responsable | D1 | Lo que quedó pendiente y a quién le toca |
| Citas e historial de estado | D1 | El compromiso reservado y cómo llegó a su desenlace |
| Zona horaria de la organización | D1 | Cómo se interpreta un día de agenda; los instantes siguen en UTC |
| Métricas del proceso | D1, derivadas por consulta | Lectura agregada del historial que ya tiene dueño; sin tabla de agregados ni contador ([ADR-0012](../decisions/ADR-0012-initial-metrics.md)) |
| Automatizaciones | D1 | Estado empresarial durable |
| Buffer, debounce, orden y exclusión mutua | Durable Object | Coordinación viva de una conversación |
| Cursor de procesamiento y alarmas cercanas | Durable Object | Continuidad del runtime conversacional |
| Imágenes, audios, documentos y exportaciones | R2 | Contenido binario y fuentes originales |
| Metadatos, permisos y referencias de archivos | D1 | Descubrimiento y control de acceso |
| Chunks y embeddings | Vectorize | Índice derivado para recuperación semántica |
| Entrega de trabajos | Queues | Transporte, reintentos y desacoplamiento |
| Binarios validados de conversaciones | R2 | Contenido original; D1 conserva metadatos |
| Ejecución larga y checkpoints técnicos | Workflows | Recuperación y progreso de procesos |
| Resultados empresariales de un Workflow | D1 | Estado final consultable y auditable |
| Inferencia, clasificación y embeddings | Workers AI o proveedor | Cómputo; no es almacén empresarial |
| Sesiones de usuarios | D1 | Estado técnico de autenticación mediante Better Auth |
| Tokens y secretos | Cloudflare Secrets | Custodia de credenciales |
| Logs, trazas y métricas técnicas | Observabilidad | Diagnóstico con datos redactados |

## D1: registro empresarial canónico

D1 conserva los datos relacionales que el panel, los reportes y las
automatizaciones necesitan consultar de forma consistente. También guarda
historial, deduplicación, referencias a recursos externos y auditoría.

Una operación empresarial no se considera completada solo porque exista en
memoria, una cola o un Durable Object. Debe quedar persistida en D1 cuando el
dominio la defina como durable.

### Esquema implementado

La matriz anterior describe la propiedad objetivo de cada categoría. Hoy
existen en `migrations/` estas tablas:

| Tabla | Contenido | Migración |
| --- | --- | --- |
| `organizations` | Raíz de aislamiento: identificador, slug, nombre y estado | `0001_initial_schema.sql` |
| `contacts` | Contacto empresarial dentro de una organización, con su ficha | `0001_initial_schema.sql` y `0010_contacts_profile_and_tags.sql` |
| `contact_identities` | Identidad externa del contacto por proveedor | `0001_initial_schema.sql` |
| `users`, `user_sessions`, `user_accounts`, `auth_verifications` | Identidad y sesión técnica de Better Auth | `0002_authentication_and_authorization.sql` |
| `memberships`, `roles`, `permissions`, `membership_roles`, `role_permissions` | Autorización canónica del producto | `0002_authentication_and_authorization.sql` |
| `installation_state`, `auth_rate_limits` | Instalación única y protección contra abuso | `0002_authentication_and_authorization.sql` |
| `audit_logs` | Acciones autorizadas relevantes por organización | `0002_authentication_and_authorization.sql` |
| `contact_tags`, `contact_tag_assignments` | Etiquetas de la organización y su asignación al contacto | `0010_contacts_profile_and_tags.sql` |
| `organization_invitations` | Alta por invitación: correo, rol, vencimiento y el HMAC del token | `0011_team_invitations_and_conversation_assignment.sql` |
| `conversation_assignments` | Historial de responsables de cada conversación | `0011_team_invitations_and_conversation_assignment.sql` |
| `services` | Catálogo empresarial: nombre, duración, precio opcional con su moneda y estado | `0012_service_catalog.sql` |
| `pipelines`, `pipeline_stages` | Pipeline comercial de la organización, con orden y color de cada etapa | `0013_pipelines_and_stages.sql` |
| `opportunities`, `opportunity_stage_transitions` | Oportunidad que recorre el pipeline y el historial de cada movimiento | `0014_opportunities.sql` |
| `contact_notes` | Nota del contacto con su autor y la conversación desde la que se escribió | `0015_contact_notes.sql` |
| `tasks` | Tarea con responsable, vencimiento, estado y un solo sujeto opcional | `0016_tasks.sql` |
| `appointments`, `appointment_transitions` | Cita con su intervalo en UTC, su origen y el historial de estado y horario | `0017_appointments_and_time_zone.sql` |
| `agents` | Agente de la organización: nombre único, propósito y estado | `0019_agents_and_versions.sql` |
| `agent_versions` | Revisión inmutable con instrucciones, modelo previsto y playbook; a lo sumo una publicada por agente | `0019_agents_and_versions.sql` |
| `agent_version_tools`, `agent_version_knowledge_scopes` | Lo que una revisión declara que usará; todavía sin catálogo que lo autorice | `0019_agents_and_versions.sql` |
| `agent_publication_transitions` | Historial append-only de qué versión quedó publicada, con actor y motivo | `0019_agents_and_versions.sql` |
| `communication_channels`, `inbound_webhook_events` | Canal confiable y recepción deduplicada de Zernio | `0003_zernio_whatsapp_channel.sql` y `0005_message_sent_reconciliation.sql` |
| `conversations`, `messages`, `message_attachments` | Historial canónico y metadatos de medios | `0004_conversations_and_messages.sql` y `0009_message_attachment_recovery.sql` |
| `outbound_message_deliveries`, `message_status_events` | Idempotencia, intentos e historial de reconciliación por identificadores opacos | `0004` a `0006` |

Las categorías no listadas siguen siendo conceptuales: se crearán con la capacidad
que las necesite, mediante migraciones nuevas y aditivas. Las convenciones que
rigen ese crecimiento están en
[ADR-0006](../decisions/ADR-0006-d1-schema-conventions.md); el flujo local está
en [base de datos local](../operations/local-database.md).

El acceso propio ocurre a través de `src/worker/repositories/`. Better Auth
accede únicamente a sus cuatro tablas técnicas mediante su adaptador D1,
excepción definida en
[ADR-0007](../decisions/ADR-0007-better-auth-and-organization-context.md).

## Durable Object: runtime por conversación

Cada conversación activa tendrá una identidad
`organizationId:conversationId`. El Durable Object es propietario de:

- Mensajes pendientes de agrupar.
- Orden de procesamiento.
- Temporizador de debounce.
- Bloqueo de respuestas concurrentes.
- Cursor del último mensaje procesado.
- Alarmas de corto plazo.
- Conexiones en tiempo real asociadas a la conversación.

Puede mantener una proyección de agente asignado, versión, modo de atención y
contacto para ejecutar con baja latencia. Esa proyección no reemplaza la
configuración ni el historial canónico de D1 y debe poder reconstruirse.

No se almacenará en un único Durable Object el estado de todas las empresas,
todos los contactos ni toda la analítica.

## R2 y Vectorize

R2 conserva el contenido binario. D1 guarda su propietario, estado, categoría,
checksum, referencia y permisos. Una referencia a R2 nunca evita la validación
de organización.

Vectorize es un índice reconstruible. Cada vector incluye como mínimo:

- `organization_id`
- `agent_id`
- `document_id`
- `document_version`
- `category`
- `status`

La fuente original permanece en R2 o en el dato empresarial correspondiente;
la configuración y los metadatos permanecen en D1. Una búsqueda sin filtro de
organización debe fallar de forma cerrada.

## Queues y Workflows

Queues transporta trabajos y aplica reintentos. Un mensaje encolado no
demuestra que el efecto empresarial ya ocurrió. Consumidores y productores
deben usar claves de idempotencia.

Workflows conserva el progreso técnico de procesos largos, esperas y
reintentos. Citas, seguimientos, publicaciones de agentes o aprobaciones
resultantes se persisten en D1. Un Workflow puede reanudarse sin duplicar el
efecto empresarial.

## Secretos y credenciales

La clave de API y el secreto de webhook de Zernio, junto con las credenciales
de proveedores de IA, se administran mediante Cloudflare Secrets. D1 solo
puede guardar una referencia opaca, el adaptador, la cuenta externa, su estado
y metadatos no sensibles.

Los secretos nunca se escriben en:

- Código o configuración versionada.
- D1, Durable Objects, R2 o Vectorize.
- Mensajes de cola o argumentos de Workflow.
- Logs, trazas, auditorías o respuestas API.

## Flujo de propiedad de un mensaje

```text
Zernio
  -> recibe el mensaje de WhatsApp
  -> entrega un webhook firmado y reintentable

Webhook Worker
  -> valida firma sobre el cuerpo crudo, estructura, plataforma y cuenta
  -> registra deduplicación y recepción en D1
  -> publica referencia normalizada en Inbound Queue

Inbound consumer
  -> resuelve organización, canal, contacto y conversación en D1
  -> entrega al Durable Object de la conversación

Conversation Agent
  -> ordena y agrupa en su runtime
  -> carga configuración canónica desde D1
  -> ejecuta agente y herramientas autorizadas
  -> persiste mensaje, resultado y auditoría en D1
  -> publica referencia en Outbound Queue

Outbound consumer
  -> registra el intento y envía mediante la API de Zernio
  -> reutiliza una Idempotency-Key estable en cada reintento
  -> reconcilia entrega, lectura o error en D1
```

Las Queues contienen referencias y contexto mínimo; los registros consultables
y los efectos de negocio permanecen en D1.

## Recuperación y reconciliación

- Un runtime conversacional debe reconstruirse desde D1 si pierde una
  proyección.
- Vectorize debe poder regenerarse desde las fuentes y metadatos canónicos.
- Un mensaje reintentado debe encontrar su deduplicación antes de producir un
  nuevo efecto.
- Un envío con resultado incierto reutiliza su `Idempotency-Key` dentro de la
  ventana del proveedor y se reconcilia con la respuesta y los eventos de
  Zernio antes de decidir una recuperación posterior.
- Los estados de Zernio se conservan aunque lleguen antes que la respuesta de
  envío. D1 los reproduce al establecer un vínculo exacto por organización,
  canal, conversación e identificador opaco; nunca infiere identidad desde el
  contenido o datos personales.
- Los fallos parciales conservan el mismo `correlationId`.
- Una discrepancia se resuelve a favor de la fuente de verdad declarada en
  este documento y queda registrada para auditoría.
