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
  response: z.string().trim().min(1).max(4000).nullish(),
  tool_calls: z.array(toolCallSchema).optional(),
})
```

Una salida vacía o más larga de lo que WhatsApp acepta **no se recorta ni se
degrada**: falla cerrado. Un mensaje truncado hacia una clienta es peor que
ninguno. Una salida sin respuesta y sin llamadas tampoco describe nada, y
**pedir una herramienta cuando no se anunció ninguna** es igual de inválida: qué
existe para esa corrida lo decidió el backend.

El adaptador acepta las dos formas con las que un proveedor devuelve una llamada
—la función anidada con los argumentos como texto JSON, y el nombre y los
argumentos en la raíz— y traduce ambas al vocabulario del contrato. Los
argumentos que no son JSON válido **se conservan tal cual** para que el schema
del catálogo los rechace y esa llamada quede registrada, en vez de invalidar la
respuesta entera.

El nombre de la función se valida como identificador corto, y `parseModelToolName`
**repite esa validación en el punto de escritura**: el nombre acaba en la traza
de la corrida, y un `ModelReply` construido por otro proveedor no atraviesa esta
capa. El límite de confianza se aplica donde se usa el dato, no solo donde
entró.

## Códigos de fallo

| Código | Situación |
| --- | --- |
| `MODEL_UNAVAILABLE` | No hay binding de inferencia, o el proveedor falló |
| `MODEL_TIMEOUT` | El proveedor no respondió dentro del límite |
| `MODEL_OUTPUT_INVALID` | La salida no cumple el schema |

Son códigos estables y redactados. El error del proveedor **no se propaga**:
puede citar el prompt o el mensaje del contacto, y ni la traza ni los logs
conservan ese contenido.

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
