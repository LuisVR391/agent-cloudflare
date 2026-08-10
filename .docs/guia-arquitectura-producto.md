# Agent Cloudflare — Guía de arquitectura y producto

> **Estado del documento:** guía rectora de producto y arquitectura objetivo.
> Una capacidad descrita aquí no se considera implementada hasta que exista
> evidencia en código, configuración, migraciones y pruebas. Consulta el
> [README del repositorio](../README.md) para conocer el estado actual y el
> [índice documental](./README.md) para revisar la evolución por fases.

## 1. Propósito del documento

Este documento define la visión, arquitectura, responsabilidades, alcance y reglas de desarrollo de **Agent Cloudflare**.

Su objetivo es servir como guía principal para agentes de codificación, desarrolladores y colaboradores técnicos. Antes de proponer cambios importantes, crear recursos, modificar el modelo de datos o introducir nuevas dependencias, se debe consultar este documento.

El proyecto no debe evolucionar como una reconstrucción literal de NINA ni como un bot aislado. Debe convertirse en una plataforma empresarial nueva, especializada inicialmente en salones de belleza y diseñada para evolucionar hacia otros tipos de micro y pequeñas empresas.

---

# 2. Visión del producto

Agent Cloudflare será una plataforma CRM conversacional basada en Cloudflare, diseñada para que pequeñas empresas administren desde un solo panel:

- Canales de atención.
- Conversaciones.
- Contactos y clientes.
- Prospectos y oportunidades.
- Pipelines comerciales.
- Citas y seguimientos.
- Agentes de inteligencia artificial.
- Base de conocimiento.
- Automatizaciones.
- Métricas.
- Supervisión de calidad.
- Mejora continua de los agentes.

La primera edición estará enfocada en salones de belleza, aprovechando procesos reales como:

- Solicitud de información.
- Identificación del servicio de interés.
- Calificación del prospecto.
- Presentación de precios.
- Resolución de objeciones.
- Propuesta de horarios.
- Agendamiento.
- Confirmación de cita.
- Seguimiento posterior.
- Cuidados.
- Recordatorios de retoque.
- Reactivación de clientes.

El núcleo debe ser reutilizable para otros giros sin duplicar el código principal.

> **Definición resumida:** Agent Cloudflare es un CRM conversacional inteligente, multicanal, configurable por empresa y basado en agentes de IA, que permite automatizar atención, ventas, agenda, seguimiento y mejora continua desde una sola interfaz.

---

# 3. Principios del proyecto

## 3.1 Un solo producto para el usuario

El usuario empresarial debe utilizar una sola interfaz.

No debe necesitar entrar en un panel de agentes separado para realizar tareas comunes. La configuración de agentes, canales, pipelines, conocimiento, automatizaciones y mejoras debe estar integrada en el mismo producto.

## 3.2 Núcleo común y paquetes por giro

El sistema debe tener:

- Un núcleo común.
- Configuraciones por empresa.
- Paquetes verticales por tipo de negocio.

```text
Núcleo común
├── CRM
├── Inbox
├── Usuarios
├── Agentes
├── Pipelines
├── Automatizaciones
├── Analítica
└── Seguridad

Paquete beauty-salon
├── Agentes iniciales
├── Pipeline sugerido
├── Servicios
├── Objeciones frecuentes
├── Reglas de agenda
├── Automatizaciones
└── Evaluaciones
```

## 3.3 Configuración antes que forks

No crear un repositorio distinto por empresa.

No crear copias manuales como:

```text
repo-beauty-place
repo-salon-2
repo-clinica-3
```

Se debe mantener un repositorio principal y permitir que cada despliegue use configuraciones o paquetes específicos.

## 3.4 Seguridad aplicada en backend

Los permisos no deben depender solo del prompt.

La seguridad debe validarse antes de que una herramienta sea visible o ejecutable por un agente.

## 3.5 Aprobación humana para mejoras sensibles

Los agentes pueden sugerir cambios, pero no deben modificar silenciosamente agentes, pipelines, conocimiento o automatizaciones de producción.

Toda mejora relevante debe:

1. Mostrar el problema.
2. Presentar evidencia.
3. Proponer un cambio.
4. Ejecutar evaluaciones.
5. Esperar aprobación humana.
6. Crear una nueva versión.
7. Permitir rollback.

## 3.6 Un único dueño por tipo de dato

Cada dato debe tener una fuente de verdad definida.

- D1: CRM y configuración empresarial.
- Durable Objects: estado vivo de conversaciones.
- R2: archivos y medios.
- Vectorize: embeddings y recuperación semántica.
- Workflows: procesos largos y durables.
- Queues: transporte y desacoplamiento asíncrono.

