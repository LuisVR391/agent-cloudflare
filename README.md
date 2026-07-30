# Agent Cloudflare

Base de un agente de atención a clientes por WhatsApp construido sobre el
ecosistema de Cloudflare.

El repositorio inicia con una SPA pequeña en React 19 y TypeScript, servida por
el mismo Cloudflare Worker que hospeda el agente persistente del Agents SDK.
La pantalla consulta `/api/health` para verificar que frontend y Worker están
integrados.

## Arquitectura inicial

```text
WhatsApp Cloud API
        |
        v
Cloudflare Worker (webhook y validación)
        |
        v
CustomerSupportAgent (Agents SDK + Durable Object/SQLite)
        |
        +--> Workers AI       Respuestas y clasificación
        +--> R2               Archivos y medios
        +--> Queues           Procesamiento asíncrono
        +--> Workflows        Procesos durables de varios pasos
        +--> Vectorize        Recuperación de conocimiento futura

React 19 + Vite <--> Worker / Agents SDK
```

### Lo que ya está preparado

- Cloudflare Workers como runtime y punto de entrada.
- `CustomerSupportAgent` con estado persistente mediante Durable Objects.
- Workers AI como binding `AI`.
- R2 como binding `MEDIA_BUCKET`.
- Assets de React servidos por el mismo Worker.
- Observabilidad de Workers habilitada.
- Tipos de bindings generados por Wrangler.
- Prueba de integración ejecutada dentro del runtime de Workers.
- Exclusión de secretos y archivos locales sensibles.

La recepción real de WhatsApp todavía no se implementa. Antes de habilitarla se
necesitan una app de Meta, un número de WhatsApp Business y sus credenciales.
El webhook deberá validar tanto el token de verificación como
`X-Hub-Signature-256`, deduplicar eventos y responder rápidamente antes de
procesar trabajos largos.

## Requisitos

- Node.js 22 recomendado (mínimo 20).
- Una cuenta de Cloudflare.
- Wrangler autenticado con `npx wrangler login`.

## Desarrollo local

```bash
nvm use
npm ci
cp .dev.vars.example .dev.vars
npm run cf-typegen
npm run dev
```

No necesitas credenciales reales para ver la página inicial y consultar
`/api/health`.

## Comandos

| Comando | Descripción |
| --- | --- |
| `npm run dev` | Inicia React y el Worker con el plugin de Cloudflare para Vite |
| `npm run build` | Construye frontend/Worker y valida TypeScript |
| `npm run preview` | Ejecuta localmente el artefacto final de Workers |
| `npm test` | Ejecuta pruebas en el runtime de Cloudflare |
| `npm run cf-typegen` | Regenera `worker-configuration.d.ts` |
| `npm run check` | Ejecuta tipos, pruebas y build |
| `npm run deploy:dry` | Valida el paquete de despliegue sin publicarlo |
| `npm run deploy` | Despliega a Cloudflare |

## Recursos de Cloudflare

La configuración declara el bucket `agent-cloudflare-media`. Créalo antes del
primer despliegue:

```bash
npx wrangler r2 bucket create agent-cloudflare-media
```

No se crea automáticamente desde este repositorio para evitar modificar una
cuenta de Cloudflare sin intención explícita.

## Secretos de WhatsApp

Para desarrollo local, copia `.dev.vars.example` a `.dev.vars`. En Cloudflare,
registra cada valor de forma interactiva:

```bash
npx wrangler secret put WHATSAPP_VERIFY_TOKEN
npx wrangler secret put WHATSAPP_APP_SECRET
npx wrangler secret put WHATSAPP_ACCESS_TOKEN
npx wrangler secret put WHATSAPP_PHONE_NUMBER_ID
```

No pases secretos como argumentos ni los agregues a `wrangler.jsonc`.

## Despliegue

1. Autentica Wrangler: `npx wrangler login`.
2. Crea los recursos declarados que aún no existan.
3. Ejecuta `npm run check`.
4. Valida el paquete con `npm run deploy:dry`.
5. Publica con `npm run deploy`.

Vite genera el cliente en `dist/client` y el Worker junto con su configuración
de despliegue en otro subdirectorio de `dist`. Wrangler detecta ese artefacto
al desplegar.

## Próximas etapas

1. Implementar y probar la verificación del webhook de Meta.
2. Encolar mensajes entrantes y deduplicarlos por ID.
3. Incorporar respuestas con Workers AI y guardrails.
4. Descargar medios validados a R2.
5. Agregar historial operativo y herramientas de supervisión al frontend.
6. Incorporar Vectorize/RAG y derivación a una persona.

Consulta [SECURITY.md](./SECURITY.md) antes de integrar credenciales o datos
reales de clientes.
