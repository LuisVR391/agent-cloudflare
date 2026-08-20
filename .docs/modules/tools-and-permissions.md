# Herramientas y su autorización

> **Estado:** vigente para las herramientas de solo lectura que introduce el
> corte de herramientas autorizadas en backend
> ([#56](https://github.com/LuisVR391/agent-cloudflare/issues/56)). Describe lo
> que existe hoy, no lo planificado.

Una herramienta es una consulta al CRM que el agente puede pedir mientras
responde. Quién decide si puede pedirla **no es el modelo ni el prompt**: es el
backend, antes de anunciársela. Las decisiones que gobiernan este módulo están
en [ADR-0017](../decisions/ADR-0017-agent-tool-contract.md), que extiende el
contrato de proveedor y la traza de la corrida de
[ADR-0015](../decisions/ADR-0015-model-provider-and-agent-runs.md).

## Las dos herramientas del catálogo

| Clave | Qué devuelve | De dónde sale |
| --- | --- | --- |
| `list_services` | Los servicios **activos** de la organización, con nombre, duración en minutos y precio ya formateado | `ServiceRepository.list` |
| `get_own_appointment` | La **próxima** cita no terminal del contacto de esa conversación —servicio, inicio, fin y estado— o `null` si no tiene | `AppointmentRepository.listBySubject` |

Las claves son las de la [guía](../guia-arquitectura-producto.md) §24.1 y son
también el nombre de la función que el modelo invoca: dos vocabularios harían que
el panel prometiera algo que el modelo no entiende. La descripción que lee el
modelo es la misma que lee quien la marca en el panel, por la misma razón.

Ninguna herramienta abre un camino nuevo a la base: ambas entran por un
repositorio que ya existía y que filtra por `organization_id`.
`get_own_appointment` descarta las citas terminales —cancelada, realizada, no
asistida— porque describen algo que terminó, y las pasadas, porque «la próxima»
significa eso.

El catálogo vive en código (`src/worker/agents/tool-catalog.ts`) y no en D1: el
handler es código, y una fila que nombrara un handler inexistente sería un
segundo dueño del mismo hecho. El precedente es `permissionDefinitions`.

## Cómo se autoriza: cuatro controles antes de anunciar

La corrida resuelve el conjunto de herramientas **antes de la primera llamada al
modelo**, en el orden de la regla de seguridad de la guía §14.2:

```text
organización del contexto de la corrida
  -> contacto leído en D1 (conversations.contact_id)
  -> qué declaró la versión publicada (agent_version_tools)
  -> ¿existe en el catálogo cerrado?      no -> no se anuncia, log UNKNOWN_TOOL
  -> ¿su audiencia es `contact`?          no -> no se anuncia, log AUDIENCE_MISMATCH
  -> ¿hay contacto que acote la consulta? no -> no se anuncia, log SUBJECT_UNRESOLVED
  -> se anuncia
```

**Lo que no sobrevive a esa secuencia no llega al modelo.** No se anuncia una
lista con herramientas deshabilitadas ni se le explica al modelo qué le falta:
sencillamente no existe para esa corrida. Y sin ninguna superviviente, el campo
`tools` no viaja en la petición.

Ese conjunto se resuelve una sola vez, pero **no viaja en todas las llamadas de
la corrida**: solo mientras quede una ronda para ejecutarlo. El motivo, medido
contra el proveedor real, está en «Límites de la corrida».

Una declaración descartada **no deja fila** en `agent_tool_calls`: no hubo
intento del modelo, solo una clave que el catálogo vigente ya no reconoce o que
no puede acotarse a esta conversación. Queda en
el log como `agent.tool.declaration_ignored` con su motivo, su corrida y su
correlación. Es la reconciliación entre declaraciones históricas y catálogo
vigente que [ADR-0014](../decisions/ADR-0014-configurable-agents-and-published-versions.md)
aplazó hasta este corte, y por eso ninguna versión ya publicada se rompe.

Cuando el modelo pide una herramienta, **lo que se acepta es el conjunto
anunciado y no el catálogo**: una herramienta que existe pero que esta versión no
declaró tampoco se ejecuta.

## El sujeto sale del backend, nunca del argumento

La organización viene del contexto de la corrida y el contacto de
`conversations.contact_id`, leído en D1. Un identificador que el modelo proponga
no llega al handler y no cambia el resultado.

Por eso **ninguna herramienta de este corte recibe argumentos**, y su schema es
**estricto**:

- La llamada legítima es la que no trae argumentos. `arguments` **ausente** o
  **`null`** equivale exactamente a eso, y la herramienta se ejecuta: un
  proveedor que omite el campo de una función sin parámetros no está proponiendo
  nada distinto de un objeto vacío.
- Una clave que el modelo añada —un `contactId`, por ejemplo— **invalida la
  llamada entera**, que queda `rejected` con `TOOL_ARGUMENTS_INVALID` y su
  auditoría. **No se descarta en silencio.** Descartarla dejaría la misma
  evidencia para una consulta limpia y para un intento de alcanzar datos ajenos,
  y la traza dejaría de distinguirlos.
- Unos argumentos que llegan como **cadena que no parsea** se conservan tal cual
  y el schema los rechaza: fallan cerrado. Eso incluye la cadena vacía, que no es
  «sin argumentos» sino una salida malformada, y adivinar su intención sería
  completar lo que el modelo no dijo. Un texto que no es JSON invalida esa
  llamada, no la respuesta entera.

Un fallo de validación **no se degrada ni se completa con valores por omisión**:
unos argumentos que no validan no describen la consulta que se iba a hacer.

## Qué queda registrado

Cada intento —ejecutado, rechazado o fallido— deja **dos escrituras en el mismo
lote**: una fila en `agent_tool_calls` y una entrada en `audit_logs` de tipo
`system`, con el agente como actor y la acción `conversation.agent.tool`. Ningún
actor humano autorizó ese intento en concreto, sino la configuración que alguien
publicó. Responden preguntas distintas: la tabla conserva qué ocurrió dentro de
una corrida y en qué orden; la auditoría, quién intentó qué y con qué resultado.

| Columna | Contenido |
| --- | --- |
| `run_id`, `sequence` | La corrida y el ordinal del intento dentro de ella |
| `tool_key` | La herramienta que se intentó |
| `result` | `succeeded`, `rejected` o `failed` |
| `failure_code` | Código estable; obligatorio salvo en `succeeded` |
| `correlation_id` | El del mensaje disparador, heredado |

Los tres resultados no son sinónimos: `succeeded` es una ejecución que terminó,
`rejected` es la contención funcionando y `failed` es una avería.

**Ni la tabla ni la auditoría conservan los argumentos ni el resultado.** Los
argumentos pueden arrastrar lo que la clienta escribió, y el resultado ya tiene
dueño en `services` y en `appointments`. Es la misma regla que dejó a
`agent_runs` sin el prompt ni el texto del mensaje.

`agent_tool_calls_run_sequence_unique` impide que un reintento duplique la traza.

### `tool_key` nunca contiene texto elegido por el modelo

El nombre de la función es lo único que el modelo aporta a esa columna, y se
valida como identificador corto **dos veces**: al traducir la salida del
proveedor y otra vez justo antes de escribir, porque el límite de confianza se
aplica donde se usa el dato y un proveedor podría construir la respuesta sin
pasar por la primera validación. Un nombre que no valida se registra como
`__invalid_tool_name__`, una constante del backend: que el nombre no fuera un
identificador ya es el dato relevante; cuál era exactamente, no.

## Códigos

| Código | Dónde aparece | Cuándo |
| --- | --- | --- |
| `TOOL_NOT_OFFERED` | `agent_tool_calls.failure_code` | El modelo pidió una herramienta que no se le anunció en esta corrida |
| `TOOL_ARGUMENTS_INVALID` | `agent_tool_calls.failure_code` | Los argumentos no cumplen el schema estricto, incluida una clave sobrante o un texto que no parsea |
| `TOOL_EXECUTION_FAILED` | `agent_tool_calls.failure_code` | La herramienta estaba autorizada y su ejecución lanzó |
| `TOOL_ROUNDS_EXCEEDED` | `agent_runs.failure_code` | La corrida gastó sus dos rondas y el modelo volvió a pedir herramientas en la llamada final, que ya no las anunciaba |
| `TOOL_CALL_LIMIT_EXCEEDED` | `agent_runs.failure_code` | La corrida superaría las cuatro llamadas en total |
| `AGENT_TOOL_UNKNOWN` | Respuesta `400` de la API de agentes | Un borrador declara una clave que no existe en el catálogo |

Los dos códigos de corrida dejan la corrida `failed` y **devuelven la
conversación a `human`** con su historial y su auditoría, como toda corrida que
no responde (ADR-0015, regla 6).

## Qué ve el modelo cuando algo va mal

Solo esto, y siempre lo mismo:

```json
{"error":"no_permitido"}   // rechazo: no anunciada, o argumentos inválidos
{"error":"no_disponible"}  // la ejecución falló
```

Está redactado a propósito. El detalle de una excepción puede citar la consulta o
la fila que la produjo, y un identificador interno no significa nada fuera del
backend: el modelo repetiría cualquiera de los dos a la clienta. Distinguir
«no permitido» de «no disponible» es todo lo que necesita para decidir si
reformula o si ofrece que una persona lo confirme.

El detalle tampoco se conserva del lado del servidor: el `catch` de la ejecución
no captura la excepción y el registro lleva solo el código de fallo, la
herramienta, la corrida y la correlación. Un intento rechazado ni siquiera deja
línea de log, porque su fila y su auditoría ya lo explican. Diagnosticar un fallo
se hace con ese código y esa correlación, no con el mensaje de la excepción.

## Límites de la corrida

- **Dos rondas** de herramientas por corrida, para encadenar una consulta que
  depende de otra. A la tercera petición, `TOOL_ROUNDS_EXCEEDED`, aunque esa
  petición llegue por el único camino que le queda al modelo: una llamada que ya
  no anuncia herramientas.
- **Cuatro llamadas** en total, además de las rondas: una sola ronda con veinte
  llamadas cuesta lo mismo que veinte rondas. El corte ocurre **antes de ejecutar
  nada** de la ronda que lo excede, porque consultar por un resultado que nadie
  leerá es gasto.
- **La última llamada va sin herramientas.** El conjunto autorizado se resuelve
  una sola vez, pero solo se anuncia mientras quede una ronda para ejecutarlo:
  agotada la segunda, la llamada que tiene que responder se hace sin `tools`, y
  **su marco de prompt tampoco invita a usarlas**, porque se construye por
  llamada con lo que esa llamada anuncia de verdad. Lo que el marco le pide en
  su lugar depende de **si alguna herramienta devolvió dato**: si lo hizo,
  responder con lo que ya devolvieron, que viaja en el hilo de esa misma
  petición; si todas las llamadas quedaron rechazadas o fallidas, esa corrida no
  consultó nada y conserva entera la prohibición sobre servicios y precios
  ([runtime de conversación](./conversation-runtime.md)).

Un mensaje con herramientas cuesta hasta tres llamadas al modelo. Con el modelo
comprobado contra el proveedor real, ese peor caso es el caso corriente, por lo
que explica el apartado siguiente. Medir ese gasto es
[#61](https://github.com/LuisVR391/agent-cloudflare/issues/61).

### Por qué la última llamada no puede llevar herramientas

No es una optimización: **sin esto el agente no responde nunca**. El modelo lo
elige cada versión y `agent_versions.model` es opaco, pero el que se comprobó
contra el proveedor real —`@cf/meta/llama-3.3-70b-instruct-fp8-fast`— se comporta
así: mientras `tools` viaje en la petición **emite una llamada a función
siempre**, también ante un «hola» o un «gracias» que no necesitan consultar nada,
y `tool_choice` no lo cambia.

Si la última llamada llevara herramientas, la corrida no alcanzaría texto jamás:
la primera petición pide función, la segunda vuelve a pedirla, y la tercera cae
en `TOOL_ROUNDS_EXCEEDED`. La conversación volvería al equipo sin haber
respondido nada **incluso cuando el contacto solo dijo «gracias»**. Retirar
`tools` de la llamada final es lo que deja al modelo sin nada que pedir y le
obliga a responder con texto.

Es la misma regla del resto del corte —no se anuncia lo que no se puede
autorizar— aplicada un paso antes: anunciar una herramienta que la corrida ya no
podría ejecutar es invitar a una petición imposible de honrar.

**Lo que cuesta.** Como el modelo vuelve a pedir la herramienta mientras se le
anuncie, una pregunta que se resolvería con una consulta gasta **dos consultas de
la misma herramienta**: la de la primera ronda y la de la segunda, que repite en
vez de responder. El techo de cuatro llamadas es lo que acota ese gasto. Medirlo
es [#61](https://github.com/LuisVR391/agent-cloudflare/issues/61).

Es comportamiento **de este proveedor y este modelo**, no del contrato: otro
modelo que responda texto en cuanto tiene el dato agota menos rondas, y la regla
—anunciar solo mientras quede ronda para ejecutar— lo cubre igual.

### Cómo se distingue esa tercera petición de una salida inválida

Retirar `tools` de la última llamada tiene una consecuencia sobre el
diagnóstico: cuando el modelo insiste ahí, el proveedor solo ve una petición de
herramienta en una llamada que no anunció ninguna, que es su definición de salida
inválida. Sin más contexto, la corrida cerraría con `MODEL_OUTPUT_INVALID` y la
traza diría que el modelo devolvió basura cuando lo que hizo fue agotar su
presupuesto de rondas.

**El proveedor dice qué vio; la corrida decide por qué ocurrió.** El error del
proveedor lleva `reason: "TOOL_CALL_NOT_OFFERED"` junto a su código, y la corrida
—que es la única que sabe si esa llamada iba desnuda por presupuesto o porque no
había ninguna herramienta autorizada— lo traduce:

| Qué pasó en esa llamada | Código de la corrida |
| --- | --- |
| La corrida tenía herramientas autorizadas y gastó sus dos rondas | `TOOL_ROUNDS_EXCEEDED` |
| La corrida no tenía ninguna herramienta autorizada | `MODEL_OUTPUT_INVALID` |
| La salida no describía ni texto ni una petición bien formada | `MODEL_OUTPUT_INVALID` |

El desenlace de negocio es el mismo en los tres —la corrida falla cerrado, la
conversación vuelve al equipo y queda su traza (ADR-0015, regla 6)—, pero el
código es lo que alguien lee después. Cómo viaja ese motivo lo describe el
[módulo de proveedores de modelo](./model-providers.md).

## Superficie HTTP y panel

| Ruta | Método | Permiso | Qué hace |
| --- | --- | --- | --- |
| `/api/agent-tools` | `GET` | `agents.read` | Devuelve el catálogo con clave, etiqueta y descripción |

El catálogo es del producto y no de la organización: no hay recurso ajeno que
ocultar y la lectura no se audita, como el resto de las lecturas. Sin
`agents.read` responde `403`.

Guardar un borrador (`POST` y `PUT` de una revisión, con `agents.manage`) valida
ahora las claves contra el catálogo y responde `400 AGENT_TOOL_UNKNOWN` sin
escribir nada. En el panel, `/app/agentes` ofrece las herramientas para marcarlas
en lugar de escribirlas, con la descripción de cada una.

**El corte no introduce ningún permiso.** `agents.manage` ya decide qué
herramientas declara un agente y `agents.read` ya permite consultarlas; ambos
están en el catálogo de instalación desde el commit que creó `0002`. La unidad de
autorización de una corrida no es una persona con rol, sino la versión publicada,
que es inmutable y tiene autor, motivo e historial. El razonamiento completo está
en [ADR-0017](../decisions/ADR-0017-agent-tool-contract.md), regla 2.

## Limitación conocida: la escala del precio

`list_services` compone el precio dividiendo el importe entre cien y añadiendo la
moneda, **para cualquier moneda**. El importe se guarda como entero en la unidad
menor de la moneda ([módulo de servicios](./pipelines.md)), y esa división supone
dos decimales, así que es **incorrecta para una moneda que no los tiene**, como
`JPY`.

No se corrigió en este corte, y el motivo es que corregirlo aquí lo empeora: la
escala fija es anterior y vive en el panel, que guarda el importe multiplicando
por cien para cualquier moneda. El Worker dividiendo entre cien es **consistente
con cómo está guardado el dato**; hacerlo consciente de la moneda dejaría al
agente diciendo un número distinto del que ve el salón. El defecto es de la
escala del producto, no de la herramienta, y se corrige donde se guarda el
importe.

Sin moneda no hay precio que afirmar: el campo llega como `null` en vez de un
número suelto.

## Qué no hace este corte

- **No escribe nada.** Ninguna herramienta produce un efecto, así que no hay
  clave de idempotencia que inventar: el índice único de la corrida y el de la
  traza impiden duplicar un reintento.
- **No expone horarios de atención ni disponibilidad.** No existen en ningún
  esquema del producto; el marco del prompt conserva su prohibición sobre ellos y
  sobre las promociones, y la conserva **en los tres estados** de la corrida,
  porque ninguna ronda podría consultarlos.
- **No recupera conocimiento** no estructurado
  ([#57](https://github.com/LuisVR391/agent-cloudflare/issues/57)).
- **No pide confirmación humana** antes de nada
  ([#60](https://github.com/LuisVR391/agent-cloudflare/issues/60)).
- **No mide tokens ni costo** ni conmuta de proveedor
  ([#61](https://github.com/LuisVR391/agent-cloudflare/issues/61)).
- **No incluye herramientas internas, administrativas ni del supervisor**: sirven
  a otra audiencia y llegan con su fase.
