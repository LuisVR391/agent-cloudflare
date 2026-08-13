# Inbox y handoff humano

El inbox vive dentro del panel autenticado y muestra únicamente conversaciones
de la organización activa.

## API

- `GET /api/conversations`: lista paginada y filtrada por estado.
- `GET /api/conversations/:id/messages`: resumen e historial cronológico. Cada
  mensaje declara dirección, tipo de remitente, `senderId` cuando lo envió un
  colaborador, y tipo de contenido. Cada adjunto declara tipo, tipo de contenido,
  tamaño, nombre de archivo y estado de conservación.
- `POST /api/conversations/:id/messages`: respuesta humana idempotente.
- `PATCH /api/conversations/:id`: modo o estado con control optimista.
- `GET /api/conversations/:id/live`: WebSocket derivado y autorizado en
  backend.

`conversations.read` permite consulta; `conversations.manage` permite
responder, pausar, tomar control, resolver y reabrir. El backend solo acepta una
respuesta cuando la conversación está abierta y en modo `human`; una
conversación resuelta debe reabrirse y un modo pausado debe volver a control
humano.

Leer una conversación en el inbox no produce efectos hacia el canal: el producto
no emite acuses de lectura. La razón y la condición bajo la que volvería a tener
sentido están en
[el módulo de Zernio](./zernio-whatsapp-channel.md).

## Interfaz

El inbox vive en `/app/conversaciones`, dentro del shell del panel. El shell
acota la altura de la ventana y no scrollea: el sidebar y la cabecera permanecen
visibles, y la lista de conversaciones y el hilo se desplazan por separado
aunque la conversación sea larga. En pantallas estrechas solo cabe un panel, así
que la lista cede el espacio al hilo y un control devuelve al inbox. La
composición está fijada en
[ADR-0009](../decisions/ADR-0009-client-ui-composition.md).

La navegación habilita Conversaciones con listas de abiertas y resueltas,
detalle del hilo, compositor y controles operativos. Los mensajes presentan
`Recibido`, `En cola`, `Enviado`, `Entregado`, `Leído`, `No enviado` o
`Confirmación pendiente` según el registro canónico; `No enviado` y
`Confirmación pendiente` se distinguen como estados que piden atención. El hilo
sigue el borde cuando llega un mensaje nuevo y ofrece volver al último mensaje
si se está leyendo más arriba. Los cambios de día se anuncian entre mensajes.

Un mensaje entrante se alinea a la izquierda y un saliente a la derecha. Los
mensajes consecutivos del mismo autor forman un bloque con un solo avatar y un
solo nombre; el pie con el estado de entrega va en el último mensaje del bloque,
y un mensaje intermedio que pide atención conserva su propia etiqueta para que un
fallo no quede tapado por el estado del bloque.

El avatar es de iniciales: no existe imagen de contacto ni de usuario en la
fuente de verdad. Un mensaje entrante se atribuye al contacto por su nombre
declarado o, si no lo tiene, por su identificador en el canal. Un saliente se
atribuye a la persona de la sesión cuando `senderId` coincide con ella, y se
anuncia como `Equipo` cuando lo envió otro colaborador: sin el directorio de
miembros de Fase 2 no hay forma de resolver `senderId` a un nombre, y atribuirlo
a la cuenta activa sería falso.

Un adjunto se identifica por el nombre que declaró el canal cuando existe, y por
su tipo cuando no. Una imagen muestra miniatura y un audio puede reproducirse en
el hilo. Un adjunto que no pudo conservarse se anuncia sin enlace, porque su
descarga responde 409.

El WebSocket solicita una recarga de D1 cuando cambia un mensaje entrante o
saliente. Un polling de respaldo actualiza lista e hilo cada diez segundos ante
una desconexión. Si falla el encolado, el compositor restaura el texto y
conserva el mismo `clientRequestId` para un reintento seguro.

Contacto enriquecido, equipos, asignación, notas, pipeline, citas y métricas
pertenecen a Fase 2. Las respuestas automáticas y la IA pertenecen a Fase 3.
