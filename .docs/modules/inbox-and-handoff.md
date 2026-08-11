# Inbox y handoff humano

El inbox vive dentro del panel autenticado y muestra únicamente conversaciones
de la organización activa.

## API

- `GET /api/conversations`: lista paginada y filtrada por estado.
- `GET /api/conversations/:id/messages`: resumen e historial cronológico.
- `POST /api/conversations/:id/messages`: respuesta humana idempotente.
- `PATCH /api/conversations/:id`: modo o estado con control optimista.
- `GET /api/conversations/:id/live`: WebSocket derivado y autorizado en
  backend.

`conversations.read` permite consulta; `conversations.manage` permite
responder, pausar, tomar control, resolver y reabrir. El backend solo acepta una
respuesta cuando la conversación está abierta y en modo `human`; una
conversación resuelta debe reabrirse y un modo pausado debe volver a control
humano.

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