---

# 4. Alcance inicial

## 4.1 Primera vertical

> CRM conversacional inteligente para salones de belleza.

## 4.2 Primer canal

- WhatsApp mediante Zernio como adaptador bidireccional.

Las cuentas se conectarán inicialmente desde el panel de Zernio. Agent
Cloudflare conservará el CRM, el inbox, los agentes, la automatización y los
datos canónicos; Zernio solo transportará mensajes y estados entre WhatsApp y
el Worker, según [ADR-0008](./decisions/ADR-0008-zernio-whatsapp-adapter.md).

## 4.3 Canales futuros

- Instagram Direct.
- Facebook Messenger.
- Telegram.
- Chat web.
- Correo.
- Otros canales mediante adaptadores.

## 4.4 No incluir todavía

No implementar en el MVP:

- Administración completa de anuncios.
- Contabilidad.
- Nómina.
- Punto de venta completo.
- Inventario avanzado.
- Marketplace de agentes.
- Fine-tuning automático.
- Soporte simultáneo para muchos giros.
- Constructor visual excesivamente complejo.

Primero se debe validar el flujo:

```text
Mensaje
→ atención
→ calificación
→ cita
→ servicio
→ seguimiento
→ retoque
```

---

# 5. Modelo de despliegue

## 5.1 Recomendación inicial

Durante la primera etapa, cada empresa puede tener una instancia aislada, pero todas las instancias deben provenir del mismo código fuente.

```text
Repositorio principal
├── Instancia Beauty Place
├── Instancia salón 2
├── Instancia clínica estética
└── Instancia futura de otro giro
```

## 5.2 Beneficios

- Aislamiento de datos.
- Secretos separados.
- Menor riesgo de cruce de información.
- Configuración independiente.
- Despliegues más sencillos.
- Facilidad para replicar una instancia.
- Base para evolucionar posteriormente a un SaaS multiempresa.

## 5.3 Preparación multiempresa

Aunque inicialmente una instancia pueda corresponder a una empresa, toda entidad importante debe estar preparada para incluir:

```text
organization_id
```

Esto evita rediseñar todo el dominio cuando se requiera multi-tenancy real.

---

# 6. Arquitectura general

```text
WhatsApp
        │
        ▼
Zernio
├── conexión manual de cuentas
├── webhook de mensajes y estados
└── API de envío
        │
        ▼
Webhook Worker
├── verifica X-Zernio-Signature sobre el cuerpo crudo
├── valida payload
├── resuelve cuenta, canal y organización
├── deduplica por ID estable del evento
├── registra recepción
└── responde HTTP 200 rápidamente
        │
        ▼
Inbound Queue
        │
        ▼
Conversation Agent
Durable Object por conversación
├── buffer de mensajes
├── orden
├── bloqueo de concurrencia
├── estado de atención
├── agente asignado
├── versión del agente
├── modo IA/humano
└── ejecución de herramientas
        │
        ├── D1
        ├── Vectorize
        ├── R2
        ├── Workers AI / proveedor externo
        ├── Workflows
        └── Tools
        │
        ▼
Outbound Queue
        │
        ▼
Zernio API
        │
        ▼
WhatsApp
```

---

# 7. Responsabilidades por servicio de Cloudflare

## 7.1 Cloudflare Workers

Responsabilidades:

- Punto de entrada HTTP.
- API del panel.
- Webhooks.
- Validación de firmas.
- Autenticación.
- Enrutamiento.
- Endpoints CRUD.
- Integración con servicios.
- Entrega de assets del frontend.

No debe almacenar estado conversacional complejo directamente en memoria efímera.

## 7.2 Agents SDK y Durable Objects

Responsabilidades:

- Estado persistente por conversación.
- Buffer.
- Debounce.
- Orden de mensajes.
- Coordinación.
- Evitar respuestas concurrentes.
- Ejecución del agente.
- Alarmas cercanas.
- Conexiones en tiempo real.
- Estado temporal de atención.
- Pausa por intervención humana.

Identidad sugerida:

```text
organizationId:conversationId
```

Ejemplo:

```text
beauty-place:conv_01JXYZ
```

## 7.3 D1

D1 será la fuente de verdad para los datos empresariales y relacionales.

Entidades recomendadas:

