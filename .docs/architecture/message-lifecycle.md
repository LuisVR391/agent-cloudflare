# Ciclo de vida de mensajes

Este documento describe el corte implementado de Fase 1 y la salida del agente
que añadió el corte de ejecución de Fase 3. La
[propiedad de datos](./data-ownership.md) y
[ADR-0008](../decisions/ADR-0008-zernio-whatsapp-adapter.md) gobiernan sus
límites.

## Entrada

1. `POST /webhooks/zernio` verifica HMAC, schema, plataforma y cuenta.
2. D1 deduplica el evento antes de responder `202`.
3. `INBOUND_MESSAGES` transporta el contrato normalizado.
4. El consumidor resuelve idempotentemente contacto, conversación y mensaje.
5. `CustomerSupportAgent`, identificado por
   `organizationId:conversationId`, recibe la referencia y coordina orden,
   buffer y actualización en vivo.
6. Los adjuntos se descargan del canal con credencial, se validan hasta 16 MiB
   y se copian a R2; D1 conserva metadatos, estado y la clave opaca, nunca la
   URL externa. Ocurre después del paso anterior a propósito: un medio
   irrecuperable no puede impedir que el mensaje aparezca en el inbox, y queda
   registrado con su motivo en vez de desaparecer.

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

## Salida del agente

1. Al vencer el buffer, el runtime durable ejecuta la versión publicada del
   agente si la conversación está abierta, en modo `automatic` y con un agente
   asignado. La decisión se lee de D1, no de la proyección del runtime.
2. La corrida abre su traza en `agent_runs` antes de invocar al modelo. El índice
   único por mensaje disparador impide que el mismo mensaje produzca dos
   respuestas.
3. El modelo se consume detrás de la capa común de
   [proveedores](../modules/model-providers.md) y su salida se valida contra un
   schema antes de convertirse en mensaje.
4. La respuesta se crea con remitente `system`, con el identificador del agente,
   y entra en `OUTBOUND_MESSAGES` con una clave de idempotencia derivada del
   identificador de la corrida. **Es la misma salida de Fase 1**: los pasos 4 a 6
   de la salida humana se aplican sin cambios.
5. Una corrida que no responde cierra su traza con un código estable y devuelve
   la conversación a `human`, con historial y auditoría.

La traza conserva agente, versión, disparador, respuesta, resultado, código de
fallo, correlación e instantes. No conserva el prompt, el texto del mensaje ni el
cuerpo del proveedor.

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

`correlationId` viaja desde el webhook hasta la respuesta del proveedor de canal
pasando por la corrida: la traza hereda el del mensaje entrante que la disparó, y
el trabajo de salida lo conserva.
