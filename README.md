# Agent Cloudflare

CRM conversacional inteligente, multicanal y configurable por empresa,
construido sobre Cloudflare. Su primera edición estará enfocada en salones de
belleza y automatizará atención, ventas, agenda, seguimiento y mejora continua
desde una sola interfaz.

> Fase 1 está completada y validada en staging con tráfico real: los mensajes
> de WhatsApp se reciben una sola vez y en orden, una persona autorizada
> responde desde el inbox y la respuesta recorre `Enviado → Entregado → Leído`,
> y los medios entrantes se conservan en R2 y se abren desde la conversación.
> Fase 2 está en progreso: el contacto tiene una ficha consultable y editable
> con teléfono, correo y etiquetas, el equipo se incorpora por invitación y
> asigna responsables a sus conversaciones, y la organización declara su
> catálogo de servicios y el pipeline comercial por el que avanzará una
> oportunidad.
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
| SPA React servida por el Worker | Implementada | Landing, `/setup`, `/login`, `/app`, React 19, Tailwind y shadcn/ui; shell y hilo compuestos con primitivas del registro ([ADR-0009](.docs/decisions/ADR-0009-client-ui-composition.md)) |
| Agente durable | Base implementada | `CustomerSupportAgent` coordina cada conversación y sus conexiones en vivo |
| Workers AI | Binding preparado | Binding `AI` declarado, sin flujo de inferencia |
| R2 | Implementada para Fase 1 | `MEDIA_BUCKET` conserva imágenes, audio y archivos con estado por adjunto; validado con medios reales en staging |
| Observabilidad | Configurada | Logs y trazas habilitados en Wrangler |
| D1 en local y pruebas | Implementada para Fase 1 y los tres primeros cortes de Fase 2 | Migraciones `0001` a `0013`, repositorios, mensajes, entregas, adjuntos, contactos, equipo, servicios, pipeline y aislamiento probado |
| Autenticación y autorización | Implementada | Better Auth, sesión D1, instalación única, alta por invitación ([ADR-0011](.docs/decisions/ADR-0011-collaborator-invitations.md)), roles fijos y contexto organizacional |
| Entornos y staging | Staging desplegado | Recursos aislados; producción sigue sin provisionar |
| Panel de conversaciones | Implementado para Fase 1 y ampliado en Fase 2 | Inbox protegido con sidebar fijo y paneles de scroll independiente, historial, recepción en vivo, handoff, estados de entrega, adjuntos con nombre, miniatura y descarga, y filtro por responsable |
| Panel de contactos | Implementado para Fase 2 | Directorio buscable, ficha editable con teléfono, correo y etiquetas, y la misma ficha abierta desde la conversación |
| Panel de equipo | Implementado para Fase 2 | Miembros con su rol, invitaciones con enlace de un solo uso y revocación |
| Panel de servicios | Implementado para Fase 2 | Catálogo con duración, precio opcional en su moneda y archivado en lugar de borrado |
| Panel de pipeline | Implementado para Fase 2 | Tablero con las etapas configuradas y su orden; las oportunidades que las recorren siguen planificadas |
| Panel de agentes | Planificado | Navegación reservada y deshabilitada |
| WhatsApp mediante Zernio | Implementado para Fase 1 | Recorrido bidireccional validado con tráfico real, incluidos estados de entrega y medios entrantes |
| Queues, Workflows y Vectorize | Parcial | Queues de entrada/salida y DLQ provisionadas en staging; Workflows y Vectorize permanecen planificados |
| CRM, agenda y pipelines | Parcial | Contactos con ficha y etiquetas, equipo con asignación de conversaciones, catálogo de servicios y pipeline configurable están implementados; oportunidades, tareas, citas y métricas siguen planificados en Fase 2 |
| Versionado, evaluación y mejora de agentes | Planificados | Fuera del prototipo actual |

`CustomerSupportAgent` coordina el estado vivo de cada conversación sin
reemplazar el historial canónico de D1; el procesamiento automático mediante
agentes permanece fuera de este corte.

