/**
 * Interpretación de un día de agenda en la zona horaria de la organización.
 *
 * Las marcas de tiempo se siguen almacenando en ISO 8601 UTC, sin excepción
 * ([ADR-0010](../../../.docs/decisions/ADR-0010-crm-commercial-model.md)). La
 * zona horaria solo decide dónde empieza y dónde termina el día que alguien
 * mira: sin ella, la agenda de un salón en `America/Mexico_City` cortaría a las
 * 18:00 locales, que es cuando cambia el día en UTC.
 *
 * El cálculo vive en el Worker y no en el cliente porque el filtro es una
 * consulta a D1: el rango tiene que llegar resuelto a la cláusula `WHERE`, y
 * confiar en el navegador dejaría que cada persona viera una agenda distinta de
 * la misma empresa.
 */

export type AgendaRange = "day" | "week";

const CIVIL_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Un identificador IANA válido para esta plataforma. Es entrada no confiable:
 * llega del panel y termina decidiendo qué citas se muestran, así que se
 * comprueba contra el runtime en vez de contra una lista propia que quedaría
 * desactualizada.
 *
 * Los desfases numéricos —`+05:00`— también los acepta `Intl`, pero no son una
 * zona: no describen el horario de verano y quedarían congelados medio año.
 */
export function isSupportedTimeZone(value: string): boolean {
  if (!value.includes("/") && value !== "UTC") return false;
  try {
    new Intl.DateTimeFormat("en-US", { timeZone: value });
    return true;
  } catch {
    return false;
  }
}

/** `YYYY-MM-DD` que además existe en el calendario: `2026-02-30` no. */
export function isCivilDate(value: string): boolean {
  if (!CIVIL_DATE.test(value)) return false;
  const [year, month, day] = value.split("-").map(Number);
  const parsed = new Date(Date.UTC(year, month - 1, day));
  return (
    parsed.getUTCFullYear() === year &&
    parsed.getUTCMonth() === month - 1 &&
    parsed.getUTCDate() === day
  );
}

/**
 * Desfase de la zona respecto a UTC, en minutos, para un instante concreto. Se
 * pregunta por instante y no por zona porque el horario de verano lo cambia dos
 * veces al año: un valor fijo desplazaría la agenda una hora durante medio año.
 */
function offsetMinutes(instant: number, timeZone: string): number {
  const parts = new Intl.DateTimeFormat("en-US", {
    timeZone,
    // `h23` evita que la medianoche se formatee como «24», que es lo que hace
    // `hour12: false` en algunos runtimes y desplazaría el día entero.
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

  // El instante se trunca al segundo porque el formateador no devuelve
  // milisegundos; sin truncar, el resto aparecería como desfase.
  return (asIfUtc - Math.floor(instant / 1000) * 1000) / 60_000;
}

/**
 * Instante UTC en el que empieza un día civil de esa zona.
 *
 * Se resuelve en dos pasadas: la primera usa el desfase vigente en la
 * medianoche UTC de esa fecha, la segunda el que rige en el instante estimado.
 * Sin la segunda, un día que cruza el cambio de horario de verano empezaría una
 * hora antes o después de lo que la empresa vive. Donde la medianoche local no
 * existe —zonas que saltan de 23:59 a 01:00—, el resultado es el primer
 * instante que sí existe de ese día, que es cuando la agenda empieza de verdad.
 */
export function zonedStartOfDay(date: string, timeZone: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const civilMidnight = Date.UTC(year, month - 1, day);
  const firstGuess = civilMidnight - offsetMinutes(civilMidnight, timeZone) * 60_000;
  const settled = civilMidnight - offsetMinutes(firstGuess, timeZone) * 60_000;
  return new Date(settled).toISOString();
}

/**
 * Fecha civil que la empresa está viviendo ahora mismo. «Hoy» es la pregunta
 * que alguien se hace al abrir la agenda, y la respuesta la da la zona de la
 * organización, no la del servidor ni la del navegador de quien mira.
 */
export function zonedToday(timeZone: string, instant = new Date()): string {
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

/**
 * Lunes de la semana que contiene esa fecha. La semana empieza en lunes porque
 * así se lee una agenda de trabajo; el domingo al final no parte el fin de
 * semana en dos columnas separadas.
 */
export function startOfWeek(date: string): string {
  const [year, month, day] = date.split("-").map(Number);
  const weekday = new Date(Date.UTC(year, month - 1, day)).getUTCDay();
  return shiftCivilDate(date, -((weekday + 6) % 7));
}

/**
 * Rango semiabierto `[from, to)` en UTC del día o la semana pedidos. Semiabierto
 * para que una cita a las 00:00 pertenezca a un solo día y no aparezca en dos.
 */
export function agendaRange(
  date: string,
  range: AgendaRange,
  timeZone: string,
): { from: string; to: string } {
  const start = range === "week" ? startOfWeek(date) : date;
  return {
    from: zonedStartOfDay(start, timeZone),
    to: zonedStartOfDay(shiftCivilDate(start, range === "week" ? 7 : 1), timeZone),
  };
}

/**
 * Máximo de días civiles que puede abarcar una consulta de métricas. El rango
 * acotado es el único control de costo que tiene un cálculo derivado
 * ([ADR-0012](../../../.docs/decisions/ADR-0012-initial-metrics.md)), así que
 * el máximo se declara aquí y no se deja al cliente. Un trimestre cubre el
 * periodo más largo que un salón revisa de una vez.
 */
export const MAX_METRICS_RANGE_DAYS = 92;

/**
 * Días civiles que abarca `[from, to]`, contando ambos extremos: un rango de un
 * solo día mide 1. Un rango invertido devuelve un número menor que 1, que es lo
 * que permite rechazarlo sin comparar cadenas.
 */
export function civilDaysBetween(from: string, to: string): number {
  const [fromYear, fromMonth, fromDay] = from.split("-").map(Number);
  const [toYear, toMonth, toDay] = to.split("-").map(Number);
  const start = Date.UTC(fromYear, fromMonth - 1, fromDay);
  const end = Date.UTC(toYear, toMonth - 1, toDay);
  return (end - start) / 86_400_000 + 1;
}

/**
 * Rango semiabierto `[from, to)` en UTC de un periodo de métricas. Los dos días
 * civiles llegan **inclusivos** —quien pide del 1 al 31 espera el 31 entero—,
 * así que el fin se resuelve al inicio del día siguiente. Un mensaje recibido a
 * las 23:00 hora del salón pertenece a su día local, no al día UTC en el que
 * cae.
 */
export function metricsRange(
  from: string,
  to: string,
  timeZone: string,
): { from: string; to: string } {
  return {
    from: zonedStartOfDay(from, timeZone),
    to: zonedStartOfDay(shiftCivilDate(to, 1), timeZone),
  };
}
