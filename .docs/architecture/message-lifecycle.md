# Ciclo de vida de mensajes

Este documento describe el corte implementado de Fase 1. La
[propiedad de datos](./data-ownership.md) y
[ADR-0008](../decisions/ADR-0008-zernio-whatsapp-adapter.md) gobiernan sus
límites.

## Entrada

1. `POST /webhooks/zernio` verifica HMAC, schema, plataforma y cuenta.
2. D1 deduplica el evento antes de responder `202`.
3. `INBOUND_MESSAGES` transporta el contrato normalizado.
4. El consumidor resuelve idempotentemente contacto, conversación y mensaje.
5. Los adjuntos HTTPS permitidos se validan hasta 16 MiB, se copian a R2 y D1
   conserva solo metadatos y la clave opaca.
6. `CustomerSupportAgent`, identificado por
   `organizationId:conversationId`, recibe la referencia y coordina orden,
   buffer y actualización en vivo.

Un reintento encuentra las restricciones únicas de evento, identidad,
conversación y mensaje antes de producir un segundo efecto.

## Salida humana

1. `POST /api/conversations/:id/messages` valida sesión, organización,
   `conversations.manage`, conversación abierta, modo `human`, texto y
   `clientRequestId`.
2. D1 crea un mensaje `queued` y una entrega con clave estable. Un reintento
   del frontend conserva el mismo `clientRequestId`.
3. `OUTBOUND_MESSAGES` transporta solo identificadores y correlación.
4. El consumidor carga cuenta y conversación canónicas, llama a Zernio con la
   misma `Idempotency-Key` en cada intento y persiste el resultado.
5. La respuesta del proveedor o los webhooks `message.sent`,
   `message.delivered`, `message.read` y `message.failed` reconcilian D1.
6. El Durable Object difunde el cambio y el inbox vuelve a consultar D1.

Los rechazos definitivos quedan `failed`. Una respuesta HTTP ambigua, un
fallo de transporte o una respuesta exitosa inválida queda
`delivery_unknown` y se reintenta con la misma clave. Los fallos agotados
llegan a DLQ; nunca se genera automáticamente una clave nueva.

## Estados visibles

| Estado D1 | Significado |
| --- | --- |
| `queued` | D1 aceptó la respuesta y la Queue debe transportarla |
| `sent` | Zernio confirmó que aceptó el envío |
| `delivered` | WhatsApp informó entrega al destinatario |
| `read` | WhatsApp informó lectura |
| `failed` | Existe un rechazo definitivo |
| `delivery_unknown` | El efecto puede haber ocurrido y debe reconciliarse |

## Observabilidad

Los eventos técnicos incluyen resultado, categoría segura, `correlationId`,
número de intento e identificadores opacos. No registran mensajes, teléfonos,
URLs temporales, cuerpos del proveedor, tokens o secretos.