```text
organizations
users
memberships
roles
permissions
channels
channel_credentials
contacts
contact_identities
conversations
messages
conversation_assignments
conversation_status_history
agents
agent_versions
agent_assignments
agent_permissions
agent_tools
services
pipelines
pipeline_stages
pipeline_records
pipeline_transitions
appointments
tasks
automation_rules
automation_runs
knowledge_documents
knowledge_chunks
agent_runs
tool_runs
improvement_proposals
evaluations
evaluation_runs
audit_logs
```

## 7.4 Cloudflare Queues

Colas iniciales recomendadas:

```text
INBOUND_MESSAGES_QUEUE
OUTBOUND_MESSAGES_QUEUE
```

Posibles colas futuras:

```text
MEDIA_PROCESSING_QUEUE
ANALYTICS_QUEUE
SUPERVISOR_QUEUE
KNOWLEDGE_INDEXING_QUEUE
```

Usos:

- Desacoplar webhooks.
- Reintentos.
- Envío de mensajes.
- Procesamiento de media.
- Métricas.
- Indexación.
- Tareas no críticas para la respuesta HTTP.

## 7.5 Workflows

Usar Workflows para procesos largos o recuperables:

- Seguimientos.
- Confirmaciones.
- Campañas.
- Esperas de horas o días.
- Procesamiento de documentos.
- Reindexación.
- Evaluación de conversaciones.
- Automejora.
- Aprobaciones.
- Reactivación de clientes.
- Recordatorios de retoque.

## 7.6 R2

Guardar:

- Audios.
- Imágenes.
- Documentos.
- Adjuntos.
- Archivos de conocimiento.
- Exportaciones.
- Resultados generados.
- Fuentes originales.

D1 solo debe guardar metadatos, estado y referencias.

## 7.7 Vectorize

Usar para:

- Servicios.
- Precios.
- Políticas.
- Preguntas frecuentes.
- Cuidados.
- Objeciones.
- Procesos.
- Estrategias.
- Conocimiento por agente.

Metadatos obligatorios:

```text
organization_id
agent_id
document_id
document_version
category
status
```

Nunca realizar una búsqueda sin filtrar por empresa.

## 7.8 Workers AI

Uso recomendado:

- Embeddings.
- Transcripción.
- Clasificación.
- Resumen.
- Moderación.
- Análisis de sentimiento.
- Extracción estructurada.
- Evaluación económica de conversaciones.

La conversación principal debe estar preparada para usar Workers AI o proveedores externos mediante una capa común.

## 7.9 AI Gateway

Uso futuro recomendado:

- Control de costos.
- Observabilidad de proveedores.
- Failover.
- Caché.
- Rate limits.
- Métricas.
- Enrutamiento entre modelos.

---

# 8. Estructura recomendada del repositorio

```text
agent-cloudflare/
├── src/
│   ├── app/
│   │   ├── dashboard/
│   │   ├── conversations/
│   │   ├── contacts/
│   │   ├── pipelines/
│   │   ├── agents/
│   │   ├── knowledge/
│   │   ├── automations/
│   │   ├── analytics/
│   │   └── settings/
│   │
│   ├── worker/
│   │   ├── index.ts
│   │   ├── routes/
│   │   │   ├── api/
│   │   │   ├── auth/
│   │   │   └── webhooks/
│   │   ├── agents/
│   │   ├── channels/
│   │   ├── queues/
│   │   ├── workflows/
│   │   ├── domain/
│   │   ├── repositories/
│   │   ├── services/
│   │   ├── security/
│   │   ├── tools/
│   │   ├── rag/
│   │   └── observability/
│   │
│   └── shared/
│       ├── contracts/
│       ├── schemas/
│       ├── types/
│       └── constants/
│
├── business-packs/
│   └── beauty-salon/
│       ├── agents/
│       ├── pipelines/
│       ├── automations/
│       ├── evaluations/
│       ├── terminology/
│       └── seed/
│
├── migrations/
├── tests/
│   ├── unit/
│   ├── integration/
│   ├── security/
│   └── evaluations/
│
├── .docs/
│   ├── architecture/
│   ├── product/
│   ├── decisions/
│   ├── security/
│   └── operations/
│
├── AGENTS.md
├── wrangler.jsonc
├── package.json
└── README.md
```

---

# 9. Tipos de agentes

## 9.1 Agentes de atención a clientes

Responden mensajes en canales públicos.

Ejemplos:

- Recepción general.
- Micropigmentación.
- Pestañas.
- Tratamientos faciales.
- Agenda.
- Seguimiento.

Pueden consultar:

- Servicios.
- Precios.
- Horarios.
- Políticas.
- Disponibilidad.
- Indicaciones generales.
- Información propia del contacto autenticado.

No pueden:

