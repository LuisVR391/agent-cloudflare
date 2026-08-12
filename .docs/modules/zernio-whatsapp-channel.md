# Canal de WhatsApp mediante Zernio

Zernio es el adaptador bidireccional del primer canal. Las cuentas se conectan
manualmente en su panel y Agent Cloudflare conserva la autoridad empresarial
definida en [ADR-0008](../decisions/ADR-0008-zernio-whatsapp-adapter.md).

## Superficie implementada

- `POST /webhooks/zernio` recibe eventos públicos sin sesión de usuario.
- `X-Zernio-Signature` se verifica como HMAC-SHA256 hexadecimal sobre un cuerpo
  crudo limitado a 256 KiB.
- `X-Zernio-Event-Id`, cuando existe, debe coincidir con `payload.id`.
- Los schemas aceptados son `webhook.test`, `message.received`,
  `message.sent`, `message.delivered`, `message.read`, `message.failed`
  y `account.disconnected`, únicamente para `whatsapp`.
- D1 resuelve `external_account_id` hacia un canal activo y una organización.
- `inbound_webhook_events` deduplica por adaptador e ID estable del evento.
- `INBOUND_MESSAGES` transporta el contrato normalizado y el consumidor marca
  el evento procesado; una desconexión cambia el estado del canal. La Queue
  entrega al menos una vez y no garantiza el orden entre estados.
- `OUTBOUND_MESSAGES` entrega respuestas humanas a
  `ZernioClient.sendTextMessage` con una clave estable y resultado persistido.
- El inbox autenticado consulta D1 y nunca adopta el inbox de Zernio como
  autoridad.

## Respuestas del webhook

| Resultado | HTTP | Efecto |
| --- | --- | --- |
| Evento nuevo persistido y encolado | `202` | Zernio puede confirmar la entrega |
| Evento ya encolado o procesado | `200` | No se repite el trabajo |
| `webhook.test` firmado y válido | `204` | No requiere canal ni escribe D1 |
| Firma ausente o inválida | `401` | No se parsea ni persiste el cuerpo |
| JSON o ID de cabecera inválido | `400` | No se procesa |
| Schema, plataforma o canal inválido | `422` | Falla de forma cerrada |
| Queue no disponible | `503` | El evento queda fallido y Zernio reintenta |

Una respuesta `202` confirma recepción durable y publicación en Queue; no
demuestra que el estado empresarial ya se haya reconciliado en D1.

Los eventos `message.sent`, `message.delivered`, `message.read` y
`message.failed` se conservan con organización, canal, conversación y los dos
identificadores opacos del mensaje. El consumidor reproduce ese historial
cuando la respuesta de envío enlaza el ID de Zernio, por lo que el resultado no
depende del orden de Queue. Una respuesta válida con conversación discordante
solo conserva el ID como candidato: el mensaje permanece en
`delivery_unknown` hasta recibir un webhook del canal y conversación
esperados. Un evento desconocido permanece sin reconciliar y nunca se vincula
por texto, teléfono, tiempo ni similitud.

La respuesta de envío solo garantiza `data.messageId`. Zernio puebla
`data.conversationId` únicamente para Twitter y `data.sentAt` únicamente para
Bluesky, así que en WhatsApp ambos llegan nulos: se aceptan como ausentes y el
envío conserva la hora local de aceptación. Ese `messageId` es el único vínculo
con los eventos de estado posteriores; sin él el mensaje quedaría en
`delivery_unknown` de forma permanente, porque la identidad nunca se infiere
del contenido. La conversación devuelta solo se contrasta cuando el proveedor
la incluye; en WhatsApp la confirman el destino de la ruta de envío y el
webhook posterior.

## Medios entrantes

La `url` de un adjunto de WhatsApp apunta al endpoint autenticado
`GET /v1/whatsapp/media/{mediaId}` y exige la credencial del canal; no es un
enlace público, a diferencia de otras plataformas. Como esa URL llega dentro del
payload del webhook —entrada no confiable, porque la firma prueba el origen del
evento y no su contenido—, la credencial solo se adjunta cuando el destino
coincide exactamente con el origen de la API. Cualquier otro host se rechaza
antes de enviarla.

WhatsApp conserva el medio una ventana limitada, así que se descarga al recibir
el evento y no de forma diferida. Un `400` significa que el medio ya no existe y
no se reintenta; `401`, `403` y `404` son permanentes por configuración; el
resto sí admite reintento.

