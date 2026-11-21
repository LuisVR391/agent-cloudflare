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
| Queue `OUTBOUND_MESSAGES` | `agent-cloudflare-outbound` | `agent-cloudflare-staging-outbound` provisionada | `agent-cloudflare-production-outbound` planificada |
| DLQ de entrada/salida | sufijo `-dlq` | provisionadas, sin consumidor | planificadas |
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

```bash
npm run check
git diff --check
```

`npm run check` ejecuta tipos, pruebas del Worker y del cliente, build y un
dry-run de staging. Para revisar solamente ese artefacto usa `npm run
check:staging`. El plugin de Cloudflare para Vite construye con
`CLOUDFLARE_ENV=staging` y el dry-run carga explícitamente
`dist/agent_cloudflare/wrangler.json`. La comprobación exige el origen público de
staging, el UUID de su D1, su R2, ambas colas y sus DLQ, el Durable Object,
Workers AI y el bundle sin rutas de simulación. El dry-run funciona sin
autenticarse contra Cloudflare.

## Despliegue en staging

Haz una revisión técnica del diff del SHA a publicar, su compatibilidad con el
entorno y sus pruebas. La revisión de despliegue se hace también si el PR ya
pasó revisión de código. Se puede validar en staging antes de la fusión con
autorización para ese SHA y ese entorno. CI verifica el PR y el build, sin
publicar.

1. Con Wrangler autenticado en la cuenta de staging, lee el estado del
   Worker. Registra el UUID de la versión que sirve el 100 % y el SHA completo
   revisado. Usa ese UUID como punto de retorno.

   ```bash
   npm run check:staging
   npx wrangler deployments status --name agent-cloudflare-staging --config dist/agent_cloudflare/wrangler.json --json
   git rev-parse HEAD
   git status --short
   ```

2. Si el cambio incluye esquema, revisa las migraciones y aplícalas como una
   operación separada sobre la D1 de staging. Wrangler puede inicializar su
   tabla de control al listar migraciones remotas. El preflight consulta el
   inventario de D1 y deja la operación de esquema fuera del despliegue.

3. Con el árbol limpio y autorización explícita para el SHA y la versión de
   partida, sustituye `SHA_COMPLETO_APROBADO` y `UUID_ACTIVO_REVISADO` por
   los valores revisados y ejecuta:

   ```bash
   AGENT_DEPLOY_CONFIRMED=1 npm run deploy:staging -- --sha SHA_COMPLETO_APROBADO --from-version UUID_ACTIVO_REVISADO
   ```

   El comando ejecuta de nuevo `npm run check`, reutiliza el artefacto del
   dry-run y coteja D1, R2, las colas y sus DLQ en la cuenta autenticada.
   Las consultas y la publicación usan la misma configuración generada y
   la misma sesión de Wrangler desde la raíz del proyecto. Vuelve a
   comprobar el SHA, el árbol y la versión activa antes de publicar. Si
   cambió la versión activa, revisa el destino y solicita su aprobación de
   nuevo. Coordina una sola publicación de staging durante el cambio.

4. Registra la versión desplegada y comprueba el estado básico y la SPA:

   ```bash
   curl --fail --silent --show-error https://agent-cloudflare-staging.luisvr391.workers.dev/api/health
   curl --fail --silent --show-error https://agent-cloudflare-staging.luisvr391.workers.dev/api/setup/status
   curl --fail --silent --show-error --output /dev/null https://agent-cloudflare-staging.luisvr391.workers.dev/
   ```

   Añade las pruebas funcionales que correspondan a lo publicado y registra
   su evidencia sin tokens ni datos personales.

## Bootstrap humano de staging

Usa este procedimiento solo para el aprovisionamiento inicial o la recuperación
autorizada de recursos del entorno. El despliegue habitual de arriba presupone
un Worker con una versión activa revisable.

1. Verifica la cuenta y el subdominio con `npx wrangler whoami`. Provisiona la
   D1, el bucket R2, las colas y sus DLQ de staging según el inventario.
2. Versiona el UUID público de D1 y el origen HTTPS en `wrangler.jsonc` y
   ajusta las comprobaciones del artefacto si cambian esos recursos.
3. Crea el Worker de arranque `agent-cloudflare-staging` en el panel de
   Cloudflare y carga ahí los secretos. Valida el artefacto y aplica el
   esquema inicial de D1 con autorización separada.
4. Realiza la primera publicación como operación humana con el artefacto ya
   validado. Comprueba `/api/health`, `/api/setup/status` y la SPA. La
   instalación mediante `/setup` crea datos empresariales y requiere
   autorización operativa.

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

### Corridas automáticas interrumpidas

1. Busca el `correlationId` del mensaje entrante en los logs redactados del
   Worker de staging. En la vista de lectura de D1 identifica la organización,
   `agent_runs.id`, `trigger_message_id`, el estado y, si existe,
   `response_message_id`. Consulta solo identificadores y estados.
2. Busca el saliente de esa organización por `response_message_id` o por el
   `client_request_id` derivado del `runId`. Revisa su estado, la fila
   `outbound_message_deliveries` y la clave existente. Una corrida `running`
   puede tener un saliente guardado aunque todavía no tenga vínculo final.
3. Sin saliente, el equipo puede tomar control y decidir la respuesta desde el
   inbox. Con saliente, compara estado, logs y DLQ. Si la entrega es incierta o el trabajo sigue en vuelo,
   concilia con el canal antes de decidir cualquier reintento manual. Conserva
   la misma identidad y evita publicar otro mensaje para despejar la duda.
4. Registra el último estado comprobado y la decisión operativa. Repetir el
   disparador original no vuelve a ejecutar el modelo ni reencola el saliente.

El rollback restaura el código del Worker. Los estados de D1 y los trabajos
aceptados por Queue conservan sus efectos.