- Consultar clientes arbitrarios.
- Obtener conversaciones ajenas.
- Consultar datos internos sensibles.
- Modificar configuraciones.
- Exportar información.
- Administrar usuarios.

## 9.2 Agentes internos

Son utilizados por colaboradores autenticados.

Ejemplos:

- Consultar clientes.
- Revisar citas.
- Preguntar pendientes.
- Analizar prospectos.
- Preparar respuestas.
- Mover oportunidades.
- Consultar métricas.

Sus capacidades dependen del rol.

## 9.3 Agente supervisor

No responde directamente al cliente.

Responsabilidades:

- Analizar conversaciones.
- Detectar huecos.
- Encontrar respuestas inconsistentes.
- Identificar oportunidades perdidas.
- Revisar escalaciones.
- Detectar fallos de tools.
- Proponer mejoras.
- Crear casos de prueba.
- Comparar versiones.
- Medir calidad.

## 9.4 Asistente de configuración empresarial

Ayuda a:

- Crear agentes.
- Diseñar pipelines.
- Crear automatizaciones.
- Organizar conocimiento.
- Configurar reglas.
- Interpretar métricas.
- Proponer seguimientos.

Toda propuesta debe ser editable antes de aplicarse.

---

# 10. Agente, conversación y runtime

No confundir:

- **Agente:** configuración reutilizable.
- **Conversación:** hilo con un contacto.
- **Runtime:** estado vivo de una conversación.

```text
Agente: Micropigmentación
├── atiende conversación A
├── atiende conversación B
└── atiende conversación C
```

Cada conversación tendrá su Durable Object.

Estado sugerido:

```ts
type ConversationAgentState = {
  organizationId: string;
  conversationId: string;
  channelId: string;
  contactId: string;
  assignedAgentId: string;
  assignedAgentVersion: number;
  attentionMode: "automatic" | "supervised" | "human" | "paused";
  pendingMessages: PendingMessage[];
  lastProcessedMessageId: string | null;
  lastActivityAt: string;
  pausedUntil: string | null;
};
```

---

# 11. Canales y asignación

Cada canal debe incluir:

```text
organization_id
provider
external_account_id
display_name
credentials_reference
default_agent_id
attention_mode
buffer_seconds
business_hours
human_team_id
status
```

`provider` describe el canal empresarial, por ejemplo `whatsapp`; el adaptador
de transporte puede ser `zernio`. `external_account_id` es opaco y solo puede
resolver una organización mediante configuración canónica de D1. Zernio no es
la autoridad de contactos, conversaciones o mensajes del producto.

Ejemplo:

```text
Beauty Place
└── WhatsApp principal
    ├── agente predeterminado: Recepción
    ├── buffer: 8 segundos
    ├── modo: automático
    ├── horario: 10:00–19:00
    └── equipo humano: Recepción
```

Un canal puede usar routing interno para delegar a diferentes agentes. No es necesario tener un número diferente para cada agente.

---

# 12. Flujo completo de mensajes

## 12.1 Entrada

1. WhatsApp entrega el mensaje a la cuenta conectada en Zernio.
2. Zernio envía el webhook.
3. Worker verifica `X-Zernio-Signature` sobre el cuerpo crudo.
4. Worker valida estructura, evento y plataforma.
5. Worker resuelve la cuenta externa hacia canal y organización en D1.
6. Worker persiste la deduplicación por ID estable del evento.
7. Worker registra recepción y encola una referencia normalizada.
8. Worker responde 200 dentro del plazo del proveedor.

## 12.2 Procesamiento

1. Consumidor resuelve empresa, canal y contacto.
2. Crea o recupera conversación.
3. Envía el mensaje al Durable Object.
4. El Durable Object agrega al buffer.
5. Reinicia la alarma de debounce.
6. Al vencer el buffer, agrupa mensajes.
7. Carga agente y versión.
8. Construye contexto.
9. Filtra herramientas por permisos.
10. Ejecuta el agente.
11. Registra respuesta y trazas.
12. Encola envío.

## 12.3 Salida

1. Consumidor toma el mensaje.
2. Resuelve cuenta y conversación opacas de Zernio desde D1.
3. Llama a la API de inbox de Zernio con credenciales del entorno.
4. Registra el intento, ID externo y respuesta.
5. Reconcilia los eventos de entrega, lectura o fallo.
6. Solo reintenta cuando puede demostrar que no duplicará el envío.
7. Actualiza el panel en tiempo real.

---

# 13. Buffer de mensajes

El buffer debe vivir en el Durable Object de la conversación.

```text
10:00:00 Hola
10:00:02 Quiero información de microblading
10:00:05 ¿Y tienen cita el sábado?
```

