# Base de datos local

Describe cómo trabajar con la base D1 del repositorio en desarrollo y en
pruebas. Las convenciones del esquema están en
[ADR-0006](../decisions/ADR-0006-d1-schema-conventions.md) y la autoridad de D1
sobre los datos empresariales en
[ADR-0002](../decisions/ADR-0002-d1-source-of-truth.md).

## Estado del recurso

`wrangler.jsonc` declara el binding `DB` sobre la base `agent-cloudflare-db`
con `database_id` marcador. **No existe ninguna base creada en la cuenta de
Cloudflare.** El marcador basta para desarrollo local y pruebas, donde Wrangler
y Miniflare mantienen un SQLite bajo `.wrangler/state/`.

Los bindings remotos ya tienen nombres y marcadores separados en
`wrangler.jsonc`. Crear el recurso real pertenece al bootstrap humano descrito
en [entornos y staging](./environments.md); requiere autorización explícita y
sustituir el `database_id` del entorno por el identificador devuelto:

```bash
npx wrangler d1 create agent-cloudflare-staging-db
```

Un despliegue real fallará mientras el marcador siga en la configuración. Eso
es deliberado: impide publicar contra una base inexistente por descuido.

## Aplicar migraciones

```bash
npm run db:migrate          # aplica las migraciones pendientes
npm run db:migrations:list  # muestra cuáles faltan por aplicar
```

Ambos scripts fijan `--local`. La ejecución remota de D1 desde un agente de
codificación está bloqueada por los guardrails descritos en
[continuidad de agentes](./agent-continuity.md).

## Inspeccionar

```bash
npx wrangler d1 execute agent-cloudflare-db --local \
  --command "SELECT name FROM sqlite_master WHERE type = 'table' ORDER BY name"

npx wrangler d1 execute agent-cloudflare-db --local \
  --command "SELECT id, slug, status FROM organizations"
```

Una consulta manual no sustituye a los repositorios: el código de la aplicación
accede a D1 únicamente a través de `src/worker/repositories/`.

## Sembrar una conversación

Una base recién migrada no tiene canales ni conversaciones, así que el panel se
abre vacío y no hay nada que validar en el inbox ni en los contactos. Insertar
filas a mano tampoco sirve de mucho: se saltaría la deduplicación, la cola y el
runtime, que es justo lo que conviene ejercitar.

Con `npm run dev` en marcha y la instalación completada en `/setup`:

```bash
npm run dev:inbound -- --text "¿Tienen espacio hoy?" --phone "+52 55 1234 5678"
```

El script firma un evento `message.received` con `ZERNIO_WEBHOOK_SECRET` y lo
envía a `/webhooks/zernio`, de modo que el mensaje recorre webhook, cola,
Durable Object y D1 igual que uno real. La primera ejecución crea también el
canal local que el webhook necesita para resolver organización y hilo; sin él
respondería `UNKNOWN_CHANNEL`.

| Opción | Para qué |
| --- | --- |
| `--conversation <id>` | Repetir el mismo identificador continúa el hilo en vez de abrir otro |
| `--event <id>` | Repetir el mismo identificador comprueba que la deduplicación ignora el reenvío |
| `--phone <número>` | Cambiarlo produce un contacto distinto |
| `--origin <url>` | Otro puerto local |

El script solo acepta `localhost`. Firmar eventos falsos contra staging o
producción inventaría conversaciones en una base real, así que el límite es
parte del diseño y no una comodidad. El secreto se lee de `.dev.vars` dentro
del proceso y nunca se imprime.

## Restablecer

```bash
rm -rf .wrangler/state
npm run db:migrate
```

`.wrangler/state` está ignorado por git y contiene también el almacenamiento
local de los Durable Objects, que se pierde con este comando. Es la forma de
comprobar que una migración aplica desde una base verdaderamente vacía.

## Pruebas

Las pruebas no dependen de los pasos anteriores ni del estado de
`.wrangler/state`. `vitest.config.ts` lee `migrations/` con `readD1Migrations`
e inyecta el resultado como binding de prueba; `test/apply-migrations.ts` lo
aplica con `applyD1Migrations` en cada archivo, que corre con almacenamiento
aislado. Una migración nueva queda cubierta sin configuración adicional.

```bash
npm test
```

`test/migrations.test.ts` verifica el esquema aplicado desde vacío,
`test/repositories/isolation.test.ts` verifica que ninguna consulta cruza
organizaciones y `test/authentication.test.ts` recorre instalación, cierre del
registro, inicio de sesión y contexto organizacional.

## Reglas que no cambian en local

- No se guardan secretos en D1. Las credenciales viven en Cloudflare Secrets y
  D1 solo conserva referencias opacas y metadatos.
- Una migración ya versionada no se edita ni se borra; un cambio posterior es
  siempre un archivo nuevo en `migrations/`.
- Toda tabla empresarial lleva `organization_id` y todo acceso lo filtra.
