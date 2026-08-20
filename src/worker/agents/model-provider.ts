import { z } from "zod";

/**
 * Contrato común con el proveedor de inferencia.
 *
 * El runtime de la conversación no habla con ningún proveedor concreto: pide
 * una respuesta a esta interfaz. Es lo que permite que cambiar de modelo o de
 * proveedor —el failover del corte de presupuesto— no reescriba la
 * conversación (ADR-0015).
 *
 * El contrato no transporta credenciales ni identidad: cada proveedor resuelve
 * las suyas desde su binding o su secreto, y ninguna llega hasta aquí.
 */

/**
 * Lo que el modelo propuso ejecutar. Es una propuesta y nada más: el nombre
 * puede no existir, los argumentos son texto que el modelo generó, y quien
 * llama los valida contra el catálogo antes de tocar el CRM.
 */
export type ModelToolCall = {
  /** Identificador opaco del proveedor, cuando lo emite. */
  id: string | null;
  name: string;
  /** No confiable: se valida con el schema del catálogo antes de ejecutar. */
  arguments: unknown;
};

/**
 * Turno del hilo tal como lo ve el modelo. Los dos últimos son los de la
 * segunda vuelta: lo que el modelo pidió y lo que la ejecución devolvió.
 */
export type ModelTurn =
  | { role: "user"; content: string }
  | { role: "assistant"; content: string; toolCalls?: ModelToolCall[] }
  | { role: "tool"; name: string; toolCallId?: string | null; content: string };

/**
 * Lo que se anuncia de una herramienta: su nombre, para qué sirve y la forma de
 * sus argumentos. Nada más. La audiencia, el efecto y el handler se quedan en
 * el catálogo, porque son decisiones de backend y no se discuten con el modelo.
 */
export type ModelToolDeclaration = {
  name: string;
  description: string;
  parameters: {
    type: "object";
    properties: Record<string, { type: string; description?: string }>;
    required: string[];
  };
};

/**
 * Lo que el backend pide. `instructions` lo construye el servidor a partir de
 * la versión publicada; el modelo no puede modificarlo, y `turns` solo contiene
 * mensajes de la conversación en curso.
 */
export type ModelRequest = {
  /** Identificador opaco del modelo, tal como lo guardó la versión. */
  model: string;
  instructions: string;
  turns: ModelTurn[];
  maxOutputTokens: number;
  /**
   * Solo viaja cuando el backend autorizó alguna herramienta para esta corrida.
   * Sin herramientas anunciadas, el campo no existe y el modelo no puede pedir
   * ninguna.
   */
  tools?: ModelToolDeclaration[];
};

/**
 * Dos desenlaces excluyentes: el modelo respondió, o pidió herramientas. Es una
 * unión y no dos campos opcionales porque «ambos» y «ninguno» son justamente
 * los estados que la validación tiene que rechazar, y un tipo que los hace
 * representables los deja pasar hasta el runtime.
 */
export type ModelReply =
  | { kind: "text"; text: string }
  | { kind: "toolCalls"; calls: ModelToolCall[] };

export interface ModelProvider {
  generate(request: ModelRequest): Promise<ModelReply>;
}

/**
 * Motivos por los que una corrida no produjo respuesta. Son códigos estables y
 * redactados: la traza y los logs conservan el código, nunca el cuerpo del
 * proveedor, que puede contener el prompt o el mensaje del contacto.
 */
export type ModelFailureCode =
  | "MODEL_UNAVAILABLE"
  | "MODEL_TIMEOUT"
  | "MODEL_OUTPUT_INVALID";

export class ModelProviderError extends Error {
  readonly code: ModelFailureCode;

  constructor(code: ModelFailureCode, options?: { cause?: unknown }) {
    super(`El proveedor de modelo falló con el código "${code}".`, options);
    this.name = "ModelProviderError";
    this.code = code;
  }
}

/**
 * WhatsApp acepta 4096 caracteres por mensaje. El límite se aplica a la salida
 * del modelo antes de que exista como mensaje: una respuesta que el canal
 * rechazaría no es una respuesta válida.
 */
export const MODEL_REPLY_MAX_CHARACTERS = 4000;