Debe convertirse en una sola entrada lógica.

Configuración:

```text
channel.buffer_seconds
```

Valor inicial sugerido:

```text
6–10 segundos
```

Debe poder configurarse por canal.

La cola y el buffer no duplican responsabilidades:

- Queue: entrega asíncrona y reintentos.
- Durable Object: orden, agrupación y estado por conversación.

---

# 14. Seguridad y permisos

## 14.1 Contexto obligatorio de ejecución

```ts
type AgentExecutionContext = {
  organizationId: string;
  actorType: "customer" | "staff" | "system";
  actorId: string;
  role?: "owner" | "manager" | "operator";
  channelId?: string;
  conversationId?: string;
  contactId?: string;
  agentId: string;
  agentVersion: number;
  correlationId: string;
};
```

El modelo no puede modificar estos valores.

## 14.2 Regla de seguridad

Antes de ejecutar una tool:

1. Identificar actor.
2. Identificar organización.
3. Cargar rol.
4. Cargar permisos.
5. Verificar acción.
6. Filtrar datos por empresa.
7. Registrar auditoría.
8. Ejecutar.

## 14.3 Principio de mínimo privilegio

```text
Agente público:
- search_public_services
- get_business_hours
- request_appointment
- get_own_appointment

Agente interno:
- search_contacts
- list_appointments
- update_pipeline_stage
- create_followup_task

Administrador:
- manage_agents
- manage_channels
- manage_knowledge
- manage_automations
```

## 14.4 Nunca confiar en IDs del frontend

Toda consulta debe verificar:

```text
resource.organization_id === authenticated.organization_id
```

## 14.5 Auditoría

Registrar:

```text
actor
organization
action
resource
result
timestamp
correlation_id
```

---

# 15. Modos de atención

Cada conversación debe tener:

```text
automatic
supervised
human
paused
```

- **Automatic:** el agente responde sin aprobación.
- **Supervised:** el agente prepara y un humano aprueba.
- **Human:** la IA no responde.
- **Paused:** la conversación queda suspendida temporalmente.

El handoff debe cambiar el modo a `human` o `paused`.

---

# 16. Pipelines

## 16.1 Separar conceptos

### Estado operativo

```text
Nueva
IA atendiendo
Esperando cliente
Humano atendiendo
Pausada
Resuelta
```

### Pipeline comercial

```text
Nuevo contacto
Servicio identificado
Prospecto calificado
Información enviada
Cita propuesta
Cita agendada
Servicio realizado
Seguimiento
Próximo retoque
Cliente recurrente
Oportunidad perdida
```

### Estado de cita

```text
Solicitada
Pendiente
Confirmada
Reprogramada
Cancelada
Realizada
No asistió
```

## 16.2 Pipeline configurable

Cada empresa debe poder:

- Crear pipelines.
- Crear etapas.
- Ordenar etapas.
- Definir colores.
- Definir transiciones.
- Definir campos obligatorios.
- Definir acciones al entrar.
- Definir acciones al salir.
- Definir tiempos máximos.
- Definir automatizaciones.
- Asignar agentes.
- Consultar métricas.

Ejemplo:

```json
{
  "name": "Cita propuesta",
  "requiredFields": ["service_id"],
  "entryActions": ["suggest_available_times"],
  "timeoutHours": 24,
  "timeoutAction": "send_followup",
  "agentPlaybook": "appointment_closing"
}
```

## 16.3 Pipeline inicial Beauty Salon

```text
1. Nuevo contacto
2. Servicio identificado
3. Prospecto calificado
4. Información enviada
5. Cita propuesta
6. Cita agendada
7. Cita confirmada
8. Servicio realizado
9. Seguimiento posterior
10. Próximo retoque
11. Cliente recurrente
12. Oportunidad perdida
```

---

# 17. Automatizaciones iniciales

- Seguimiento después de información enviada.
- Recordatorio si no confirma cita.
- Confirmación previa.
- Mensaje posterior al servicio.
- Cuidados.
- Recordatorio de retoque.
- Reactivación.
- Aviso de conversación estancada.
- Notificación de prospecto con alta intención.
- Solicitud de intervención humana.
- Solicitud de reseña.

Estas funciones deben ser parte del núcleo de Agent Cloudflare.

---

# 18. Conocimiento y memoria

## 18.1 Conocimiento empresarial

- Servicios.
- Precios.
- Políticas.
- Horarios.
- Cuidados.
- Promociones.
- Objeciones.
- Procesos.

## 18.2 Memoria de conversación

