# Inbox y handoff humano

El inbox vive dentro del panel autenticado y muestra únicamente conversaciones
de la organización activa.

## API

- `GET /api/conversations`: lista paginada y filtrada por estado y responsable.
  `assignee` acepta `me` —que el backend resuelve con la membresía de la
  sesión—, `unassigned` o el identificador de una membresía; cualquier otro
  valor se rechaza antes de tocar SQL.

Ambas lecturas paginan por clave, no por desplazamiento. `limit` acepta de 1 a
100 y se recorta en silencio por encima del máximo; el tamaño por defecto es 30
conversaciones y 50 mensajes, y lo decide el servidor. `cursor` es **opaco**:
transporta la tupla que ordena la consulta —timestamp e identificador— y solo se
reenvía tal como se recibió. Un cursor mal formado responde `INVALID_CURSOR` y no
llega a la consulta; uno de otra organización no amplía el alcance, porque la
consulta sigue acotada por la organización activa. `nextCursor` es `null` cuando
no queda página siguiente, así que agotar el historial no exige una petición
vacía.

El cursor reproduce la tupla completa porque el orden lo es. Compararlo solo por
el timestamp dejaba inalcanzables las filas empatadas que el límite cortaba, y el
canal emite timestamps con precisión de segundos.

- `GET /api/conversations/:id/messages`: resumen e historial cronológico. Cada
  mensaje declara dirección, tipo de remitente, `senderId` cuando lo envió un
  colaborador, y tipo de contenido. Cada adjunto declara tipo, tipo de contenido,
  tamaño, nombre de archivo y estado de conservación.
- `POST /api/conversations/:id/messages`: respuesta humana idempotente.
- `PATCH /api/conversations/:id`: modo, estado, responsable o agente con control
  optimista. El responsable se describe en el
  [módulo de equipo](./teams-and-permissions.md); el agente, más abajo.
- `GET /api/conversations/:id/live`: WebSocket derivado y autorizado en
  backend.

`conversations.read` permite consulta; `conversations.manage` permite
responder, pausar, tomar control, resolver, reabrir y decidir si responde un
agente. El backend solo acepta una respuesta cuando la conversación está abierta
y en modo `human`; una conversación resuelta debe reabrirse, y un modo pausado o
automático debe volver a control humano.

## Que responda un agente

`attentionMode: "automatic"` exige un agente activo con versión publicada, y la
comprobación viaja en la misma sentencia que escribe: un agente archivado, sin
versión publicada, inexistente o de otra organización responde `409
AGENT_NOT_RUNNABLE` sin distinguir cuál de los cuatro es, porque distinguirlos
revelaría qué identificador ajeno existe.

`agentId` conserva su valor al volver a control humano: la conversación recuerda
a quién eligieron, y reactivarlo no obliga a elegirlo otra vez. Ninguna
conversación existente cambia sola; todas siguen en `human` y sin agente.

`supervised` sigue rechazado. Está en el contrato aceptado desde Fase 1, pero
nada prepara todavía un borrador que aprobar.

Lo que ocurre después —cuándo corre el agente, qué contexto recibe y qué pasa si
falla— lo describe el [runtime de conversación](./conversation-runtime.md).

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
atribuye a la persona de la sesión cuando `senderId` coincide con ella, y al
nombre del colaborador que lo envió cuando el directorio del equipo lo resuelve.
Sigue anunciándose como `Equipo` si la sesión no puede leer el equipo o quien
envió ya no aparece en él, porque atribuirlo a la cuenta activa sería falso.

La lista filtra por responsable junto al estado, y la cabecera del hilo permite
asignarlo. Ambos controles solo aparecen con lectura de equipo, y asignar exige
además gestionar conversaciones.

La misma cabecera decide quién atiende: el equipo, o uno de los agentes activos
con versión publicada. El control solo aparece con lectura de agentes y permiso
de gestión, y la lista se filtra por versión publicada porque es la condición que
el backend exige. Con la conversación respondiendo sola, el compositor explica
que hay que devolverla al equipo antes de escribir.

Una respuesta del agente se dibuja como cualquier otro saliente, firmada con el
nombre del agente mientras siga atendiendo la conversación; si se cambió de
agente se anuncia como `Agente`, porque nombrar al actual atribuiría una
respuesta que no escribió.

Un adjunto se identifica por el nombre que declaró el canal cuando existe, y por
su tipo cuando no. Una imagen muestra miniatura y un audio puede reproducirse en
el hilo. Un adjunto que no pudo conservarse se anuncia sin enlace, porque su
descarga responde 409.

El historial se recorre hacia atrás: al acercarse al inicio del hilo se pide la
página anterior y se conserva la posición de lectura. La lista hace lo propio
hacia abajo al acercarse a su final. Ninguna de las dos simula el recorrido en el
cliente: el tamaño de página lo impone el servidor y el cliente solo reenvía el
cursor que recibió.

El WebSocket solicita una recarga de D1 cuando cambia un mensaje entrante o
saliente. Un polling de respaldo actualiza lista e hilo cada diez segundos ante
una desconexión. Ambas recargas piden la primera página y la **fusionan** con lo
ya cargado, en vez de reemplazarlo: sustituir el hilo descartaría el historial que
se acaba de recorrer. Al resolver o reabrir sí se reinicia la lista, porque la
conversación sale del filtro activo y una fusión la conservaría. Si falla el
encolado, el compositor restaura el texto y conserva el mismo `clientRequestId`
para un reintento seguro.

Notas, pipeline, citas y métricas pertenecen a los cortes siguientes de Fase 2.
La aprobación humana previa al envío —el modo supervisado— pertenece al corte
[#60](https://github.com/LuisVR391/agent-cloudflare/issues/60).
