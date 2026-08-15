/**
 * Horas de agenda en la zona horaria de la empresa.
 *
 * El Worker ya resuelve el rango que consulta D1: cuál es el día 15 de agosto
 * para esta organización es una decisión de servidor, porque acaba en una
 * cláusula `WHERE` y no puede depender del navegador de quien mira. Lo que
 * queda aquí es lo contrario: componer y presentar. Escribir «10:00» en el
 * formulario significa las diez de la mañana de la empresa, no las del
 * dispositivo, y mostrar una cita significa mostrar su hora local del salón
 * aunque quien la revise esté de viaje.
 *
 * Por eso el cálculo se repite en vez de compartirse: el módulo del Worker
 * decide qué filas se leen y este decide qué ve una persona. Ambos parten del
 * mismo instante ISO 8601 UTC, que es lo único que se persiste.
 */

/** Desfase de la zona respecto a UTC, en minutos, para un instante concreto. */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // `h23` evita que la medianoche aparezca como «24» y desplace el día.
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    second: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: Intl.DateTimeFormatPartTypes): number =>
    Number(parts.find((part) => part.type === type)?.value ?? "0");

  const asIfUtc = Date.UTC(
    field("year"),
    field("month") - 1,
    field("day"),
    field("hour"),
    field("minute"),
    field("second"),
  );
  return (asIfUtc - Math.floor(instant / 1000) * 1000) / 60_000;
}

/**
 * Instante UTC de una hora escrita en el formulario. `datetime-local` entrega
 * `YYYY-MM-DDTHH:mm` sin zona, y aquí esa hora es la de la empresa.
 *
 * Dos pasadas, como en el Worker: la primera estima con el desfase vigente en
 * esa marca leída como UTC y la segunda lo corrige, para que una cita agendada
 * cerca del cambio de horario de verano no se guarde una hora antes.
 */
export function instantFromZonedInput(
  local: string,
  timeZone: string,
): string | null {
  const parsed = Date.parse(`${local}:00.000Z`);
  if (Number.isNaN(parsed)) return null;
  const firstGuess = parsed - offsetMinutes(parsed, timeZone) * 60_000;
  const settled = parsed - offsetMinutes(firstGuess, timeZone) * 60_000;
  return new Date(settled).toISOString();
}

/** Valor para un `datetime-local` que ya trae la hora de la empresa escrita. */
export function zonedInputValue(instant: string, timeZone: string): string {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone,
    hourCycle: "h23",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  }).formatToParts(new Date(instant));

  const field = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find((part) => part.type === type)?.value ?? "00";

  return `${field("year")}-${field("month")}-${field("day")}T${field("hour")}:${field("minute")}`;
}

/** Día civil que la empresa está viviendo, no el del dispositivo. */
export function todayIn(timeZone: string, instant = new Date()): string {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(instant);
}

/** Suma días sobre la fecha civil, no sobre un instante: el calendario manda. */
export function shiftCivilDate(date: string, days: number): string {
  const [year, month, day] = date.split("-").map(Number);
  return new Date(Date.UTC(year, month - 1, day + days))
    .toISOString()
    .slice(0, 10);
}

/** Lunes de la semana que contiene esa fecha, como en la agenda del Worker. */
export function startOfWeek(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftCivilDate(date, -((weekday + 6) % 7));
}

/** Los siete días de la semana que contiene esa fecha. */
export function weekDays(date: string): string[] {
  const monday = startOfWeek(date);
  return Array.from({ length: 7 }, (_, index) => shiftCivilDate(monday, index));
}

/** Hora de la cita tal como la vive el salón. */
export function formatTime(instant: string, timeZone: string): string {
  return new Date(instant).toLocaleTimeString(undefined, {
    timeZone,
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Etiqueta de un día civil. Se formatea en UTC a propósito: `date` ya es el día
 * de la empresa, así que reinterpretarlo en otra zona lo movería.
 */
export function formatDayLabel(
  date: string,
  options: Intl.DateTimeFormatOptions = {
    weekday: "long",
    day: "numeric",
    month: "long",
  },
): string {
  return new Date(`${date}T00:00:00.000Z`).toLocaleDateString(undefined, {
    ...options,
    timeZone: "UTC",
  });
}

/** El día civil de la empresa al que pertenece un instante. */
export function zonedDayOf(instant: string, timeZone: string): string {
  return todayIn(timeZone, new Date(instant));
}
