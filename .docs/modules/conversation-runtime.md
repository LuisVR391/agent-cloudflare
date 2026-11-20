# Runtime durable de conversación

`CustomerSupportAgent` conserva el nombre y binding existentes por
compatibilidad. Cada conversación usa una instancia independiente:

```text
organizationId:conversationId
```

La identidad se deriva en backend después de verificar D1; nunca se acepta una
organización enviada por el frontend.

## Responsabilidades

- Serializar referencias de mensajes entrantes.
- Mantener lista pendiente, cursor procesado, debounce y modo de atención.
- Agrupar actividad usando `communication_channels.buffer_seconds`, con valor
  inicial de ocho segundos.
- Solicitar al arnés la ejecución de la versión publicada cuando vence el buffer.
- Difundir eventos mínimos a conexiones del inbox.

D1 conserva contactos, conversación, mensajes, estados e historial. El estado
del Durable Object es una proyección reconstruible y no contiene secretos ni
el historial completo.

## Cuándo responde el agente

Al vencer el buffer, el **último mensaje agrupado** dispara la corrida. Quién
decide si hay corrida es **D1 y no la proyección del runtime**: un Durable Object
recreado empieza con su estado inicial, y confiar en él dejaría muda una
conversación que sí responde.

El CRM solicita ejecución para un entrante de una conversación abierta, en
modo `automatic` y con agente asignado. El arnés busca su versión publicada.
Si el agente dejó de estar disponible, queda evidencia en auditoría y el CRM
puede devolver la atención al equipo.

```text
mensaje entrante -> buffer -> arnés y traza en `agent_runs`
                                  |
                                  +-> candidata -> CRM -> salida existente
```

## Qué recibe el modelo

Los **últimos veinte mensajes de esa conversación**, en orden cronológico: los
entrantes como turno del contacto y los salientes como turno del agente. Un
mensaje sin texto entra como marcador de lo que el contacto envió —`[el contacto
envió una imagen]`— y nunca su binario ni la referencia temporal del canal.

Nada de otra conversación, de otro contacto o de otra organización entra al
contexto. El límite de veinte es una decisión de contexto, no una verdad: una
conversación muy larga pierde su principio.

## Qué puede consultar

Antes de la primera llamada al modelo, la corrida resuelve qué herramientas
puede anunciar: las que la versión publicada declaró, que existen en el catálogo
cerrado del producto, cuya audiencia es la conversación con el contacto y cuyos
datos se acotan a la organización y al contacto leídos en D1. **Lo que no
sobrevive a esos cuatro controles no llega al modelo**, y sin ninguna
superviviente la petición no lleva herramientas.

Hoy son dos, ambas de solo lectura: el catálogo de servicios activos y la próxima
cita del propio contacto. Cada intento —ejecutado, rechazado o fallido— deja
traza en `agent_tool_calls` y en la auditoría, y la corrida admite hasta dos
rondas de herramientas y cuatro llamadas en total antes de devolver la
conversación al equipo.

Ese conjunto se anuncia **mientras quede una ronda para ejecutarlo**: la llamada
que ya no podría honrar una petición se hace sin herramientas, y es la que
responde. No es un ahorro: el modelo comprobado contra el proveedor real pide una
función siempre que se le anuncien, también ante un «gracias», de modo que
anunciarlas hasta el final dejaría la corrida sin respuesta. El detalle está en
el [módulo de herramientas y su autorización](./tools-and-permissions.md) y en
[ADR-0017](../decisions/ADR-0017-agent-tool-contract.md).

```text
mensaje entrante -> buffer -> corrida -> herramientas anunciadas
  -> el modelo responde texto            -> salida existente
  -> el modelo pide herramientas         -> ejecutar, trazar y volver a llamar
  -> gastada la última ronda             -> llamar sin herramientas, y responder
```

## Qué puede afirmar

Las instrucciones publicadas van primero, y el backend las envuelve en un marco
que el modelo no puede modificar: responder con un solo mensaje de WhatsApp
dentro del límite del canal, y no afirmar lo que la corrida no puede consultar,
ofreciendo en su lugar que una persona lo confirme.

Esa segunda regla **se acota con lo que la corrida realmente puede consultar**.
Con herramientas anunciadas, los servicios, sus precios y la cita del contacto
dejan de ser materia de invención y pasan a consultarse; lo que **ninguna**
herramienta expone —horarios de atención, disponibilidad y promociones— conserva
su prohibición. Lo que levanta la prohibición sobre servicios y precios es
**haber obtenido el dato**, no haber intentado obtenerlo: sin herramientas
**autorizadas** la corrida no va a consultar nada en ningún momento, y la
corrida que sí las tenía pero cuyas llamadas quedaron todas rechazadas o
fallidas tampoco consultó nada. En ambos casos la regla queda entera: no afirmar
servicios, precios, promociones ni horarios que no estén escritos en las
instrucciones.

El marco **se construye por llamada y no una vez por corrida**, porque lo que la
corrida puede consultar cambia dentro de ella. Los estados son **tres**, no dos:

| En qué punto llega la corrida a esta llamada | Qué le pide el marco |
| --- | --- |
| Sin ningún dato obtenido: ninguna herramienta autorizada, o todas sus llamadas rechazadas o fallidas | No afirmar servicios, precios, promociones ni horarios que no estén escritos en las instrucciones |
| Con herramientas anunciadas y una ronda por gastar | Consultar lo que necesite antes de responder, y responder con lo que devuelvan |
| Con alguna herramienta que ya devolvió dato y las rondas agotadas | Responder ahora con lo que devolvieron: no queda consulta pendiente ni van a llegar más resultados |

Los dos últimos son los que se confundían, y confundirlos costaba la respuesta
por dos caminos distintos. La llamada que responde va sin herramientas, así que
invitarla a «consultar con las herramientas disponibles» empujaba al modelo a
pedir una que nadie iba a ejecutar. Y esa misma llamada **ya consultó**:
prohibirle afirmar el precio la ponía a contradecir el dato que llevaba en el
mismo request, porque el resultado de la herramienta viaja en su propio hilo de
turnos. El marco le pedía ignorar lo que el backend le acababa de dar.

El tercer estado lo elige **haber obtenido dato, y no haber gastado las
rondas**. Un rechazo y un fallo también empujan un turno al hilo, pero lo que
llevan es un error redactado —`{"error":"no_permitido"}` o
`{"error":"no_disponible"}`—, que no es materia con la que responder: invitar
ahí a responder «con lo que las herramientas devolvieron» levantaría la
prohibición sobre precios justo en la corrida que no consultó nada, que es
invitar a inventarlos. El dato se acumula **por corrida y no por ronda**: si una
ronda obtuvo resultado y la otra no, el resultado sigue en el hilo y el marco
sigue siendo el tercero.

Lo que sobrevive a los tres estados es lo que **ninguna herramienta expone**:
horarios de atención, disponibilidad y promociones no tienen dueño en ningún
esquema entregado, así que no hay ronda que pueda consultarlos y su prohibición
no se levanta nunca. Eso es lo que
[ADR-0017](../decisions/ADR-0017-agent-tool-contract.md) fija en su regla 8, que
se lee **a nivel de corrida**: «sin herramientas anunciadas» describe la corrida
que no llegó a consultar nada —porque nunca anunció ninguna, o porque ninguna
devolvió resultado—, no la última llamada de una corrida que sí obtuvo el dato.

No es un control de seguridad —un prompt nunca lo es, según las reglas
compartidas— sino la respuesta honesta a lo que el agente no puede saber. Que
`services` se consulte por una herramienta autorizada en backend, y no por una
copia en el prompt, es lo que exige su condición de dato relacional con dueño en
D1 ([ADR-0010](../decisions/ADR-0010-crm-commercial-model.md)).

## Un mensaje que no es texto

No se contesta a ciegas. La corrida queda `skipped` con
`UNSUPPORTED_MESSAGE_CONTENT` y la conversación vuelve al equipo: alguien tiene
que mirar la imagen o escuchar el audio.

## Cuando no hay respuesta

Un fallo del proveedor, una salida inválida, un agente sin versión publicada
o un límite de herramientas agotado deja un código en la corrida o en la
auditoría. El CRM devuelve al equipo una conversación que conserva la misma
atención automática y registra el cambio como actor `system`. Si alguien
cambió el modo, el estado o la asignación mientras el modelo respondía, el CRM
respeta esa decisión. Una candidata descartada por ese motivo deja
`ATTENTION_CHANGED` y no crea un mensaje saliente.

Reactivar al agente vuelve a ser una decisión humana explícita.

## Un mensaje nuevo durante una corrida

El runtime marca la corrida en vuelo. Si vence el buffer mientras hay una
corrida activa, vuelve a programarlo. Un nuevo mensaje por sí solo conserva
la candidata pendiente y queda disponible para el próximo vencimiento.
D1 garantiza una sola corrida por organización y mensaje disparador mediante
un índice único. El historial de atención identifica cambios de control,
incluso si luego se restauró el modo previo.

## Publicación y recuperación

Al preparar una candidata, el arnés devuelve el resultado al CRM. El CRM
comprueba que la atención siga vigente al guardar el saliente y su entrega,
mantiene al agente como remitente `system` y usa la identidad de la corrida
para la clave de idempotencia. El saliente viaja por `OUTBOUND_MESSAGES`.
La corrida queda en `succeeded` cuando la cola acepta el trabajo. Los estados
de entrega y lectura pertenecen al mensaje.

Un fallo de encolado deja el vínculo al saliente y
`OUTBOUND_QUEUE_UNAVAILABLE`. Si una interrupción deja la corrida abierta,
repetir el disparador conserva esa corrida. El
[procedimiento de recuperación](../operations/environments.md#corridas-automáticas-interrumpidas)
describe cómo investigar su salida. La decisión está en
[ADR-0018](../decisions/ADR-0018-agent-execution-and-crm-publication.md).

## Modos

Fase 1 permitía `human` y `paused`. Con este corte se habilita `automatic`.
`supervised` sigue reservado por el contrato aceptado: existe en el esquema desde
`0004`, pero nada prepara todavía un borrador que aprobar
([#60](https://github.com/LuisVR391/agent-cloudflare/issues/60)).

Ninguna conversación existente cambia de modo por sí sola: todas siguen en
`human` y sin agente hasta que alguien lo decida desde el inbox.
