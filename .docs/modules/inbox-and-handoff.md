# Inbox y handoff humano

El inbox vive dentro del panel autenticado y muestra únicamente conversaciones
de la organización activa.

## API

- `GET /api/conversations`: lista paginada y filtrada por estado.
- `GET /api/conversations/:id/messages`: resumen e historial cronológico.
- `POST /api/conversations/:id/messages`: respuesta humana idempotente.
- `PATCH /api/conversations/:id`: modo o estado con control optimista.
- `POST /api/conversations/:id/read`: acuse de lectura hacia el canal.
- `GET /api/conversations/:id/live`: WebSocket derivado y autorizado en
  backend.

`conversations.read` permite consulta; `conversations.manage` permite
responder, pausar, tomar control, resolver, reabrir y acusar lectura. El backend
solo acepta una respuesta cuando la conversación está abierta y en modo `human`;
una conversación resuelta debe reabrirse y un modo pausado debe volver a control
humano.

## Acuse de lectura

Marcar leída una conversación avisa al contacto en su canal, así que es una
acción con efecto externo y no una consecuencia de consultar el historial:
`GET /api/conversations/:id/messages` permanece sin efectos y una consulta con
solo `conversations.read` nunca la dispara. La interfaz la invoca al abrir el
hilo, que es la vista humana real.

`conversations.last_read_at` registra la última lectura y evita repetir el acuse
mientras no lleguen entrantes nuevos. Solo se actualiza después de que el canal
acepta el acuse, de modo que un fallo del proveedor conserva la conversación
pendiente y la siguiente apertura vuelve a intentarlo sin intervención. Cada
acuse aceptado deja una entrada `conversation.read` en `audit_logs` con actor,
conversación y correlación, sin texto ni teléfono, y un log
`conversation.read.acknowledge` con el `markedCount` devuelto por el canal.

La recarga del WebSocket y el polling de respaldo reutilizan la misma apertura,
de modo que un mensaje que llega con el hilo ya abierto también queda acusado
sin que el operador tenga que volver a seleccionarlo.

En cuentas de coexistencia el canal acepta el acuse pero el contacto no ve la
palomita azul, porque el estado de lectura pertenece a la app de WhatsApp
Business del cliente. Es una limitación del canal descrita en
[el módulo de Zernio](./zernio-whatsapp-channel.md).

## Interfaz

La navegación habilita Conversaciones con listas de abiertas y resueltas,
detalle del hilo, compositor y controles operativos. Los mensajes presentan
`En cola`, `Enviado`, `Entregado`, `Leído`, `No enviado` o
`Confirmación pendiente` según el registro canónico.

El WebSocket solicita una recarga de D1 cuando cambia un mensaje entrante o
saliente. Un polling de respaldo actualiza lista e hilo cada diez segundos ante
una desconexión. Si falla el encolado, el compositor restaura el texto y
conserva el mismo `clientRequestId` para un reintento seguro.

Contacto enriquecido, equipos, asignación, notas, pipeline, citas y métricas
pertenecen a Fase 2. Las respuestas automáticas y la IA pertenecen a Fase 3.
