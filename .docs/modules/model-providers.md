# Proveedores de modelo

> **Estado:** vigente para la capa común que introduce el corte de ejecución en
> la conversación
> ([#55](https://github.com/LuisVR391/agent-cloudflare/issues/55)) y que amplía
> el corte de herramientas autorizadas
> ([#56](https://github.com/LuisVR391/agent-cloudflare/issues/56)). Describe lo
> que existe hoy, no lo planificado.

El runtime de la conversación **no habla con ningún proveedor concreto**. Pide
una respuesta a un contrato propio, y quien la produce es intercambiable. Esa es
la razón de existir de esta capa: cuando llegue el failover
([#61](https://github.com/LuisVR391/agent-cloudflare/issues/61)), cambiar de
modelo o de proveedor no debe reescribir la conversación
([ADR-0015](../decisions/ADR-0015-model-provider-and-agent-runs.md)).

## El contrato

```ts
type ModelRequest = {
  model: string;            // identificador opaco de `agent_versions.model`
  instructions: string;     // lo construye el backend
  turns: ModelTurn[];       // usuario, asistente y resultado de herramienta
  maxOutputTokens: number;
  tools?: ModelToolDeclaration[];  // solo lo que el backend autorizó
};

type ModelReply =
  | { kind: "text"; text: string }
  | { kind: "toolCalls"; calls: ModelToolCall[] };
```

Lo que **no** viaja en él importa tanto como lo que sí: ninguna credencial,
ningún identificador de organización y ninguna referencia a un archivo. El
proveedor resuelve sus secretos desde su binding o desde Cloudflare Secrets, y el
aislamiento se decide antes, al construir el contexto.

`tools` solo existe cuando el backend autorizó alguna herramienta para esa
corrida; si no sobrevivió ninguna, el campo no viaja y el modelo no puede pedir
nada. De cada herramienta se anuncia su nombre, para qué sirve y la forma de sus
argumentos: la audiencia, el efecto y el handler se quedan en el catálogo, porque
son decisiones de backend y no se discuten con el modelo. Quién decide qué se
anuncia lo describe el
[módulo de herramientas y su autorización](./tools-and-permissions.md).

`ModelReply` es una **unión discriminada** y no dos campos opcionales: el modelo
respondió o pidió herramientas, y «ambos» y «ninguno» son justamente los estados
que la validación tiene que rechazar. Un tipo que los hace representables los
deja llegar hasta el runtime, donde ya no hay dónde fallar cerrado
([ADR-0017](../decisions/ADR-0017-agent-tool-contract.md)).

`instructions` lo compone el backend con las instrucciones de la versión
publicada, su playbook si lo tiene, y el marco que fijan el canal y los datos que
el agente puede o no puede consultar. El modelo no puede modificarlo, y lo que el
contacto escriba entra siempre como turno, nunca como instrucción. Qué contiene
ese marco lo describe el
[runtime de conversación](./conversation-runtime.md).

## Workers AI, el primer proveedor

El binding `AI` está declarado en local, staging y producción desde la Fase 0.
Adoptarlo no exige credencial, recurso ni autorización nuevos.

El binding tipa `run` contra el catálogo cerrado de modelos de Cloudflare, pero
`agent_versions.model` es un identificador **opaco** que escribe la empresa: no
puede resolverse en tiempo de compilación. Por eso se consume a través de una
vista estructural del binding, y un modelo desconocido no rompe la conversación:
se clasifica como proveedor no disponible.

El binding no acepta `AbortSignal`, así que el límite de tiempo se aplica desde
fuera, en 20 segundos. Pasado ese punto el contacto ya dejó de esperar.

## La salida se valida antes de ser un mensaje

```ts
z.object({
  response: z.unknown().optional(),
  tool_calls: z.array(toolCallSchema).optional(),
})
```

`response` **no se declara como texto, porque no siempre lo es.** Workers AI
entrega la petición de herramienta por uno de dos caminos: el campo `tool_calls`,
que es el que el proveedor reconoce, o el propio `response`, donde el modelo
escribe la petición mientras `tool_calls` llega vacío:

```json
{
  "response": {
    "type": "function",
    "function": { "name": "list_services", "parameters": {} }
  },
  "tool_calls": []
}
```

Declarar `response` como cadena convertía ese segundo camino en
`MODEL_OUTPUT_INVALID` y perdía la respuesta entera: contra el proveedor real, el
agente no respondía nada. Qué es cada cosa lo decide `parseModelReply`, que es
quien puede distinguir un texto de una petición.

Un `response` que llega sin ninguna llamada por el campo que el proveedor
reconoce se lee **como petición y con el mismo schema de llamada** —un objeto o
una lista de ellos— cuando describe una; `parameters` se admite ahí como rótulo
alterno de `arguments`, que es el que el modelo escribe cuando redacta la
petición él mismo. Aceptar ese camino no relaja ningún control: qué herramientas
pueden pedirse lo decidió el backend al anunciarlas, y si esos argumentos valen
lo decide el schema del catálogo.

Ese camino **no depende de que el proveedor haya deserializado el campo**. El
sobre medido trae el mismo contenido dos veces —como objeto en `response` y como
texto en `choices[0].message.content`—, así que una cadena que contiene la
petición describe exactamente lo mismo, y leerla como respuesta enviaría
`{"type":"function",…}` a la clienta.

La regla que decide es **estrecha a propósito**: no basta con que el texto
parezca JSON ni con que empiece por `{`. Tiene que parsear **y además** casar
con la forma de una llamada, cuyo nombre es un identificador corto y acotado.
Una respuesta legítima que empiece por llave no casa con ese schema y **se
envía intacta**; solo se desvía al camino de la petición lo que es
inequívocamente una petición. Sin esa estrechez, el arreglo costaría lo
contrario del defecto que corrige: una respuesta buena perdida por su primer
carácter.

El texto **se valida aparte y sigue fallando cerrado**: una respuesta vacía o más
larga de lo que el canal acepta **no se recorta ni se degrada**
([ADR-0015](../decisions/ADR-0015-model-provider-and-agent-runs.md), regla 3). Un
mensaje truncado hacia una clienta sigue siendo peor que ninguno. La flexibilidad
sobre `response` no ablanda esa regla: solo distingue una petición de herramienta
de un texto de respuesta, y todo lo que se juzga como texto pasa por el mismo
límite de siempre.

Sigue siendo `MODEL_OUTPUT_INVALID`:

- Un `response` que no es texto válido **ni** una petición bien formada. No se
  interpreta, no se degrada a mensaje y no se convierte en respuesta.
- Una salida sin texto y sin llamadas, por ninguno de los dos caminos: no
  describe nada.
- Pedir una herramienta en una llamada que no anunció ninguna: qué existe para
  esa llamada lo decidió el backend. Ese caso viaja además con un motivo, porque
  no siempre significa lo mismo.

Dentro de una llamada, el adaptador acepta las dos formas con las que un
proveedor la devuelve —la función anidada con los argumentos como texto JSON, y
el nombre y los argumentos en la raíz— y traduce ambas al vocabulario del
contrato. Los argumentos que no son JSON válido **se conservan tal cual** para
que el schema del catálogo los rechace y esa llamada quede registrada, en vez de
invalidar la respuesta entera.

El nombre de la función se valida como identificador corto, y `parseModelToolName`
**repite esa validación en el punto de escritura**: el nombre acaba en la traza
de la corrida, y un `ModelReply` construido por otro proveedor no atraviesa esta
capa. El límite de confianza se aplica donde se usa el dato, no solo donde
entró.

### El proveedor dice qué vio; la corrida decide por qué ocurrió

`parseModelReply` sabe que **esta** llamada fue sin herramientas, pero no por
qué. Puede ser que la corrida no tenga ninguna autorizada, o que las tuviera y
gastara sus rondas, de modo que la llamada final salió sin `tools` a propósito
—lo que explica el
[módulo de herramientas y su autorización](./tools-and-permissions.md)—. Son dos
causas distintas y el proveedor no puede distinguirlas: solo ve la petición que
él mismo hizo.

Por eso el error lleva un motivo además del código:

```ts
new ModelProviderError("MODEL_OUTPUT_INVALID", {
  reason: "TOOL_CALL_NOT_OFFERED",
})
```

El código **no cambia**: visto desde el proveedor, esa salida sigue siendo
inválida, y `reason` es `null` en todos los demás casos. Quien lo traduce es la
corrida, que sí sabe por qué la llamada fue desnuda: con herramientas autorizadas
y las rondas gastadas cierra con `TOOL_ROUNDS_EXCEEDED`; sin ninguna herramienta
autorizada sigue siendo `MODEL_OUTPUT_INVALID`, igual que una salida que no
describe nada.

El desenlace de negocio es el mismo en los dos casos —la corrida falla cerrado,
la conversación vuelve al equipo y queda la traza—, pero el código es lo que
alguien lee después, y un modelo que agotó su presupuesto de rondas no devolvió
basura.

## Códigos de fallo

| Código | Situación |
| --- | --- |
| `MODEL_UNAVAILABLE` | No hay binding de inferencia, o el proveedor falló |
| `MODEL_TIMEOUT` | El proveedor no respondió dentro del límite |
| `MODEL_OUTPUT_INVALID` | La salida no cumple el schema |

Son códigos estables y redactados. El error del proveedor **no se propaga**:
puede citar el prompt o el mensaje del contacto, y ni la traza ni los logs
conservan ese contenido.

`ModelProviderError` acompaña el código con un `reason` opcional cuando el motivo
cambia el desenlace de quien llama. Hoy hay uno solo, `TOOL_CALL_NOT_OFFERED`, y
no es un código de fallo: es el dato con el que la corrida decide con cuál de los
suyos cerrar.

## La traducción vive en el adaptador

El binding de Workers AI solo admite `role`, `content` y `name` por turno, así
que la segunda vuelta se le devuelve con el resultado etiquetado por el nombre de
la función; el turno del asistente que solo pidió herramientas no aporta
contenido y se omite en vez de inventarle un texto que el modelo leería como
suyo. Esa acomodación es del proveedor: el contrato conserva su vocabulario
propio, y cambiar de proveedor no debe reescribir el catálogo ni la corrida.

## Qué no hace todavía

No mide tokens ni costo, no conmuta entre proveedores y no aplica límites de
gasto ([#61](https://github.com/LuisVR391/agent-cloudflare/issues/61)). Cada una
llega con su corte, y esta capa es el punto donde se enchufarán.
