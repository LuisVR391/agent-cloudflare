import {
  ModelProviderError,
  parseModelReply,
  type ModelProvider,
  type ModelReply,
  type ModelRequest,
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
      messages: Array<{ role: string; content: string }>;
      max_tokens: number;
    },
  ): Promise<unknown>;
};

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
    try {
      const output = await Promise.race([
        this.binding.run(request.model, {
          messages: [
            { role: "system", content: request.instructions },
            ...request.turns.map((turn) => ({
              role: turn.role,
              content: turn.content,
            })),
          ],
          max_tokens: request.maxOutputTokens,
        }),
        new Promise<never>((_resolve, reject) => {
          timer = setTimeout(
            () => reject(new ModelProviderError("MODEL_TIMEOUT")),
            MODEL_TIMEOUT_MS,
          );
        }),
      ]);
      return parseModelReply(output);
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
