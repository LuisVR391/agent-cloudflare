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
  `message.delivered`, `message.read`, `message.failed` y
  `account.disconnected`, únicamente para `whatsapp`.
- D1 resuelve `external_account_id` hacia un canal activo y una organización.
- `inbound_webhook_events` deduplica por adaptador e ID estable del evento.
- `INBOUND_MESSAGES` transporta el contrato normalizado y el consumidor marca
  el evento procesado; una desconexión cambia el estado del canal.
- `ZernioClient.sendTextMessage` llama a la API de inbox con bearer token e
  `Idempotency-Key`, pero todavía no está conectado a una Queue de salida.

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

No se suscribe `message.sent`: la operación humana se realizará desde Agent
Cloudflare. Si esa política cambia, debe incorporarse el evento y reconciliar
los envíos externos antes de permitir el uso paralelo del inbox de Zernio.

## Datos y seguridad

`communication_channels` conserva identificadores opacos, nombre visible y
estado; no guarda tokens. `inbound_webhook_events` conserva recepción,
correlación y resultado técnico, no el payload completo. El contenido mínimo
necesario viaja en Queue hacia el procesamiento de conversación futuro.

La identidad preferida de un remitente de WhatsApp es
`businessScopedUserId`; se usa `phoneNumber` o `sender.id` únicamente como
fallback. Ninguno de estos valores aparece en logs operativos.

## Pendiente de Fase 1

- Persistir conversación, mensaje y estado canónicos.
- Entregar al Durable Object y conservar orden y buffer.
- Crear Queue y consumidor de salida que usen `ZernioClient`.
- Descargar medios autorizados y copiarlos a R2.
- Exponer inbox y handoff con permisos en backend.
