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
responder, pausar, tomar control, resolver y reabrir.

## Interfaz

La navegación habilita Conversaciones con listas de abiertas y resueltas,
detalle del hilo, estados de entrega, compositor y controles operativos. El
WebSocket solicita una recarga del registro canónico; un polling de respaldo
mantiene la vista utilizable ante desconexión.

Contacto enriquecido, equipos, asignación, notas, pipeline, citas y métricas
pertenecen a Fase 2. La IA automática pertenece a Fase 3.
