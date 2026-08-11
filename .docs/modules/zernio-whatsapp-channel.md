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
  el evento procesado; una desconexión cambia el estado del canal.
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

`message.sent` reconcilia una entrega creada por Agent Cloudflare mediante el
ID externo devuelto por Zernio. Un evento de un mensaje desconocido se conserva
sin reconciliar; nunca se vincula por texto, teléfono ni similitud.

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
- [Issue #25](https://github.com/LuisVR391/agent-cloudflare/issues/25) corrige
  el estado saliente observado y agrega `message.sent`.
- Falta aplicar la migración nueva, desplegar el PR autorizado, activar
  `message.sent` en Zernio y verificar envío, entrega y lectura reales.
- La conservación y validación integral de medios permanece en
  [Issue #20](https://github.com/LuisVR391/agent-cloudflare/issues/20).