Contexto temporal del hilo actual.

## 18.3 Memoria del contacto

Hechos persistentes autorizados:

- Servicio de interés.
- Preferencias.
- Historial.
- Objeciones.
- Horarios.
- Citas.
- Información relevante.

## 18.4 Datos operativos

Siempre deben provenir del CRM. El agente no debe inventarlos ni tratarlos como memoria libre.

---

# 19. Mejora continua

## 19.1 Flujo

```text
Conversaciones
→ selección de muestra
→ análisis del supervisor
→ detección de problema
→ propuesta
→ evidencia
→ evaluación
→ aprobación
→ nueva versión
→ publicación
→ seguimiento
```

## 19.2 Tipos de mejora

- Instrucciones.
- Playbooks.
- Conocimiento.
- Objeciones.
- Reglas.
- Escalamiento.
- Tools.
- Automatizaciones.
- Pipelines.
- Modelo.
- Buffer.
- Umbral de confianza.

## 19.3 Ejemplo

```text
Problema:
18 clientas preguntaron si el retoque está incluido.

Evidencia:
El agente respondió de tres maneras diferentes.
Recepción corrigió manualmente cinco conversaciones.

Propuesta:
Agregar una respuesta verificada y una regla que explique
el retoque cuando se informe el precio.

Resultado esperado:
Menos correcciones humanas y mayor claridad.
```

## 19.4 Acciones del usuario

- Aprobar.
- Editar y aprobar.
- Rechazar.
- Posponer.
- Solicitar otra propuesta.

## 19.5 Restricción

La autonomía completa debe quedar fuera del MVP.

---

# 20. Versionado de agentes

Cada agente debe tener versiones.

```text
Recepción Beauty Place
├── v1
├── v2
└── v3 activa
```

Cada versión debe registrar:

```text
instructions
model
tools
permissions
knowledge_scope
playbook
created_by
created_at
change_reason
source_improvement_id
status
```

Funciones necesarias:

- Comparar versiones.
- Publicar.
- Desactivar.
- Rollback.
- Probar.
- Ver conversaciones afectadas.

---

# 21. Evaluaciones

Antes de publicar una nueva versión se deben ejecutar pruebas.

Casos iniciales:

- Pregunta de precio.
- Solicitud de agenda.
- Cliente indeciso.
- Trabajo previo.
- Queja.
- Contraindicación.
- Pregunta fuera de alcance.
- Solicitud de información de otro cliente.
- Cliente que envía varios mensajes.
- Cliente que pide hablar con humano.

Medir:

- Precisión.
- Seguridad.
- Cumplimiento.
- Conversión.
- Uso de tools.
- Escalamiento correcto.
- Tono.
- Alucinaciones.
- Costo.

---

# 22. Métricas

## 22.1 Operativas

- Mensajes recibidos.
- Tiempo de primera respuesta.
- Tiempo de resolución.
- Conversaciones activas.
- Intervenciones humanas.
- Errores.
- Reintentos.

## 22.2 Comerciales

- Nuevos prospectos.
- Prospectos por servicio.
- Conversión a cita.
- Conversión por agente.
- Conversión por canal.
- Tiempo hasta agendar.
- Abandono por etapa.
- Motivos de pérdida.
- Clientes recurrentes.
- Retoques pendientes.

## 22.3 Inteligencia artificial

- Tokens.
- Costos.
- Modelo usado.
- Tools usadas.
- Fallos.
- Respuestas corregidas.
- Handoffs.
- Preguntas sin respuesta.
- Calidad.
- Costo por cita generada.

---

# 23. Panel inicial

```text
Inicio

Atención
├── Conversaciones
├── Contactos
└── Tareas

Ventas
├── Pipelines
├── Citas
└── Seguimientos

Inteligencia
├── Agentes
├── Conocimiento
├── Mejoras propuestas
└── Evaluaciones

Administración
├── Canales
├── Automatizaciones
├── Equipo y permisos
├── Métricas
└── Configuración
```

## 23.1 Conversaciones

Filtros:

- Agente.
- Canal.
- Número.
- Colaborador.
- Pipeline.
- Etapa.
- Estado.
- Servicio.
- Etiqueta.
- Handoff.
- Periodo.

Detalle:

- Mensajes.
- Contacto.
- Pipeline.
- Cita.
- Agente.
- Modo.
- Tool calls.
- Notas.
- Historial.
- Sugerencias.

---

# 24. Herramientas recomendadas

## 24.1 Herramientas públicas

- `search_public_knowledge`
- `list_services`
- `get_service_details`
- `get_business_hours`
- `get_available_slots`
- `request_appointment`
- `get_own_appointment`
- `request_human_handoff`

