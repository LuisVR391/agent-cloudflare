import type { PageCursor } from "../domain/types";

/**
 * Piezas comunes de las superficies HTTP autenticadas del panel. Viven aquí
 * porque el cursor opaco y el límite de página son contrato compartido: si
 * cada módulo los reimplementara, dos rutas podrían aceptar cursores distintos
 * sin que nada lo detectara.
 */

export function json(value: unknown, status = 200): Response {
  return Response.json(value, { status, headers: { "Cache-Control": "no-store" } });
}

export function parseLimit(value: string | null, fallback: number): number | null {
  const parsed = Number(value ?? fallback);
  return Number.isInteger(parsed) && parsed >= 1 ? Math.min(parsed, 100) : null;
}

/**
 * El cursor es opaco para el cliente: transporta la tupla que ordena la
 * consulta, no un dato con significado propio. Se valida antes de tocar SQL y
 * falla cerrado, como cualquier otra entrada no confiable.
 */
const CURSOR_MAX_LENGTH = 128;

export function encodeCursor(cursor: PageCursor | null): string | null {
  return cursor ? `${cursor.timestamp}|${cursor.id}` : null;
}

export function parseCursor(value: string | null): { cursor?: PageCursor } | null {
  if (value === null) return { cursor: undefined };
  if (value.length === 0 || value.length > CURSOR_MAX_LENGTH) return null;
  const separator = value.indexOf("|");
  if (separator <= 0 || separator === value.length - 1) return null;
  return {
    cursor: {
      timestamp: value.slice(0, separator),
      id: value.slice(separator + 1),
    },
  };
}

/**
 * Escapa los comodines de `LIKE` en texto escrito por una persona. Sin esto,
 * un `%` en la búsqueda dejaría de ser literal y devolvería filas que nadie
 * pidió. Las consultas que la usan declaran `ESCAPE '\'`.
 */
export function escapeLikePattern(value: string): string {
  return value.replace(/[\\%_]/g, (character) => `\\${character}`);
}