La base D1 conserva organizaciones, autenticación, canales, contactos,
conversaciones, mensajes e intentos de entrega con aislamiento por organización.
Las rutas del panel recalculan identidad, membresía y permisos en backend.
Staging dispone de D1, R2, Durable Object, Queues de entrada/salida, DLQ,
Worker y secretos aislados. El recorrido bidireccional está verificado con
tráfico real: un mensaje se recibe una sola vez y en orden, una respuesta
humana llega a WhatsApp y recorre `Enviado → Entregado → Leído`, y los medios
entrantes se copian a R2 y se descargan desde el inbox. Un adjunto que no puede
conservarse queda registrado con su motivo y no impide que el mensaje aparezca.

El producto no emite acuses de lectura hacia el contacto: la cuenta operada es
de coexistencia y el proveedor no sobrescribe el estado de lectura que posee la
app de WhatsApp Business. Los mensajes salientes anteriores a la corrección del
contrato de envío permanecen en `delivery_unknown`, porque no conservan el
identificador del proveedor y vincularlos por contenido está prohibido.
Producción permanece sin recursos ni ruta pública.

## Arquitectura objetivo

```text
WhatsApp
        |
        v
Zernio
  - conecta las cuentas del canal
  - entrega webhooks y transporta respuestas
        |
        v
Webhook Worker
  - verifica firma HMAC de Zernio
  - valida y deduplica el evento
  - resuelve cuenta, canal y organización
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
Zernio API
        |
        v
WhatsApp

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
belleza, con WhatsApp mediante Zernio como primer canal. Zernio será solo el
adaptador de transporte; el CRM, inbox, agentes, automatizaciones e historial
canónico permanecerán en Agent Cloudflare. El MVP deberá permitir:

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
| [1. WhatsApp funcional](./.docs/product/roadmap.md#fase-1--whatsapp-funcional) | Webhook firmado de Zernio, adaptador de salida, deduplicación, colas, conversación durable, inbox y handoff |
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
| `npm run dev:inbound` | Envía un mensaje entrante firmado al servidor local para poblar el inbox |
| `npm run check` | Ejecuta guardrails, tipos, pruebas, build y dry-run de staging |
| `npm run check:staging` | Construye y valida `env.staging` sin publicar |
| `npm run deploy:staging` | Construye y despliega únicamente a staging; requiere autorización explícita para el artefacto actual |

## Recursos y secretos actuales

La configuración base declara `agent-cloudflare-db` y
`agent-cloudflare-media` para simulación local. `env.staging` y
`env.production` repiten los bindings sobre nombres de recursos separados. Staging
usa recursos reales y el origen
`https://agent-cloudflare-staging.luisvr391.workers.dev`; los marcadores
`.invalid` permanecen únicamente en producción.

El bootstrap reproducible, los nombres exactos y los gates de despliegue están
en [entornos y staging](./.docs/operations/environments.md). Producción no tiene
ruta pública ni script de despliegue.

Los recursos futuros de Queues, Workflows y Vectorize se incorporarán con su
fase correspondiente y no deben crearse anticipadamente en producción.

Para desarrollo local, copia `.dev.vars.example` a `.dev.vars`. Cuando staging
sea autorizado, registra únicamente los secretos usados por la autenticación
actual mediante prompts interactivos y dirigidos al entorno:

```bash
npx wrangler secret put BETTER_AUTH_SECRET --env staging
npx wrangler secret put AUTH_SETUP_TOKEN --env staging
```

`ZERNIO_API_KEY` y `ZERNIO_WEBHOOK_SECRET` son consumidos por el adaptador de
Zernio y están cargados como secretos exclusivos de staging. Las cuentas siguen conectándose manualmente desde Zernio; sus credenciales
nunca se guardan en D1. No pases secretos
como argumentos ni los agregues a `wrangler.jsonc`. `BETTER_AUTH_URL` es un
valor público obligatorio y debe contener el origen exacto de cada entorno,
sin ruta. Mientras conserve un marcador `.invalid`, la autenticación remota
falla de forma cerrada.

## Validación y despliegue

1. Trabaja y valida localmente.
2. Ejecuta `npm run check`.
3. Ejecuta `npm run check:staging` y revisa los bindings mostrados.
4. Sigue el runbook y despliega primero a staging solo con autorización.
5. Publica en producción únicamente después de la validación y aprobación
   correspondientes.

Consulta [CONTRIBUTING.md](./CONTRIBUTING.md) para las convenciones técnicas y
[SECURITY.md](./SECURITY.md) antes de integrar credenciales o datos reales.
