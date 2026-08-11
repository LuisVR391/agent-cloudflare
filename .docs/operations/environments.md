# Entornos y staging

Este runbook define la separación entre desarrollo local, staging y
producción. Implementa la estrategia de entornos de la
[guía rectora](../guia-arquitectura-producto.md), respeta los bindings de
[ADR-0001](../decisions/ADR-0001-cloudflare-native.md) y conserva a D1 como
fuente de verdad conforme a
[ADR-0002](../decisions/ADR-0002-d1-source-of-truth.md).

## Estado actual

Staging fue provisionado y desplegado el 2026-08-10 bajo `workers.dev`. Sus
recursos, secretos y datos están aislados de local y producción. Los marcadores
`.invalid` de producción permanecen deliberadamente cerrados.

| Entorno | Responsabilidad | Estado remoto |
| --- | --- | --- |
| Local | Desarrollo y pruebas con estado de Miniflare bajo `.wrangler/` | No usa recursos remotos |
| Staging | Validación integrada con datos sintéticos antes de producción | Desplegado e instalado; canal Zernio activo |
| Producción | Datos y tráfico reales después de aprobación explícita | No provisionado y sin ruta pública |

Staging usa `workers.dev` para evitar introducir DNS o dominios propios en
esta fase. Producción tiene `workers_dev: false`, no declara rutas y no dispone
de un script de despliegue.

## Inventario y aislamiento

| Recurso o valor | Local | Staging | Producción |
| --- | --- | --- | --- |
| Worker | `agent-cloudflare` | `agent-cloudflare-staging` | `agent-cloudflare-production` |
| D1 `DB` | `agent-cloudflare-db` local | `agent-cloudflare-staging-db` | `agent-cloudflare-production-db` |
| R2 `MEDIA_BUCKET` | `agent-cloudflare-media` local | `agent-cloudflare-staging-media` | `agent-cloudflare-production-media` |
| Durable Object | Namespace local | Namespace del Worker de staging | Namespace del Worker de producción |
| Queue `INBOUND_MESSAGES` | `agent-cloudflare-inbound` | `agent-cloudflare-staging-inbound` | `agent-cloudflare-production-inbound` planificada |
| Queue `OUTBOUND_MESSAGES` | `agent-cloudflare-outbound` | `agent-cloudflare-staging-outbound` pendiente de provisión | `agent-cloudflare-production-outbound` planificada |
| DLQ de entrada/salida | sufijo `-dlq` | pendientes de provisión | planificadas |
| `BETTER_AUTH_URL` | `http://localhost:5190` | `https://agent-cloudflare-staging.luisvr391.workers.dev` | Origen HTTPS autorizado |
| Secretos | `.dev.vars`, nunca Git | Secretos del Worker de staging | Secretos distintos del Worker de producción |

`DB`, `MEDIA_BUCKET`, `INBOUND_MESSAGES`, `OUTBOUND_MESSAGES`, `AI` y
`CustomerSupportAgent` conservan los mismos
nombres de binding para no cambiar el contrato del Worker. Los recursos detrás
de esos bindings son distintos por entorno. Assets, migraciones del Durable
Object y observabilidad se heredan de la configuración común.

Los secretos declarados para staging son `BETTER_AUTH_SECRET`,
`AUTH_SETUP_TOKEN`, `ZERNIO_WEBHOOK_SECRET` y `ZERNIO_API_KEY`. Los dos
valores de Zernio se cargan únicamente cuando se prepara el canal del entorno;
la API key debe estar limitada al perfil y recursos necesarios. Las
cuentas de WhatsApp se conectarán manualmente en Zernio y no se consideran
recursos provisionados por este runbook. Nunca se copian secretos ni datos
entre entornos.

## Validación local

Ejecuta antes de cualquier operación remota:

```bash
npm run check
npm run check:staging
git diff --check
```

`check:staging` construye la aplicación con `CLOUDFLARE_ENV=staging` y ejecuta
un dry-run sobre el archivo aplanado que genera el plugin de Cloudflare para
Vite. Seleccionar `--env staging` después del build no cambia ese artefacto.
El comando valida de forma determinista los nombres, secretos declarados y
origen del artefacto antes del dry-run. No autentica contra Cloudflare ni crea
recursos; su salida debe mostrar únicamente bindings de staging.

## Bootstrap humano de staging

