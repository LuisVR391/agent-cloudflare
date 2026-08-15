import { error, resolveAuthorizationContext } from "./auth/http";
import type { WorkerEnv } from "./auth/types";
import {
  MAX_METRICS_RANGE_DAYS,
  civilDaysBetween,
  isCivilDate,
  metricsRange,
} from "./domain/time-zone";
import { json } from "./http/api-helpers";
import { MetricsRepository } from "./repositories/metrics-repository";

/**
 * Métricas del proceso para un periodo elegido.
 *
 * El rango es obligatorio y acotado, y ninguna de las dos cosas es negociable
 * ([ADR-0012](../../.docs/decisions/ADR-0012-initial-metrics.md)): una métrica
 * derivada sin rango es un escaneo del historial completo, y un máximo que
 * decidiera el cliente no sería un máximo. Por eso no hay periodo por defecto
 * aquí; el panel elige el suyo y lo envía siempre.
 *
 * Los dos extremos llegan como días civiles e **inclusivos**, y se interpretan
 * con la zona horaria de la organización: quien pide del 1 al 31 espera el 31
 * entero, medido donde vive el salón.
 */
export async function routeMetricsApi(
  request: Request,
  env: WorkerEnv,
): Promise<Response | null> {
  const url = new URL(request.url);
  if (url.pathname !== "/api/metrics") return null;

  const correlationId =
    request.headers.get("x-correlation-id") ?? crypto.randomUUID();
  const authorization = await resolveAuthorizationContext(request, env);
  if (!authorization.authorized) {
    return error(
      authorization.status,
      authorization.code,
      authorization.message,
      correlationId,
    );
  }

  if (request.method !== "GET") {
    return error(
      405,
      "METHOD_NOT_ALLOWED",
      "El método solicitado no está permitido.",
      correlationId,
    );
  }

  const { context } = authorization;
  const organizationId = context.activeOrganization.organizationId;
  const timeZone = context.activeOrganization.organizationTimeZone;

  if (!context.activeOrganization.permissions.includes("metrics.read")) {
    return error(
      403,
      "FORBIDDEN",
      "No tienes permiso para consultar las métricas.",
      correlationId,
    );
  }

  const from = url.searchParams.get("from");
  const to = url.searchParams.get("to");
  if (from === null || to === null || !isCivilDate(from) || !isCivilDate(to)) {
    return error(
      400,
      "INVALID_RANGE",
      "El periodo solicitado no es válido: indica una fecha de inicio y una de fin.",
      correlationId,
    );
  }

  // Un rango invertido mide menos de un día e incluye el caso de fin anterior
  // al inicio, así que la misma comparación cubre ambos rechazos.
  const days = civilDaysBetween(from, to);
  if (days < 1) {
    return error(
      400,
      "INVALID_RANGE",
      "El periodo solicitado termina antes de empezar.",
      correlationId,
    );
  }
  if (days > MAX_METRICS_RANGE_DAYS) {
    return error(
      400,
      "RANGE_TOO_LONG",
      `El periodo no puede superar ${MAX_METRICS_RANGE_DAYS} días.`,
      correlationId,
    );
  }

  const window = metricsRange(from, to, timeZone);
  const repository = new MetricsRepository(env.DB);
  const summary = await repository.summary(organizationId, window);

  // El periodo viaja de vuelta resuelto: el panel muestra qué se midió y en qué
  // zona, en vez de repetir el cálculo del día por su cuenta.
  return json({ timeZone, range: { from, to, days }, window, ...summary });
}
