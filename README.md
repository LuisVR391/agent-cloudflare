# Agent Cloudflare

CRM conversacional inteligente, multicanal y configurable por empresa,
construido sobre Cloudflare. Su primera edición estará enfocada en salones de
belleza y automatizará atención, ventas, agenda, seguimiento y mejora continua
desde una sola interfaz.

> El repositorio se encuentra en una etapa inicial. Actualmente contiene la
> base técnica del Worker, un agente durable, autenticación cerrada y la base
> del panel administrativo; todavía no es un CRM funcional ni recibe mensajes
> reales de WhatsApp.

## Objetivo del producto

Agent Cloudflare debe permitir que una empresa administre desde un solo panel:

- Canales de atención y conversaciones.
- Contactos, prospectos y oportunidades.
- Pipelines comerciales, citas y tareas de seguimiento.
- Agentes de inteligencia artificial y sus herramientas.
- Conocimiento empresarial y automatizaciones.
- Métricas, supervisión y propuestas de mejora.

El primer flujo que se validará de extremo a extremo es:

```text
Mensaje
  -> atención
  -> calificación
  -> cita
  -> servicio
  -> seguimiento
  -> retoque
```

El núcleo será común para todas las empresas. Las particularidades de cada giro
se incorporarán mediante configuración y paquetes empresariales, sin crear
forks del producto.

## Estado actual

| Capacidad | Estado | Evidencia |
| --- | --- | --- |
| Worker y API HTTP | Implementada | `src/worker/index.ts` y `GET /api/health` |
| SPA React servida por el Worker | Implementada | Landing, `/setup`, `/login`, `/app`, React 19, Tailwind y shadcn/ui |
| Agente durable | Base implementada | `CustomerSupportAgent` con estado inicial |
| Workers AI | Binding preparado | Binding `AI` declarado, sin flujo de inferencia |
| R2 | Binding preparado | `MEDIA_BUCKET` declarado, sin ingestión de medios |
| Observabilidad | Configurada | Logs y trazas habilitados en Wrangler |
| D1 en local y pruebas | Base implementada | Migraciones `0001` y `0002`, repositorios y aislamiento probado |
| Autenticación y autorización | Implementada en rama de Issue #6 | Better Auth, sesión D1, instalación única, roles fijos y contexto organizacional |
| Panel de conversaciones y agentes | Planificado | Navegación reservada y deshabilitada; no existen todavía módulos operativos |
| WhatsApp Cloud API | Planificada | Secretos de ejemplo; no existe webhook funcional |
| Queues, Workflows y Vectorize | Planificadas | Forman parte de la arquitectura objetivo, no de la configuración actual |
| CRM, inbox, agenda y pipelines | Planificados | Pendientes de las fases de producto |
| Versionado, evaluación y mejora de agentes | Planificados | Fuera del prototipo actual |

`CustomerSupportAgent` demuestra identidad y estado durable, pero todavía no
implementa el runtime conversacional definido para el producto.

La base D1 existe en local y en pruebas con datos de organizaciones, contactos,
identidad, sesión y autorización. Las rutas del panel validan identidad,
membresía, organización activa y permisos en backend. No hay ninguna base
creada en Cloudflare ni un entorno remoto configurado.

## Arquitectura objetivo

```text
WhatsApp Cloud API
        |
        v
Webhook Worker
  - verifica token y firma
  - valida y deduplica el evento
  - registra la recepción
  - responde HTTP 200 rápidamente
        |
        v
Inbound Queue
        |
        v
Conversation Agent
Durable Object por conversación
  - orden y buffer de mensajes
  - estado de atención
  - agente y versión asignados
  - coordinación y herramientas
        |
        +--> D1             CRM y configuración empresarial
        +--> Vectorize      Recuperación de conocimiento
        +--> R2             Archivos y medios
        +--> Workers AI     Inferencia y tareas de IA
        +--> Workflows      Procesos largos y recuperables
        |
        v
Outbound Queue
        |
        v
WhatsApp Cloud API

React 19 + Vite <--> Worker / Agents SDK
```

Cada servicio tendrá una responsabilidad definida:

- **D1:** fuente de verdad de CRM, configuración y datos relacionales.
- **Agents SDK y Durable Objects:** estado vivo y coordinación por
  conversación.
- **Queues:** transporte asíncrono, desacoplamiento y reintentos.
- **Workflows:** seguimientos, esperas y procesos durables de varios pasos.
- **R2:** contenido binario y documentos originales.
- **Vectorize:** recuperación semántica filtrada siempre por empresa.

Todas las entidades relevantes deberán estar preparadas para
`organization_id`. Los permisos se validarán en backend antes de exponer o
ejecutar herramientas; los prompts no serán un control de seguridad.

## Alcance del MVP

La primera edición está limitada a un CRM conversacional para salones de
belleza, con WhatsApp Cloud API como primer canal. El MVP deberá permitir:

1. Conectar un canal de WhatsApp y procesar mensajes de forma segura.
2. Consultar conversaciones y contactos desde un inbox.
3. Asignar un agente, responder automáticamente e intervenir como humano.
4. Gestionar prospectos, pipeline y citas.
5. Configurar conocimiento y consultar métricas iniciales.
6. Evaluar cambios del agente y publicar una nueva versión con aprobación
   humana y posibilidad de rollback.

No forman parte del MVP la contabilidad, nómina, punto de venta completo,
inventario avanzado, administración completa de anuncios, marketplace de
agentes, fine-tuning automático ni el soporte simultáneo para múltiples giros.

## Fases

| Fase | Resultado esperado |
| --- | --- |
| [0. Fundamentos](./.docs/product/roadmap.md#fase-0--fundamentos) | Dominio, D1, autenticación, roles, contratos, ADRs, entornos y staging |
| [1. WhatsApp funcional](./.docs/product/roadmap.md#fase-1--whatsapp-funcional) | Webhook seguro, deduplicación, colas, conversación durable, buffer, inbox y handoff |
| [2. CRM](./.docs/product/roadmap.md#fase-2--crm) | Contactos, conversaciones, equipos, pipelines, tareas, citas y métricas iniciales |
| [3. Agentes](./.docs/product/roadmap.md#fase-3--agentes) | Configuración, versiones, RAG, tools, routing, memoria, supervisión y failover |
| [4. Automatización](./.docs/product/roadmap.md#fase-4--automatización) | Seguimientos, confirmaciones, campañas, reactivación y recordatorios |
| [5. Mejora continua](./.docs/product/roadmap.md#fase-5--mejora-continua) | Supervisor, evaluaciones, propuestas, aprobación, publicación y rollback |
| [6. Expansión](./.docs/product/roadmap.md#fase-6--expansión) | Nuevos canales, paquetes empresariales y evolución multiempresa |

La descomposición técnica y el estado de cada documento se mantienen en el
[roadmap de producto](./.docs/product/roadmap.md) y el
[índice de documentación](./.docs/README.md). La visión y las decisiones
arquitectónicas completas permanecen en la
[guía de arquitectura y producto](./.docs/guia-arquitectura-producto.md).

## Requisitos

- Node.js 22.18 o posterior.
- Una cuenta de Cloudflare.
- Wrangler autenticado con `npx wrangler login`.

## Desarrollo local

```bash
nvm use
npm ci
cp .dev.vars.example .dev.vars
npm run cf-typegen
npm run db:migrate
npm run dev
```

El servidor local usa `http://localhost:5190`. El puerto es estricto para
mantener estable el origen utilizado por la autenticación.

No se necesitan credenciales reales para abrir la página inicial y consultar
`/api/health`. Para probar `/setup`, `/login` y `/app`, configura los secretos
locales descritos en [operación de autenticación](./.docs/operations/authentication.md).
`npm run db:migrate` aplica el esquema sobre la base D1 local; el flujo de D1
está en [base de datos local](./.docs/operations/local-database.md).

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia React y el Worker mediante el plugin de Cloudflare para Vite |
| `npm run build` | Construye frontend y Worker, y valida TypeScript |
| `npm run preview` | Ejecuta localmente el artefacto final |
| `npm test` | Ejecuta pruebas de Worker/D1 y de componentes React |
| `npm run cf-typegen` | Regenera los tipos de bindings de Wrangler |
| `npm run db:migrate` | Aplica las migraciones de D1 en la base local |
| `npm run db:migrations:list` | Muestra las migraciones de D1 pendientes en local |
| `npm run check` | Ejecuta tipos, pruebas y build |
| `npm run deploy:dry` | Valida el paquete de despliegue sin publicarlo |
| `npm run deploy` | Construye y despliega a Cloudflare |

## Recursos y secretos actuales

La configuración actual declara el bucket `agent-cloudflare-media`. Debe
crearse antes del primer despliegue:

```bash
npx wrangler r2 bucket create agent-cloudflare-media
```

El binding `DB` declara la base `agent-cloudflare-db` con un `database_id`
marcador que solo sirve para desarrollo local y pruebas. La base real se creará
con autorización explícita al definir entornos, sustituyendo el marcador por el
identificador devuelto:

```bash
npx wrangler d1 create agent-cloudflare-db
```

Los recursos futuros de Queues, Workflows y Vectorize se incorporarán con su
fase correspondiente y no deben crearse anticipadamente en producción.

Para desarrollo local, copia `.dev.vars.example` a `.dev.vars`. En Cloudflare,
registra los secretos de autenticación y WhatsApp de forma interactiva:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put AUTH_SETUP_TOKEN
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
```

No pases secretos como argumentos ni los agregues a `wrangler.jsonc`.

## Validación y despliegue

1. Trabaja y valida localmente.
2. Ejecuta `npm run check`.
3. Ejecuta `npm run deploy:dry`.
4. Despliega primero a un entorno aislado de staging cuando esté configurado.
5. Publica en producción únicamente después de la validación y aprobación
   correspondientes.

Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para las convenciones técnicas y
[SECURITY.md](./SECURITY.md) antes de integrar credenciales o datos reales.
