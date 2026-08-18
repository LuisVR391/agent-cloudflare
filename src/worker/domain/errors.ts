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
 * La membresía indicada como responsable no existe, no está activa o pertenece
 * a otra organización. Las tres se confunden a propósito: distinguirlas
 * revelaría a quién pertenece un identificador ajeno.
 */
export class MembershipNotActiveInOrganizationError extends Error {
  readonly membershipId: string;

  constructor(membershipId: string) {
    super(
      `La membresía "${membershipId}" no está activa en la organización indicada.`,
    );
    this.name = "MembershipNotActiveInOrganizationError";
    this.membershipId = membershipId;
  }
}

/**
 * Ya existe un servicio con ese nombre dentro de la organización. El nombre se
 * compara plegado a minúsculas y sin espacios en los extremos, así que «Corte»
 * y «corte » son el mismo servicio.
 */
export class DuplicateServiceNameError extends Error {
  readonly serviceName: string;

  constructor(serviceName: string) {
    super(`Ya existe un servicio llamado "${serviceName}" en la organización.`);
    this.name = "DuplicateServiceNameError";
    this.serviceName = serviceName;
  }
}

/**
 * La etapa destino no pertenece al pipeline de la oportunidad, o no existe en
 * esta organización. Las dos se confunden a propósito: distinguirlas revelaría
 * la existencia de una etapa ajena.
 */
export class StageNotInPipelineError extends Error {
  readonly stageId: string;

  constructor(stageId: string) {
    super(`La etapa "${stageId}" no pertenece al pipeline de la oportunidad.`);
    this.name = "StageNotInPipelineError";
    this.stageId = stageId;
  }
}

/**
 * El servicio referenciado no existe dentro de la organización activa. Como el
 * contacto, se comprueba dentro de la misma sentencia que escribe.
 */
export class ServiceNotInOrganizationError extends Error {
  readonly serviceId: string;

  constructor(serviceId: string) {
    super(`El servicio "${serviceId}" no pertenece a la organización indicada.`);
    this.name = "ServiceNotInOrganizationError";
    this.serviceId = serviceId;
  }
}

/**
 * Un pipeline sin etapas no puede recibir oportunidades ni volver a sembrarse,
 * así que la última no se borra: primero se crea su reemplazo.
 */
export class LastPipelineStageError extends Error {
  readonly pipelineId: string;

  constructor(pipelineId: string) {
    super(`El pipeline "${pipelineId}" no puede quedarse sin etapas.`);
    this.name = "LastPipelineStageError";
    this.pipelineId = pipelineId;
  }
}

/**
 * El reordenamiento no enumera exactamente las etapas vigentes del pipeline.
 * Una lista parcial dejaría posiciones huérfanas y una con etapas ajenas
 * cruzaría el límite de aislamiento, así que se rechaza entera.
 */
export class StageOrderMismatchError extends Error {
  readonly pipelineId: string;

  constructor(pipelineId: string) {
    super(
      `El orden solicitado no corresponde a las etapas del pipeline "${pipelineId}".`,
    );
    this.name = "StageOrderMismatchError";
    this.pipelineId = pipelineId;
  }
}

/**
 * El contacto, la conversación o la oportunidad a la que se quiso colgar la
 * tarea no existe en la organización activa. Los tres se confunden a propósito:
 * distinguirlos revelaría qué identificador ajeno existe.
 */
export class TaskSubjectNotInOrganizationError extends Error {
  readonly subjectId: string;

  constructor(subjectId: string) {
    super(`El sujeto "${subjectId}" no pertenece a la organización indicada.`);
    this.name = "TaskSubjectNotInOrganizationError";
    this.subjectId = subjectId;
  }
}

/**
 * El contacto, el servicio, la conversación o la oportunidad que la cita
 * referencia no existe en la organización activa, o el servicio está archivado.
 * Todos se confunden a propósito: distinguirlos revelaría qué identificador
 * ajeno existe.
 */
export class AppointmentReferenceNotInOrganizationError extends Error {
  readonly referenceId: string;

  constructor(referenceId: string) {
    super(
      `La referencia "${referenceId}" no está disponible en la organización indicada.`,
    );
    this.name = "AppointmentReferenceNotInOrganizationError";
    this.referenceId = referenceId;
  }
}

/**
 * El cambio de estado pedido no existe en el ciclo de vida de la cita. Se
 * rechaza en backend: la lista de acciones que muestre el panel es una ayuda,
 * no un control.
 */
export class AppointmentTransitionNotAllowedError extends Error {
  readonly from: string;
  readonly to: string;

  constructor(from: string, to: string) {
    super(`Una cita "${from}" no puede pasar a "${to}".`);
    this.name = "AppointmentTransitionNotAllowedError";
    this.from = from;
    this.to = to;
  }
}

/**
 * Ya existe un agente con ese nombre dentro de la organización. El nombre se
 * compara plegado a minúsculas y sin espacios en los extremos, y sigue
 * reservado aunque el agente esté archivado, para que reactivarlo no compita
 * con un duplicado creado mientras tanto.
 */
export class DuplicateAgentNameError extends Error {
  readonly agentName: string;

  constructor(agentName: string) {
    super(`Ya existe un agente llamado "${agentName}" en la organización.`);
    this.name = "DuplicateAgentNameError";
    this.agentName = agentName;
  }
}

/**
 * La versión referenciada no existe, pertenece a otro agente o a otra
 * organización. Las tres se confunden a propósito: distinguirlas revelaría qué
 * identificador ajeno existe.
 */
export class AgentVersionNotInOrganizationError extends Error {
  readonly versionId: string;

  constructor(versionId: string) {
    super(`La versión "${versionId}" no pertenece al agente indicado.`);
    this.name = "AgentVersionNotInOrganizationError";
    this.versionId = versionId;
  }
}

/**
 * Se intentó editar una versión que ya se publicó alguna vez. Su contenido
 * quedó congelado: cambiar el comportamiento exige una revisión nueva, o el
 * historial dejaría de explicar con qué configuración se respondió (ADR-0014).
 */
export class AgentVersionNotEditableError extends Error {
  readonly versionId: string;

  constructor(versionId: string) {
    super(`La versión "${versionId}" ya no es un borrador y no puede editarse.`);
    this.name = "AgentVersionNotEditableError";
    this.versionId = versionId;
  }
}

/**
 * La publicación pedida deja al agente exactamente como estaba. Se rechaza en
 * vez de aceptarse: el historial acumularía transiciones que no cambian nada y
 * `rolled_back` dejaría de poder derivarse.
 */
export class AgentPublicationUnchangedError extends Error {
  readonly agentId: string;

  constructor(agentId: string) {
    super(`La publicación del agente "${agentId}" ya está en ese estado.`);
    this.name = "AgentPublicationUnchangedError";
    this.agentId = agentId;
  }
}

/**
 * El agente que se pidió para atender la conversación no existe, pertenece a
 * otra organización, está archivado o no tiene versión publicada. Los cuatro se
 * confunden a propósito: distinguirlos revelaría qué identificador ajeno
 * existe, y ninguno puede responder.
 */
export class AgentNotRunnableError extends Error {
  readonly agentId: string | null;

  constructor(agentId: string | null) {
    super(
      `El agente "${agentId ?? "(ninguno)"}" no puede atender la conversación.`,
    );
    this.name = "AgentNotRunnableError";
    this.agentId = agentId;
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
