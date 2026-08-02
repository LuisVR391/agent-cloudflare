# Entornos y staging

Este runbook define la separación entre desarrollo local, staging y
producción. Implementa la estrategia de entornos de la
[guía rectora](../guia-arquitectura-producto.md), respeta los bindings de
[ADR-0001](../decisions/ADR-0001-cloudflare-native.md) y conserva a D1 como
fuente de verdad conforme a
[ADR-0002](../decisions/ADR-0002-d1-source-of-truth.md).

## Estado actual

El repositorio está preparado para validar y desplegar a staging, pero no se
ha creado ni modificado ningún recurso remoto. Los IDs y orígenes `.invalid` de
`wrangler.jsonc` son marcadores deliberados: deben impedir que una operación
incompleta produzca una aplicación autenticable o conectada a una base real.

| Entorno | Responsabilidad | Estado remoto |
| --- | --- | --- |
| Local | Desarrollo y pruebas con estado de Miniflare bajo `.wrangler/` | No usa recursos remotos |
| Staging | Validación integrada con datos sintéticos antes de producción | No provisionado |
| Producción | Datos y tráfico reales después de aprobación explícita | No provisionado y sin ruta pública |

Staging usará `workers.dev` para evitar introducir DNS o dominios propios en
esta fase. Producción tiene `workers_dev: false`, no declara rutas y no dispone
de un script de despliegue.

## Inventario y aislamiento

| Recurso o valor | Local | Staging | Producción |
| --- | --- | --- | --- |
| Worker | `agent-cloudflare` | `agent-cloudflare-staging` | `agent-cloudflare-production` |
| D1 `DB` | `agent-cloudflare-db` local | `agent-cloudflare-staging-db` | `agent-cloudflare-production-db` |
| R2 `MEDIA_BUCKET` | `agent-cloudflare-media` local | `agent-cloudflare-staging-media` | `agent-cloudflare-production-media` |
| Durable Object | Namespace local | Namespace del Worker de staging | Namespace del Worker de producción |
| `BETTER_AUTH_URL` | `http://localhost:5190` | Origen exacto de staging en `workers.dev` | Origen HTTPS autorizado |
| Secretos | `.dev.vars`, nunca Git | Secretos del Worker de staging | Secretos distintos del Worker de producción |

`DB`, `MEDIA_BUCKET`, `AI` y `CustomerSupportAgent` conservan los mismos
nombres de binding para no cambiar el contrato del Worker. Los recursos detrás
de esos bindings son distintos por entorno. Assets, migraciones del Durable
Object y observabilidad se heredan de la configuración común.

Los únicos secretos exigidos por la capacidad actualmente activa son
`BETTER_AUTH_SECRET` y `AUTH_SETUP_TOKEN`. Los secretos de WhatsApp se
registrarán en su entorno cuando exista el canal funcional; no se cargan por
adelantado. Nunca se copian secretos ni datos entre entornos.

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

Esta sección es un procedimiento operativo pendiente, no una autorización
para que un agente lo ejecute. Usa una cuenta de Cloudflare correcta y no
incluyas secretos en argumentos, archivos versionados, logs o capturas.

1. Confirma la cuenta y el subdominio `workers.dev`:

   ```bash
   npx wrangler whoami
   ```

2. Crea únicamente los recursos de staging:

   ```bash
   npx wrangler d1 create agent-cloudflare-staging-db
   npx wrangler r2 bucket create agent-cloudflare-staging-media
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
