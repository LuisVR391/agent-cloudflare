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
| Agentes, versiones, asignaciones y permisos | D1 | Configuración publicada y trazabilidad |
| Pipeline, citas, tareas y automatizaciones | D1 | Estado empresarial durable |
| Buffer, debounce, orden y exclusión mutua | Durable Object | Coordinación viva de una conversación |
| Cursor de procesamiento y alarmas cercanas | Durable Object | Continuidad del runtime conversacional |
| Imágenes, audios, documentos y exportaciones | R2 | Contenido binario y fuentes originales |
| Metadatos, permisos y referencias de archivos | D1 | Descubrimiento y control de acceso |
| Chunks y embeddings | Vectorize | Índice derivado para recuperación semántica |
| Entrega de trabajos | Queues | Transporte, reintentos y desacoplamiento |
| Ejecución larga y checkpoints técnicos | Workflows | Recuperación y progreso de procesos |
| Resultados empresariales de un Workflow | D1 | Estado final consultable y auditable |
| Inferencia, clasificación y embeddings | Workers AI o proveedor | Cómputo; no es almacén empresarial |
| Tokens y secretos | Cloudflare Secrets | Custodia de credenciales |
| Logs, trazas y métricas técnicas | Observabilidad | Diagnóstico con datos redactados |

## D1: registro empresarial canónico

D1 conserva los datos relacionales que el panel, los reportes y las
automatizaciones necesitan consultar de forma consistente. También guarda
historial, deduplicación, referencias a recursos externos y auditoría.

Una operación empresarial no se considera completada solo porque exista en
memoria, una cola o un Durable Object. Debe quedar persistida en D1 cuando el
dominio la defina como durable.

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

Los tokens de WhatsApp y proveedores de IA se administran mediante secretos de
Cloudflare. D1 solo puede guardar una referencia opaca, el proveedor, estado y
metadatos no sensibles.

Los secretos nunca se escriben en:

- Código o configuración versionada.
- D1, Durable Objects, R2 o Vectorize.
- Mensajes de cola o argumentos de Workflow.
- Logs, trazas, auditorías o respuestas API.

## Flujo de propiedad de un mensaje

```text
Webhook Worker
  -> valida firma y estructura
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
  -> envía al proveedor con idempotencia
  -> actualiza entrega o error en D1
```

Las Queues contienen referencias y contexto mínimo; los registros consultables
y los efectos de negocio permanecen en D1.

## Recuperación y reconciliación

- Un runtime conversacional debe reconstruirse desde D1 si pierde una
  proyección.
- Vectorize debe poder regenerarse desde las fuentes y metadatos canónicos.
- Un mensaje reintentado debe encontrar su deduplicación antes de producir un
  nuevo efecto.
- Los fallos parciales conservan el mismo `correlationId`.
- Una discrepancia se resuelve a favor de la fuente de verdad declarada en
  este documento y queda registrada para auditoría.