/**
 * El nombre de la función que el modelo dice invocar. Se acota a un
 * identificador corto porque viaja a la traza de la corrida cuando la
 * herramienta no existe: la evidencia de qué se intentó no puede ser un texto
 * arbitrario generado por el modelo.
 */
const toolNameSchema = z.string().trim().min(1).max(80).regex(/^[\w.:-]+$/);

/**
 * El mismo nombre, validado fuera de la traducción del proveedor. Existe porque
 * el límite de confianza se aplica donde se usa el dato y no solo donde entró:
 * un `ModelReply` construido por otro camino no atraviesa `parseModelReply`, y
 * el nombre acaba escrito en la traza de la corrida. Devuelve el nombre
 * normalizado, o `null` si no es un identificador.
 */
export function parseModelToolName(candidate: string): string | null {
  const parsed = toolNameSchema.safeParse(candidate);
  return parsed.success ? parsed.data : null;
}

/**
 * Las dos formas con las que un proveedor devuelve una llamada: la estándar,
 * con la función anidada y los argumentos como texto JSON, y la heredada, con
 * el nombre y los argumentos ya en la raíz.
 *
 * El campo es opcional porque una función sin parámetros se invoca sin él, y
 * ninguna herramienta del catálogo recibe argumentos: exigirlo convertiría la
 * llamada legítima más probable en una salida inválida, y con ella se perdería
 * la respuesta entera y no solo esa llamada. Qué argumentos admite cada
 * herramienta lo decide su schema, que es quien puede saberlo.
 */
const toolCallSchema = z.union([
  z.object({
    id: z.string().trim().min(1).max(120).optional(),
    function: z.object({
      name: toolNameSchema,
      arguments: z.unknown().optional(),
    }),
  }),
  z.object({ name: toolNameSchema, arguments: z.unknown().optional() }),
]);

const replySchema = z.object({
  response: z
    .string()
    .trim()
    .min(1)
    .max(MODEL_REPLY_MAX_CHARACTERS)
    .nullish(),
  // Sin cota propia: cuántas llamadas admite una corrida lo decide la corrida,
  // que es quien las cuenta y quien las paga.
  tool_calls: z.array(toolCallSchema).optional(),
});

/**
 * Los argumentos llegan como texto JSON en la forma estándar y como objeto en
 * la heredada. Un texto que no es JSON no se corrige ni se completa: se
 * conserva tal cual para que el schema del catálogo lo rechace y la llamada
 * quede registrada como rechazada, en vez de invalidar la respuesta entera.
 */
function parseToolArguments(candidate: unknown): unknown {
  if (typeof candidate !== "string") return candidate;
  try {
    return JSON.parse(candidate);
  } catch {
    return candidate;
  }
}

function toToolCall(candidate: z.infer<typeof toolCallSchema>): ModelToolCall {
  if ("function" in candidate) {
    return {
      id: candidate.id ?? null,
      name: candidate.function.name,
      arguments: parseToolArguments(candidate.function.arguments),
    };
  }
  return {
    id: null,
    name: candidate.name,
    arguments: parseToolArguments(candidate.arguments),
  };
}

/**
 * La salida del modelo es no confiable hasta validar su schema. Un candidato
 * que no lo cumple no se degrada a texto vacío ni se recorta: falla cerrado,
 * porque un mensaje truncado hacia una clienta es peor que ninguno.
 *
 * Acepta una respuesta o unas llamadas, nunca la ausencia de ambas. Pedir una
 * herramienta cuando no se anunció ninguna también es salida inválida: qué
 * existe para esta corrida lo decidió el backend, y una salida que lo ignora no
 * describe nada ejecutable.
 */
export function parseModelReply(
  candidate: unknown,
  options: { toolsOffered?: boolean } = {},
): ModelReply {
  const parsed = replySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ModelProviderError("MODEL_OUTPUT_INVALID");
  }
  const calls = (parsed.data.tool_calls ?? []).map(toToolCall);
  if (calls.length > 0) {
    if (options.toolsOffered !== true) {
      throw new ModelProviderError("MODEL_OUTPUT_INVALID");
    }
    return { kind: "toolCalls", calls };
  }
  const text = parsed.data.response?.trim();
  if (!text) {
    throw new ModelProviderError("MODEL_OUTPUT_INVALID");
  }
  return { kind: "text", text };
}