Los pasos 1 a 8 se completaron el 2026-08-10 con D1
`b3eaa1ce-1dbb-46dd-90b9-0aea49ee87f3`, R2
`agent-cloudflare-staging-media`, Queue `agent-cloudflare-staging-inbound` y
Worker `agent-cloudflare-staging`. La versión verificada es
`a59cd299-5dc2-4546-a033-3c92b5796e59`; `/api/health`, `/api/setup/status` y
la SPA respondieron correctamente. La instalación mediante `/setup` fue completada y el panel
autenticado quedó verificado.

Esta sección conserva el procedimiento reproducible y no autoriza producción.
Usa una cuenta de Cloudflare correcta y no incluyas secretos en argumentos,
archivos versionados, logs o capturas.

1. Confirma la cuenta y el subdominio `workers.dev`:

   ```bash
   npx wrangler whoami
   ```

2. Crea únicamente los recursos de staging:

   ```bash
   npx wrangler d1 create agent-cloudflare-staging-db
   npx wrangler r2 bucket create agent-cloudflare-staging-media
   npx wrangler queues create agent-cloudflare-staging-inbound
   ```

3. Sustituye `staging-not-provisioned` por el UUID devuelto por D1 y reemplaza
   `https://staging.invalid` por el origen exacto:

   ```text
   https://agent-cloudflare-staging.<workers-subdomain>.workers.dev
   ```

   El UUID de D1 y el origen público no son secretos y deben quedar versionados
   en la configuración. No cambies los marcadores de producción.

4. Registra valores aleatorios y exclusivos para staging mediante los prompts
   interactivos:

   ```bash
   npx wrangler secret put BETTER_AUTH_SECRET --env staging
   npx wrangler secret put AUTH_SETUP_TOKEN --env staging
   npx wrangler secret put ZERNIO_WEBHOOK_SECRET --env staging
   npx wrangler secret put ZERNIO_API_KEY --env staging
   npx wrangler secret list --env staging
   ```

5. Repite el dry-run y revisa bindings, nombre del Worker y origen:

   ```bash
   npm run check:staging
   ```

6. Revisa y aplica las migraciones exclusivamente en la D1 de staging. Wrangler
   crea un respaldo antes de aplicar y revierte la migración actual si falla:

   ```bash
   npx wrangler d1 migrations list agent-cloudflare-staging-db --remote --env staging
   npx wrangler d1 migrations apply agent-cloudflare-staging-db --remote --env staging
   ```

7. Despliega desde una terminal humana después de revisar el diff y las
   validaciones:

   ```bash
   npm run deploy:staging
   ```

8. Registra el identificador de versión y verifica sin incluir tokens ni datos
   personales:

   ```bash
   curl --fail --silent --show-error https://agent-cloudflare-staging.<workers-subdomain>.workers.dev/api/health
   curl --fail --silent --show-error https://agent-cloudflare-staging.<workers-subdomain>.workers.dev/api/setup/status
   ```

   Comprueba además que `/` entrega la SPA. La instalación mediante `/setup`
   crea datos empresariales y requiere una autorización operativa separada.

## Gate de producción

No existe promoción automática ni reutilización de recursos de staging. Antes
de habilitar producción deben cumplirse todos estos puntos:

- PR revisado, CI exitoso y validación funcional en staging;
- aprobación humana explícita para provisionar y desplegar producción;
- D1, R2, Durable Object, secretos y origen propios de producción;
- dominio o ruta HTTPS aprobada y registrada como `BETTER_AUTH_URL` exacto;
- migraciones revisadas, compatibles con la versión anterior y respaldadas;
- plan de rollback y responsable operativo identificados.

Solo entonces se sustituyen los marcadores de producción, se declara su ruta y
se incorpora un script explícito. No se copian datos, sesiones, tokens ni
credenciales desde staging.

## Fallos y rollback

Ante un despliegue defectuoso, detén nuevas publicaciones, conserva
`correlationId` y revisa despliegues y logs redactados:

```bash
npx wrangler deployments list --env staging
npx wrangler tail agent-cloudflare-staging
```

Si el cambio solo afecta código y la versión anterior es compatible con los
bindings y el esquema vigente, vuelve a esa versión desde una terminal humana:

```bash
npx wrangler rollback <version-id> --env staging
```

Después repite los smoke tests. El rollback del Worker no revierte migraciones
D1, objetos R2, secretos ni cambios de recursos. Las migraciones son aditivas:
si la versión anterior no es compatible, usa una corrección hacia adelante.
Restaurar D1 mediante Time Travel, rotar secretos o retirar rutas son acciones
de incidente separadas, auditables y con autorización explícita.
