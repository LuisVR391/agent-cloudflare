import {
  ModelProviderError,
  parseModelReply,
  type ModelProvider,
  type ModelReply,
  type ModelRequest,
  type ModelToolDeclaration,
  type ModelTurn,
} from "./model-provider";

/**
 * Primer proveedor de la capa común: Workers AI, por el binding `AI` que ya
 * está declarado en los tres entornos (ADR-0015). No exige credencial, recurso
 * ni autorización nuevos.
 *
 * El binding tipa `run` contra el catálogo cerrado de modelos de Cloudflare,
 * pero `agent_versions.model` es un identificador opaco que la empresa escribe:
 * el catálogo no puede resolverse en tiempo de compilación. Por eso el binding
 * se consume a través de esta vista estructural, y un modelo desconocido se
 * clasifica como proveedor no disponible en vez de romper la conversación.
 */
type InferenceBinding = {
  run(
    model: string,
    inputs: {
      messages: Array<{ role: string; content: string; name?: string }>;
      max_tokens: number;
      tools?: BindingTool[];
    },
  ): Promise<unknown>;
};

/**
 * La forma concreta con la que el binding anuncia una función
 * (`AiTextGenerationToolInput`). El contrato común conserva su vocabulario
 * propio y la traducción vive aquí: cambiar de proveedor no debe reescribir el
 * catálogo ni la corrida.
 */
type BindingTool = {
  type: "function";
  function: ModelToolDeclaration;
};

/**
 * El binding solo admite `role`, `content` y `name` por turno: no tiene forma
 * de transportar la petición de herramienta que el modelo emitió. La segunda
 * vuelta se le devuelve, entonces, con el resultado etiquetado por el nombre de
 * la función, que es lo que necesita para continuar; el turno del asistente que
 * solo pidió herramientas no aporta contenido y se omite en vez de inventarle
 * un texto que el modelo leería como suyo.
 */
function toBindingMessage(
  turn: ModelTurn,
): { role: string; content: string; name?: string } | null {
  if (turn.role === "tool") {
    return { role: "tool", name: turn.name, content: turn.content };
  }
  if (turn.content.trim() === "") return null;
  return { role: turn.role, content: turn.content };
}

/**
 * El binding no acepta `AbortSignal`, así que el límite se aplica desde fuera.
 * Una corrida que tarda más que esto se abandona y se registra: el contacto ya
 * dejó de esperar, y la conversación vuelve a manos del equipo.
 */
export const MODEL_TIMEOUT_MS = 20_000;

class WorkersAiModelProvider implements ModelProvider {
  constructor(private readonly binding: InferenceBinding) {}

  async generate(request: ModelRequest): Promise<ModelReply> {
    let timer: ReturnType<typeof setTimeout> | undefined;
    const tools = request.tools ?? [];
    try {
      const output = await Promise.race([
        this.binding.run(request.model, {
          messages: [
            { role: "system", content: request.instructions },
            ...request.turns
              .map(toBindingMessage)
              .filter((message): message is NonNullable<typeof message> =>
                message !== null,
              ),
          ],
          max_tokens: request.maxOutputTokens,
          // El campo solo existe cuando el backend autorizó alguna
          // herramienta: anunciar una lista vacía es invitar al modelo a
          // preguntarse qué falta.
          ...(tools.length === 0
            ? {}
            : {
                tools: tools.map((tool) => ({
                  type: "function" as const,
                  function: tool,
                })),
              }),
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new ModelProviderError("MODEL_TIMEOUT")),
            MODEL_TIMEOUT_MS,
          );
        }),
      ]);
      return parseModelReply(output, { toolsOffered: tools.length > 0 });
    } catch (caught) {
      if (caught instanceof ModelProviderError) throw caught;
      // El error del proveedor no se propaga tal cual: puede citar el prompt o
      // el mensaje del contacto, y la traza solo conserva códigos redactados.
      throw new ModelProviderError("MODEL_UNAVAILABLE", { cause: caught });
    } finally {
      if (timer !== undefined) clearTimeout(timer);
    }
  }
}

/**
 * Construye el proveedor del entorno. Sin binding de inferencia no hay
 * proveedor: se devuelve `null` para que la corrida lo registre como
 * `MODEL_UNAVAILABLE` y escale a una persona, en vez de fallar con una
 * excepción que nadie relacionaría con la configuración que falta.
 */
export function createModelProvider(env: {
  AI?: unknown;
}): ModelProvider | null {
  if (!env.AI || typeof (env.AI as InferenceBinding).run !== "function") {
    return null;
  }
  return new WorkersAiModelProvider(env.AI as InferenceBinding);
}