## 24.2 Herramientas internas

- `search_contacts`
- `get_contact_profile`
- `list_appointments`
- `update_contact`
- `move_pipeline_stage`
- `create_followup_task`
- `add_internal_note`
- `get_conversation_summary`
- `list_stalled_opportunities`
- `get_business_metrics`

## 24.3 Herramientas administrativas

- `create_agent`
- `create_agent_version`
- `publish_agent_version`
- `rollback_agent_version`
- `create_pipeline`
- `update_pipeline`
- `create_automation`
- `update_knowledge`
- `approve_improvement`
- `reject_improvement`

## 24.4 Herramientas del supervisor

- `analyze_conversation`
- `detect_knowledge_gap`
- `propose_agent_change`
- `generate_evaluation_cases`
- `compare_agent_versions`
- `measure_conversion_drop`
- `detect_repeated_handoffs`

---

# 25. Contratos recomendados

## 25.1 Mensaje normalizado

```ts
type NormalizedInboundMessage = {
  organizationId: string;
  channelId: string;
  provider: "whatsapp";
  externalMessageId: string;
  externalContactId: string;
  messageType: "text" | "audio" | "image" | "document";
  text?: string;
  mediaUrl?: string;
  receivedAt: string;
  rawEventRef?: string;
};
```

`provider: "whatsapp"` identifica el canal, no el adaptador. Para Zernio,
`externalMessageId` conserva el identificador opaco del mensaje y
`rawEventRef` puede referenciar el ID estable del evento ya deduplicado, nunca
el payload completo. La cuenta externa se resuelve antes de construir este
contrato; no se acepta un `organizationId` declarado por el proveedor.

## 25.2 Resultado del agente

```ts
type AgentRunResult = {
  responseText: string;
  confidence?: number;
  requestedHandoff: boolean;
  suggestedPipelineStageId?: string;
  extractedFacts?: Record<string, unknown>;
  toolCalls: ToolCallRecord[];
  citations?: KnowledgeCitation[];
  model: string;
  usage?: {
    inputTokens?: number;
    outputTokens?: number;
    costUsd?: number;
  };
};
```

## 25.3 Correlation ID

Todo el flujo debe compartir:

```text
correlation_id
```

Para rastrear:

```text
webhook
→ queue
→ durable object
→ agent run
→ tool
→ outbound
→ provider response
```

---

# 26. Idempotencia

Debe evitarse:

- Mensajes duplicados.
- Citas duplicadas.
- Leads duplicados.
- Cambios de etapa repetidos.
- Tool calls repetidas.
- Envíos duplicados.

Usar:

```text
external_message_id
idempotency_key
correlation_id
unique constraints
```

---

# 27. Observabilidad

Registrar:

- Logs estructurados.
- Trazas.
- Duración.
- Colas.
- Retries.
- Errores.
- Tool calls.
- Modelos.
- Uso.
- Costos.
- Cambios de estado.

Nunca registrar:

- API keys.
- Tokens.
- Secretos.
- Contenido sensible innecesario.
- Datos completos sin redacción.

---

# 28. Entornos

Configurar:

```text
local
staging
production
```

Reglas:

- No desplegar directamente a producción durante desarrollo.
- Usar preview o staging.
- Declarar bindings por entorno.
- Separar secretos.
- Separar recursos.
- Ejecutar pruebas antes de desplegar.

Flujo:

```text
rama
→ pruebas
→ deploy staging
→ validación
→ pull request
→ producción
```

---

# 29. Reglas para agentes de codificación

## 29.1 Antes de modificar arquitectura

El agente debe:

1. Leer este documento.
2. Leer `AGENTS.md`.
3. Revisar `wrangler.jsonc`.
4. Revisar migraciones.
5. Verificar contratos.
6. Identificar la fuente de verdad.
7. Evitar duplicar responsabilidades.

## 29.2 No hacer

- No agregar secretos al repositorio.
- No crear recursos en producción sin autorización.
- No introducir una segunda base para datos ya definidos en D1.
- No almacenar todo en Durable Objects.
- No usar prompts como único control de seguridad.
- No crear forks por empresa.
- No mezclar estado operativo, pipeline y citas.
- No autoaprobar mejoras.
- No agregar dependencias sin justificación.
- No desplegar sin pruebas.
- No borrar migraciones aplicadas.
- No cambiar contratos públicos sin compatibilidad o migración.

## 29.3 Sí hacer

