import { z } from "zod";

import { isTerminal } from "../domain/appointment-status";
import { AppointmentRepository } from "../repositories/appointment-repository";
import { ServiceRepository } from "../repositories/service-repository";
import type { ModelToolDeclaration } from "./model-provider";

/**
 * Catálogo cerrado de herramientas del producto (ADR-0017).
 *
 * Vive en código y no en D1 porque el handler es código: una fila que nombrara
 * un handler inexistente sería un segundo dueño del mismo hecho, y ninguna
 * empresa puede añadir una herramienta. El precedente es `permissionDefinitions`
 * y la matriz de transiciones de `appointment-status.ts`.
 *
 * Una versión publicada declara qué herramientas usa, pero la declaración no
 * autoriza nada por sí sola: la corrida intersecta lo declarado con este
 * catálogo, filtra por audiencia y solo entonces anuncia lo que sobrevive.
 */

/**
 * A quién sirve la herramienta. Hoy solo existe la conversación con el
 * contacto; las internas, las administrativas y las del supervisor llegan con
 * su fase, y hasta entonces una audiencia distinta no se anuncia en una
 * conversación con una clienta.
 */
export type AgentToolAudience = "contact";

/**
 * Lo que el handler recibe. Todo sale del backend: la organización de la
 * corrida, el contacto leído en D1 y los identificadores de la traza. El
 * modelo no participa en su construcción y no puede alterarlo, que es lo que
 * impide que un argumento inventado alcance datos ajenos.
 */
export type AgentToolContext = {
  db: D1Database;
  organizationId: string;
  conversationId: string;
  contactId: string;
  agentId: string;
  runId: string;
  correlationId: string;
};

export type AgentToolDefinition = {
  /** Clave del catálogo, y también el nombre de la función que ve el modelo. */
  key: string;
  /** Nombre corto para quien la marca en el panel. */
  label: string;
  /**
   * Lo que lee el modelo, y lo mismo que lee la persona que la marca: dos
   * vocabularios distintos harían que el panel prometiera algo que el modelo no
   * entiende.
   */
  description: string;
  audience: AgentToolAudience;
  /** Ninguna herramienta de este corte produce un efecto. */
  effect: "read";
  argsSchema: z.ZodType;
  run(context: AgentToolContext, args: unknown): Promise<unknown>;
};

/**
 * Conserva el tipo del schema dentro de la definición sin obligar al catálogo a
 * ser genérico: cada handler ve sus argumentos ya validados, y el runtime ve
 * una lista homogénea.
 */
function defineTool<Schema extends z.ZodType>(definition: {
  key: string;
  label: string;
  description: string;
  audience: AgentToolAudience;
  effect: "read";
  argsSchema: Schema;
  run(context: AgentToolContext, args: z.infer<Schema>): Promise<unknown>;
}): AgentToolDefinition {
  return definition;
}

/**
 * Ninguna herramienta de este corte recibe argumentos, y el schema es estricto.
 * Una clave que el modelo añada —un `contactId`, por ejemplo— no llega al
 * handler, porque el sujeto de la consulta sale del contexto y no de lo que el
 * modelo proponga; pero tampoco se descarta en silencio: invalida la llamada
 * entera, que queda `rejected` con su fila y su auditoría. Descartarla dejaría
 * la misma evidencia para una consulta limpia y para un intento de alcanzar
 * datos ajenos, y la traza dejaría de distinguirlos.
 *
 * Nada legítimo se pierde: la llamada correcta es la que no trae argumentos, y
 * el objeto vacío la satisface.
 */
const noArguments = z.object({}).strict();

/**
 * El importe se guarda en la unidad menor de la moneda, y devolverlo así
 * invitaría a leer «80000» como el precio. Se compone ya formateado, con la
 * escala de dos decimales de las monedas del mercado del producto; sin moneda
 * no hay precio que afirmar, y devolver `null` es más honesto que un número
 * suelto.
 */
function formatPrice(
  amountCents: number | null,
  currency: string | null,
): string | null {
  if (amountCents === null || currency === null) return null;
  return `${(amountCents / 100).toFixed(2)} ${currency}`;
}

