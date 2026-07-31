/**
 * Falla cerrada cuando una operación sobre datos empresariales no puede
 * demostrar a qué organización pertenece. Se lanza antes de consultar D1.
 */
export class MissingOrganizationScopeError extends Error {
  readonly operation: string;

  constructor(operation: string) {
    super(`La operación "${operation}" requiere un organizationId válido.`);
    this.name = "MissingOrganizationScopeError";
    this.operation = operation;
  }
}

/**
 * Una fila persistida contiene un valor fuera del dominio esperado. Indica
 * corrupción o una migración incompleta, no una entrada del usuario.
 */
export class InvalidPersistedValueError extends Error {
  readonly column: string;

  constructor(column: string, value: unknown) {
    super(`La columna "${column}" contiene un valor inesperado: ${String(value)}`);
    this.name = "InvalidPersistedValueError";
    this.column = column;
  }
}

/**
 * Verifica que exista una organización antes de tocar la base. El valor se
 * deriva de contexto autenticado o configuración confiable; nunca de un
 * identificador enviado por el frontend sin validar.
 */
export function requireOrganizationScope(
  organizationId: string,
  operation: string,
): string {
  if (organizationId.trim() === "") {
    throw new MissingOrganizationScopeError(operation);
  }

  return organizationId;
}
