import type { AppointmentStatus } from "./types";

/**
 * Ciclo de vida de una cita, declarado como dato y no repartido por condicionales
 * en el handler: es regla de negocio, no de transporte, y una transición que no
 * aparece aquí no ocurre.
 *
 * Se lee así: una cita solicitada aún no reserva nada, así que solo puede
 * agendarse, confirmarse o descartarse. Una reprogramada vuelve al circuito —se
 * reconfirma, se mueve otra vez o se cierra— porque mover un horario no decide
 * el desenlace. Cancelada, realizada y no asistió son terminales: describen algo
 * que ya ocurrió, y corregir un desenlace equivocado es agendar de nuevo, no
 * reescribir el pasado.
 */
export const allowedTransitions: Record<AppointmentStatus, AppointmentStatus[]> =
  {
    requested: ["pending", "confirmed", "cancelled"],
    pending: ["confirmed", "rescheduled", "cancelled", "no_show"],
    confirmed: ["rescheduled", "cancelled", "completed", "no_show"],
    rescheduled: [
      "confirmed",
      "rescheduled",
      "cancelled",
      "completed",
      "no_show",
    ],
    cancelled: [],
    completed: [],
    no_show: [],
  };

/** Estados con los que una cita puede nacer: los que aún no describen desenlace. */
export const initialStatuses: AppointmentStatus[] = [
  "requested",
  "pending",
  "confirmed",
];

/**
 * Repetir el estado vigente no es una transición: dejar el mismo valor no
 * cambia nada y no debería rechazarse como si lo hiciera. `rescheduled` es la
 * excepción real, porque mover otra vez una cita ya movida sí es un hecho
 * nuevo, y la matriz lo declara.
 */
export function canTransition(
  from: AppointmentStatus,
  to: AppointmentStatus,
): boolean {
  return from === to || allowedTransitions[from].includes(to);
}

/** Un estado del que ya no se sale: la cita terminó de una forma u otra. */
export function isTerminal(status: AppointmentStatus): boolean {
  return allowedTransitions[status].length === 0;
}