const listServices = defineTool({
  key: "list_services",
  label: "Consultar servicios",
  description:
    "Devuelve los servicios activos del salón con su duración en minutos y su"
    + " precio. Úsala antes de hablar de qué se ofrece o de cuánto cuesta.",
  audience: "contact",
  effect: "read",
  argsSchema: noArguments,
  async run(context) {
    const services = await new ServiceRepository(context.db).list(
      context.organizationId,
      { status: "active" },
    );
    return {
      services: services.map((service) => ({
        name: service.name,
        durationMinutes: service.durationMinutes,
        price: formatPrice(service.priceAmountCents, service.priceCurrency),
      })),
    };
  },
});

const getOwnAppointment = defineTool({
  key: "get_own_appointment",
  label: "Consultar la cita del contacto",
  description:
    "Devuelve la próxima cita de la persona con la que estás hablando, con su"
    + " servicio, su horario y su estado, o ninguna si no tiene. No consulta las"
    + " citas de nadie más.",
  audience: "contact",
  effect: "read",
  argsSchema: noArguments,
  async run(context) {
    const appointments = await new AppointmentRepository(
      context.db,
    ).listBySubject(context.organizationId, {
      // El sujeto sale del contexto de la corrida, que lo leyó en D1. Un
      // identificador propuesto por el modelo no llega hasta aquí.
      type: "contact",
      id: context.contactId,
    });
    const now = new Date().toISOString();
    const upcoming = appointments
      // Una cita cancelada, realizada o no asistida ya no es «la próxima»:
      // describe algo que terminó.
      .filter(
        (appointment) =>
          !isTerminal(appointment.status) && appointment.startsAt >= now,
      )
      .sort((left, right) => left.startsAt.localeCompare(right.startsAt))
      .at(0);

    return {
      appointment:
        upcoming === undefined
          ? null
          : {
              serviceName: upcoming.serviceName,
              startsAt: upcoming.startsAt,
              endsAt: upcoming.endsAt,
              status: upcoming.status,
            },
    };
  },
});

/**
 * El catálogo entero, en el orden en que se ofrece. Las claves son las de la
 * guía §24.1 y no se renombran: son también el nombre de la función que el
 * modelo invoca.
 */
export const agentToolCatalog: readonly AgentToolDefinition[] = [
  listServices,
  getOwnAppointment,
];

/**
 * Resuelve una clave declarada. La comparación pliega mayúsculas y espacios
 * porque es la misma forma que el repositorio persiste al declarar: aceptar
 * `LIST_SERVICES` y guardar otra cosa declararía una herramienta distinta de la
 * que se validó.
 */
export function findAgentTool(key: string): AgentToolDefinition | undefined {
  const normalized = key.trim().toLocaleLowerCase("es");
  return agentToolCatalog.find((tool) => tool.key === normalized);
}

export function isAgentToolKey(key: string): boolean {
  return findAgentTool(key) !== undefined;
}

/** Lo que el panel necesita para ofrecer la herramienta: nada del handler. */
export function agentToolCatalogEntries(): {
  key: string;
  label: string;
  description: string;
}[] {
  return agentToolCatalog.map((tool) => ({
    key: tool.key,
    label: tool.label,
    description: tool.description,
  }));
}

/**
 * Traduce la definición a lo que se anuncia al modelo. La audiencia, el efecto
 * y el handler no viajan: son decisiones de backend, y anunciarlas invitaría a
 * discutirlas en el prompt.
 */
export function toModelToolDeclaration(
  tool: AgentToolDefinition,
): ModelToolDeclaration {
  const schema = z.toJSONSchema(tool.argsSchema) as {
    properties?: Record<string, { type?: string; description?: string }>;
    required?: string[];
  };
  return {
    name: tool.key,
    description: tool.description,
    parameters: {
      type: "object",
      properties: Object.fromEntries(
        Object.entries(schema.properties ?? {}).map(([name, property]) => [
          name,
          {
            type: property.type ?? "string",
            ...(property.description === undefined
              ? {}
              : { description: property.description }),
          },
        ]),
      ),
      required: schema.required ?? [],
    },
  };
}