- Mantener TypeScript estricto.
- Validar inputs.
- Aplicar schemas.
- Escribir pruebas.
- Crear migraciones.
- Registrar ADRs.
- Documentar bindings.
- Aplicar mínimo privilegio.
- Crear interfaces por dominio.
- Mantener adaptadores de canales desacoplados.
- Usar repositorios para acceso a D1.
- Mantener servicios pequeños.
- Implementar idempotencia.
- Registrar auditoría.

---

# 30. Documentos recomendados

```text
.docs/
├── architecture/
│   ├── overview.md
│   ├── data-ownership.md
│   ├── message-lifecycle.md
│   ├── agent-runtime.md
│   ├── security-model.md
│   └── cloudflare-resources.md
│
├── product/
│   ├── vision.md
│   ├── beauty-salon-mvp.md
│   └── roadmap.md
│
├── decisions/
│   ├── ADR-0001-cloudflare-native.md
│   ├── ADR-0002-d1-source-of-truth.md
│   ├── ADR-0003-conversation-agent.md
│   └── ADR-0004-human-approval.md
│
└── operations/
    ├── local-development.md
    ├── staging.md
    ├── deployment.md
    └── incident-response.md
```

---

# 31. Fases recomendadas

## Fase 0 — Fundamentos

- Visión.
- Modelo de dominio.
- Multiempresa preparada.
- Autenticación.
- Roles.
- D1.
- Entornos.
- AGENTS.md.
- ADRs.
- Contratos.
- Staging.

## Fase 1 — WhatsApp funcional

- Adaptador bidireccional de Zernio.
- Verificación HMAC del webhook sobre el cuerpo crudo.
- Resolución confiable de cuenta, canal y organización.
- Dedupe.
- Queue inbound.
- Durable Object por conversación.
- Buffer.
- Respuesta.
- Queue outbound.
- Estados de entrega, lectura, fallo y desconexión.
- Inbox.
- Handoff humano.

## Fase 2 — CRM

- Contactos.
- Conversaciones.
- Equipos.
- Asignación.
- Notas.
- Pipelines.
- Tareas.
- Citas.
- Métricas iniciales.

## Fase 3 — Agentes

- Agentes configurables.
- Versionado.
- RAG.
- Tools.
- Routing.
- Memoria.
- Modo supervisado.
- Presupuesto.
- Failover.

## Fase 4 — Automatización

- Seguimientos.
- Confirmaciones.
- Workflows.
- Campañas.
- Reactivación.
- Recordatorios de retoque.

## Fase 5 — Mejora continua

- Supervisor.
- Evaluaciones.
- Propuestas.
- Evidencia.
- Aprobación.
- Versionado.
- Rollback.
- Analítica avanzada.

## Fase 6 — Nuevos canales y giros

- Instagram.
- Messenger.
- Chat web.
- Nuevos paquetes empresariales.
- Evolución a SaaS multiempresa.

---

# 32. Criterio de éxito del MVP

El MVP será exitoso cuando una empresa pueda:

1. Conectar WhatsApp.
2. Recibir mensajes.
3. Ver conversaciones.
4. Asignar un agente.
5. Responder automáticamente.
6. Intervenir como humano.
7. Registrar contacto.
8. Moverlo en un pipeline.
9. Crear o consultar una cita.
10. Configurar conocimiento.
11. Consultar métricas.
12. Recibir una propuesta de mejora.
13. Aprobar una nueva versión.
14. Ver que la nueva versión mejora el flujo.

---

# 33. Dirección definitiva

El producto debe evolucionar hacia:

```text
CRM
+ inbox multicanal
+ agentes
+ pipelines
+ agenda
+ automatizaciones
+ conocimiento
+ memoria
+ métricas
+ supervisión
+ mejora continua
```

La primera edición debe mantenerse enfocada:

> CRM conversacional inteligente para salones de belleza.

Después de validar esta vertical, se crearán paquetes empresariales para otros giros sobre el mismo núcleo.

---

# 34. Regla final para decisiones futuras

Antes de agregar cualquier funcionalidad, responder:

1. ¿Ayuda a recibir, entender, gestionar o convertir una conversación?
2. ¿Pertenece al núcleo o a un paquete empresarial?
3. ¿Cuál es su fuente de verdad?
4. ¿Qué permisos requiere?
5. ¿Necesita Worker, Durable Object, Queue o Workflow?
6. ¿Cómo se audita?
7. ¿Cómo se prueba?
8. ¿Cómo se revierte?
9. ¿Puede cruzar datos entre empresas?
10. ¿Aporta al MVP de salones?

Si no existe una respuesta clara, la funcionalidad no debe implementarse todavía.
