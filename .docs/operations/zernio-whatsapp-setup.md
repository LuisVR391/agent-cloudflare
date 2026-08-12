# Configuración operativa de WhatsApp mediante Zernio

Este runbook prepara staging. No autoriza recursos de producción ni contiene
valores de secretos. Staging está desplegado en
`https://agent-cloudflare-staging.luisvr391.workers.dev`; la prueba HMAC
directa respondió `204` y el rechazo sin firma respondió `401`. `/setup`
está completo, la cuenta `Lia` está vinculada a `Beautyplace` y el webhook
de Zernio está activo.

La entrada real, la persistencia canónica, el inbox y su actualización en vivo
están verificados. Las Queues de entrada y salida y sus DLQ están provisionadas.

La prueba humana del 2026-08-12 confirmó que WhatsApp entregó la respuesta y que
Zernio emitió `message.sent`, `message.delivered` y `message.read`, los tres
aceptados con `202`; aun así la UI conservó `Confirmación pendiente`. La causa
era el contrato de respuesta de envío, que exigía `conversationId` y `sentAt`
—campos que Zernio solo puebla para Twitter y Bluesky—, por lo que cada envío
correcto se descartaba como `ZERNIO_RESPONSE_INVALID` y perdía el `messageId`
con el que se reconcilian los estados. La corrección está en `main` y falta
desplegarla y repetir la validación remota con un mensaje nuevo.

Los mensajes salientes anteriores a esa corrección permanecen en
`delivery_unknown` y no son recuperables automáticamente: no conservan el
identificador de Zernio y vincularlos por texto, teléfono o proximidad temporal
está prohibido.

## Prerrequisitos

- Cuenta de WhatsApp conectada y saludable en Zernio.
- Fila de organización creada mediante `/setup` en Agent Cloudflare.
- D1, R2, Queue y Worker de staging provisionados según
  [entornos y staging](./environments.md).
- API key dedicada de Zernio, con alcance `profiles`, limitada al perfil
  conectado y permiso `read-write`; la clave general `Default Key` no se usa
  en el Worker. La API pública documentada no permite restringirla además por
  grupo de recursos, por lo que el perfil dedicado es el límite mínimo
  verificable actualmente.

El MCP de Zernio no es necesario. Puede usarse como herramienta administrativa
de desarrollo mediante OAuth, pero no forma parte del runtime ni recibe los
secretos del Worker.

## 1. Obtener identificadores externos

Consulta la API de cuentas desde una terminal humana autenticada con la clave
dedicada. No incluyas la clave en el comando, historial o captura. Identifica:

- `accountId` de la cuenta cuya plataforma sea `whatsapp`;
- `profileId` del perfil al que pertenece;
- nombre visible que permita reconocer el número.

El teléfono mostrado en el panel no sustituye estos identificadores opacos.

## 2. Vincular la cuenta en D1

Registra una fila de `communication_channels` con:

- `organization_id`: organización ya instalada en staging;
- `provider`: `whatsapp`;
- `adapter`: `zernio`;
- `external_account_id`: `accountId` obtenido de Zernio;
- `external_profile_id`: `profileId` obtenido de Zernio;
- `status`: `active`.

La escritura se realiza como operación de bootstrap revisada mediante D1 y no
incluye secretos. Hasta que exista una pantalla administrativa de canales,
conserva el identificador de la operación y verifica la fila por organización
antes de continuar.

## 3. Cargar secretos

Para desarrollo local crea `.dev.vars`, que está ignorado por Git:

```dotenv
ZERNIO_WEBHOOK_SECRET=<valor-local-exclusivo>
ZERNIO_API_KEY=<clave-local-o-de-sandbox>
```

No uses `.env` en paralelo. Para staging usa prompts interactivos:

```bash
npx wrangler secret put ZERNIO_WEBHOOK_SECRET --env staging
npx wrangler secret put ZERNIO_API_KEY --env staging
npx wrangler secret list --env staging
```

El secreto HMAC y la API key son valores distintos, exclusivos de staging y no
se copian a producción.

## 4. Crear el webhook en Zernio

Después de desplegar el Worker, crea manualmente:

| Campo | Valor |
| --- | --- |
| Name | `Agent Cloudflare - Staging` |
| URL | `https://agent-cloudflare-staging.luisvr391.workers.dev/webhooks/zernio` |
| Secret Key | Mismo valor de `ZERNIO_WEBHOOK_SECRET` de staging |
| Custom Headers | Ninguno |

Selecciona solamente:

- `message.received`
- `message.sent`
- `message.delivered`
- `message.read`
- `message.failed`
- `account.disconnected`

Los eventos generales `message.*` son los eventos de inbox que Zernio aplica
también a WhatsApp. No actives `whatsapp.template.*`,
`whatsapp.automatic_event`, `whatsapp.number.*`, `verification.*` ni otros
eventos: este Worker no los implementa y los rechazará con
`422 INVALID_EVENT`, lo que provocaría reintentos innecesarios.

Activa `message.sent` únicamente después de desplegar el contrato que lo valida y reconcilia. Agent Cloudflare sigue siendo la única interfaz operativa de envío.

## 5. Validar

1. Envía `webhook.test` desde Zernio y confirma `204` en sus logs.
2. Comprueba que una firma alterada recibe `401` y no escribe D1.
3. Envía un mensaje al número conectado y confirma que aparece una sola vez en
   el inbox sin recargar la página.
4. Responde desde una conversación abierta en modo humano, dentro de la ventana
   de atención de WhatsApp.
5. Verifica que la UI transiciona de `En cola` a `Enviado` y después a
   `Entregado` o `Leído`; ante rechazo debe mostrar `No enviado`.
6. Confirma una sola entrega en WhatsApp y una sola fila de
   `outbound_message_deliveries` con la clave estable.
7. Reentrega el mismo webhook y confirma `200` sin segundo efecto.
8. Comprueba que `account.disconnected` marca el canal como desconectado.

En la validación del 2026-08-10, `message.received` fue procesado una sola vez
para el canal `Lia` y la organización `Beautyplace`; el hilo se actualizó en
vivo. El primer intento de respuesta humana llegó a la Queue saliente y agotó
seis ejecuciones con categoría genérica, sin llegar a WhatsApp. No se debe
reproducir automáticamente ese mensaje histórico.

En la validación del 2026-08-12, con la versión
`4180d56e-4660-4504-a60d-01f1d13cc598` y las migraciones `0001` a `0006`
activas, `message.sent`, `message.delivered` y `message.read` se aceptaron con
`202` y WhatsApp mostró la respuesta entregada y leída, pero la UI conservó
`Confirmación pendiente` por el contrato de respuesta descrito arriba.

Después de desplegar la corrección, ejecuta nuevamente los pasos anteriores con
un mensaje nuevo. Registra versión, IDs opacos y estados, sin copiar texto,
teléfono, tokens ni payloads.


## Recuperación

- Firma inválida: confirma que ambos entornos usan el mismo secreto y rota si
  existe sospecha de exposición.
- `UNKNOWN_CHANNEL`: revisa `accountId`, `profileId`, organización y estado.
- `QUEUE_UNAVAILABLE`: conserva el evento fallido; Zernio reintentará y la
  deduplicación evitará efectos repetidos.
- `ZERNIO_HTTP_<status>`: revisa permisos, ventana de atención y estado de la
  cuenta sin registrar el cuerpo del proveedor.
- `ZERNIO_RESPONSE_INVALID`, `ZERNIO_TRANSPORT_FAILED` o
  `ZERNIO_CONVERSATION_MISMATCH`: conserva `delivery_unknown`, la misma clave
  de idempotencia y reconcilia antes de cualquier reenvío manual.
- `ZERNIO_RESPONSE_INVALID` en todos los envíos, y no en casos aislados, indica
  un cambio en el contrato del proveedor y no un incidente puntual. El síntoma
  visible es que WhatsApp entrega el mensaje y Zernio registra sus estados con
  `202`, mientras la UI conserva `Confirmación pendiente`. Compara la respuesta
  contra la especificación vigente antes de reenviar nada: los reintentos
  consumen la clave de idempotencia sin corregir el estado.
- Mensaje en DLQ: inspecciona categoría, intento y estado D1; no generes una
  nueva clave ni reproduzcas automáticamente el contenido.
- Cuenta desconectada: reconecta en Zernio, verifica salud y reactiva el canal
  mediante una operación administrativa revisada.
