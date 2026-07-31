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
 * El contacto referenciado no pertenece a la organización activa. Impide crear
 * filas que crucen el límite de aislamiento aunque cada clave foránea sea
 * válida por separado.
 */
export class ContactNotInOrganizationError extends Error {
  readonly contactId: string;

  constructor(contactId: string) {
    super(`El contacto "${contactId}" no pertenece a la organización indicada.`);
    this.name = "ContactNotInOrganizationError";
    this.contactId = contactId;
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
