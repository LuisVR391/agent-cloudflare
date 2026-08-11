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

## Salida

1. `POST /api/conversations/:id/messages` valida sesión, organización,
   `conversations.manage`, texto y `clientRequestId`.
2. D1 crea un mensaje `queued` y una entrega con clave estable.
3. `OUTBOUND_MESSAGES` transporta solo identificadores y correlación.
4. El consumidor carga cuenta y conversación canónicas, llama a Zernio con
   `Idempotency-Key` y persiste el resultado.
5. Webhooks posteriores reconcilian `delivered`, `read` o `failed`.

Los fallos agotados llegan a DLQ. Una entrega incierta nunca se reenvía con una
clave nueva de forma automática.

## Observabilidad

Los eventos técnicos incluyen resultado, `correlationId` e identificadores
opacos. No registran mensajes, teléfonos, URLs temporales, tokens o secretos.
