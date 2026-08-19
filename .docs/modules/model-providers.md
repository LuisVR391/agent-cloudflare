# Proveedores de modelo

> **Estado:** vigente para la capa común que introduce el corte de ejecución en
> la conversación
> ([#55](https://github.com/LuisVR391/agent-cloudflare/issues/55)). Describe lo
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
  turns: Array<{ role: "user" | "assistant"; content: string }>;
  maxOutputTokens: number;
};

type ModelReply = { text: string };
```

Lo que **no** viaja en él importa tanto como lo que sí: ninguna credencial,
ningún identificador de organización, ninguna referencia a un archivo y ninguna
herramienta. El proveedor resuelve sus secretos desde su binding o desde
Cloudflare Secrets, y el aislamiento se decide antes, al construir el contexto.

`instructions` lo compone el backend con las instrucciones de la versión
publicada, su playbook si lo tiene, y el marco que fijan el canal y los datos que
el agente todavía no puede consultar. El modelo no puede modificarlo, y lo que el
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
z.object({ response: z.string().trim().min(1).max(4000) })
```

Una salida vacía o más larga de lo que WhatsApp acepta **no se recorta ni se
degrada**: falla cerrado. Un mensaje truncado hacia una clienta es peor que
ninguno.

## Códigos de fallo

| Código | Situación |
| --- | --- |
| `MODEL_UNAVAILABLE` | No hay binding de inferencia, o el proveedor falló |
| `MODEL_TIMEOUT` | El proveedor no respondió dentro del límite |
| `MODEL_OUTPUT_INVALID` | La salida no cumple el schema |

Son códigos estables y redactados. El error del proveedor **no se propaga**:
puede citar el prompt o el mensaje del contacto, y ni la traza ni los logs
conservan ese contenido.

## Qué no hace todavía

No mide tokens ni costo, no conmuta entre proveedores, no aplica límites de
gasto y no anuncia herramientas al modelo. Cada una llega con su corte, y esta
capa es el punto donde se enchufarán.
