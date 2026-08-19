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

/** Turno del hilo tal como lo ve el modelo. */
export type ModelTurn = {
  role: "user" | "assistant";
  content: string;
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
};

export type ModelReply = {
  text: string;
};

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

const replySchema = z.object({
  response: z.string().trim().min(1).max(MODEL_REPLY_MAX_CHARACTERS),
});

/**
 * La salida del modelo es no confiable hasta validar su schema. Un candidato
 * que no lo cumple no se degrada a texto vacío ni se recorta: falla cerrado,
 * porque un mensaje truncado hacia una clienta es peor que ninguno.
 */
export function parseModelReply(candidate: unknown): ModelReply {
  const parsed = replySchema.safeParse(candidate);
  if (!parsed.success) {
    throw new ModelProviderError("MODEL_OUTPUT_INVALID");
  }
  return { text: parsed.data.response.trim() };
}