Los tipos que emite el canal son `image`, `video`, `audio`, `file`, `sticker` y
`share`. Se copian los cuatro primeros; `sticker` y `share` se registran sin
copiar, y un tipo desconocido se normaliza como `unsupported` en vez de rechazar
el evento, porque un `422` provocaría reintentos indefinidos de un webhook que
nunca sería aceptado y perdería el mensaje que lo acompaña.

Un adjunto que no puede conservarse **no impide que su mensaje llegue al
inbox**: el mensaje se entrega al runtime antes de copiar los medios, y el
adjunto queda registrado con estado `rejected` y su motivo. La lectura de un
adjunto no conservado responde `409`, distinguible de un identificador
inexistente.

**El producto no emite acuses de lectura hacia el contacto.** El proveedor
expone `POST /v1/inbox/conversations/{id}/read`, que en WhatsApp enviaría las
palomitas azules, salvo en cuentas de coexistencia: ahí la app de WhatsApp
Business del cliente conserva el estado de lectura y el proveedor no lo
sobrescribe. La cuenta `Lia` que se opera se conectó desde esa app, así que es
de coexistencia.

Se implementó y se retiró tras comprobarlo en staging: el proveedor aceptaba la
llamada, pero el mensaje entrante conservaba `deliveryStatus: 'delivered'` y el
contacto nunca veía la palomita azul. No existe endpoint alternativo ni
override, `isRead` es un campo que el webhook entrega y no un parámetro que se
pueda devolver, y desconectar la app tampoco es salida porque el proveedor
desactiva la cuenta al hacerlo.

Reintroducirlo solo tiene sentido con un número exclusivo de Cloud API, sin
coexistencia; entonces requeriría de nuevo el endpoint, una marca de lectura por
conversación y su auditoría.

El proveedor decide cuál de los dos identificadores opacos devuelve en ese
campo: en WhatsApp es el `platformMessageId`, mientras el webhook identifica el
mensaje por el ID interno de Zernio y lleva el de plataforma aparte. La
reconciliación contrasta cada identificador conocido contra ambas columnas, de
modo que el vínculo no depende de esa elección, y usa el webhook —que sí los
distingue— para dejar cada uno en su columna. El cruce exige la misma
organización, canal y conversación, y compara solo identificadores opacos.

## Datos y seguridad

`communication_channels` conserva identificadores opacos, nombre visible y
estado; no guarda tokens. `inbound_webhook_events` conserva recepción,
correlación y resultado técnico, no el payload completo. Queue transporta
referencias mínimas y D1 conserva mensajes e intentos canónicos.

La identidad preferida de un remitente de WhatsApp es
`businessScopedUserId`; se usa `phoneNumber` o `sender.id` únicamente como
fallback. Ninguno de estos valores aparece en logs operativos.

## Estado de validación de Fase 1

- Entrada real, persistencia, inbox y actualización en vivo están verificados
  en staging.
- Queue de entrada, Queue de salida y sus DLQ están provisionadas en staging.
- [Issue #25](https://github.com/LuisVR391/agent-cloudflare/issues/25) corrigió
  la invocación de `fetch`; una respuesta humana real llegó una sola vez a
  WhatsApp y Zernio emitió `message.sent`, `message.delivered` y
  `message.read`.
- Esa prueba dejó la UI en `delivery_unknown` porque los estados aceptados no
  podían vincularse después. La reconciliación independiente del orden se
  desplegó como versión `4180d56e-4660-4504-a60d-01f1d13cc598`.
- La prueba humana del 2026-08-12 mostró que la causa raíz seguía activa: el
  contrato de respuesta exigía `conversationId` y `sentAt`, que WhatsApp nunca
  devuelve, así que cada envío correcto se clasificaba como
  `ZERNIO_RESPONSE_INVALID` y perdía el `messageId` necesario para reconciliar.
  Zernio entregó el mensaje y emitió los tres estados con `202`, pero la UI
  conservó `Confirmación pendiente`. El contrato corregido se desplegó como
  versión `cf9a1388-a60f-483d-80c3-f5ed83c51e05`.
- La prueba del 2026-08-12 con esa versión confirmó el envío: el mensaje quedó
  en `sent` con su identificador capturado. Los eventos `sent`, `delivered` y
  `read` llegaron, pero ninguno se reconcilió, porque el envío había guardado el
  `platformMessageId` y la búsqueda solo lo contrastaba contra el ID interno de
  Zernio. El cruce de identificadores corrige ese vínculo y habilita
  `Entregado` y `Leído`; está desplegado como versión
  `7bc15db8-03eb-4e68-b8cb-96ad0a328b6d` y requiere una prueba humana nueva.
- La conservación y validación integral de medios permanece en
  [Issue #20](https://github.com/LuisVR391/agent-cloudflare/issues/20).
