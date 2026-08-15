import {
  MembershipNotActiveInOrganizationError,
  TaskSubjectNotInOrganizationError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  CreateTaskInput,
  Task,
  TaskStatus,
  TaskSubject,
  UpdateTaskInput,
} from "../domain/types";

type TaskRow = {
  id: string;
  organization_id: string;
  title: string;
  details: string | null;
  assignee_membership_id: string;
  assignee_name: string | null;
  created_by_membership_id: string;
  due_at: string | null;
  status: string;
  contact_id: string | null;
  contact_display_name: string | null;
  conversation_id: string | null;
  conversation_contact_name: string | null;
  opportunity_id: string | null;
  opportunity_stage_name: string | null;
  version: number;
  completed_at: string | null;
  created_at: string;
  updated_at: string;
};

/**
 * El responsable y el sujeto se resuelven en la misma consulta que lee la
 * tarea: la lista los muestra en cada fila y resolverlos aparte produciría una
 * consulta por tarea. Los `LEFT JOIN` conservan la tarea aunque el nombre ya no
 * pueda resolverse.
 */
const taskSelect = `SELECT t.id, t.organization_id, t.title, t.details,
    t.assignee_membership_id, u.name AS assignee_name,
    t.created_by_membership_id, t.due_at, t.status,
    t.contact_id, c.display_name AS contact_display_name,
    t.conversation_id, cvc.display_name AS conversation_contact_name,
    t.opportunity_id, s.name AS opportunity_stage_name,
    t.version, t.completed_at, t.created_at, t.updated_at
  FROM tasks t
  LEFT JOIN memberships m
    ON m.organization_id = t.organization_id AND m.id = t.assignee_membership_id
  LEFT JOIN users u ON u.id = m.user_id
  LEFT JOIN contacts c
    ON c.organization_id = t.organization_id AND c.id = t.contact_id
  LEFT JOIN conversations cv
    ON cv.organization_id = t.organization_id AND cv.id = t.conversation_id
  LEFT JOIN contacts cvc
    ON cvc.organization_id = cv.organization_id AND cvc.id = cv.contact_id
  LEFT JOIN opportunities o
    ON o.organization_id = t.organization_id AND o.id = t.opportunity_id
  LEFT JOIN pipeline_stages s
    ON s.organization_id = o.organization_id AND s.id = o.stage_id`;

/**
 * Las tres columnas de sujeto se exponen como una sola forma. El `CHECK` de la
 * tabla garantiza que a lo sumo una esté presente, así que el orden solo
 * decide cuál se lee primero, no cuál gana.
 */
function toSubject(row: TaskRow): { subject: TaskSubject; label: string | null } {
  if (row.contact_id !== null) {
    return {
      subject: { type: "contact", id: row.contact_id },
      label: row.contact_display_name,
    };
  }
  if (row.conversation_id !== null) {
    return {
      subject: { type: "conversation", id: row.conversation_id },
      label: row.conversation_contact_name,
    };
  }
  if (row.opportunity_id !== null) {
    return {
      subject: { type: "opportunity", id: row.opportunity_id },
      label: row.opportunity_stage_name,
    };
  }
  return { subject: null, label: null };
}

function toTask(row: TaskRow): Task {
  const { subject, label } = toSubject(row);
  return {
    id: row.id,
    organizationId: row.organization_id,
    title: row.title,
    details: row.details,
    assigneeMembershipId: row.assignee_membership_id,
    assigneeName: row.assignee_name,
    createdByMembershipId: row.created_by_membership_id,
    dueAt: row.due_at,
    status: row.status === "done" || row.status === "cancelled" ? row.status : "open",
    subject,
    subjectLabel: label,
    version: row.version,
    completedAt: row.completed_at,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/** Columna física de cada tipo de sujeto, para no interpolar nombres. */
function subjectColumns(subject: TaskSubject): {
  contactId: string | null;
  conversationId: string | null;
  opportunityId: string | null;
} {
  return {
    contactId: subject?.type === "contact" ? subject.id : null,
    conversationId: subject?.type === "conversation" ? subject.id : null,
    opportunityId: subject?.type === "opportunity" ? subject.id : null,
  };
}

/**
 * Tareas de la organización. Todo método recibe `organizationId` como primer
 * parámetro y lo incluye en su cláusula `WHERE`: una consulta sin organización
 * falla antes de tocar D1 (ADR-0006).
 */
export class TaskRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Crea la tarea comprobando responsable y sujeto dentro de la propia
   * sentencia que inserta, así que no queda ventana entre verificar y escribir.
   * Sin responsable explícito, la tarea es de quien la crea: un pendiente sin
   * dueño no se opera.
   */
  async create(organizationId: string, input: CreateTaskInput): Promise<Task> {
    const scope = requireOrganizationScope(
      organizationId,
      "TaskRepository.create",
    );
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const assignee = input.assigneeMembershipId ?? input.createdByMembershipId;
    const subject = input.subject ?? null;
    const { contactId, conversationId, opportunityId } = subjectColumns(subject);

    const insert = await this.#db
      .prepare(
        `INSERT INTO tasks
           (id, organization_id, title, details, assignee_membership_id,
            created_by_membership_id, due_at, status, contact_id,
            conversation_id, opportunity_id, created_at, updated_at)
         SELECT ?, ?, ?, ?, ?, ?, ?, 'open', ?, ?, ?, ?, ?
          WHERE EXISTS (SELECT 1 FROM memberships m
                         WHERE m.organization_id = ? AND m.id = ?
                           AND m.status = 'active')
            AND EXISTS (SELECT 1 FROM memberships m
                         WHERE m.organization_id = ? AND m.id = ?
                           AND m.status = 'active')
            AND (? IS NULL OR EXISTS (
                  SELECT 1 FROM contacts WHERE organization_id = ? AND id = ?))
            AND (? IS NULL OR EXISTS (
                  SELECT 1 FROM conversations
                   WHERE organization_id = ? AND id = ?))
            AND (? IS NULL OR EXISTS (
                  SELECT 1 FROM opportunities
                   WHERE organization_id = ? AND id = ?))`,
      )
      .bind(
        id,
        scope,
        input.title,
        input.details ?? null,
        assignee,
        input.createdByMembershipId,
        input.dueAt ?? null,
        contactId,
        conversationId,
        opportunityId,
        now,
        now,
        scope,
        assignee,
        scope,
        input.createdByMembershipId,
        contactId,
        scope,
        contactId,
        conversationId,
        scope,
        conversationId,
        opportunityId,
        scope,
        opportunityId,
      )
      .run();

    // Sin filas candidatas no hubo inserción: el responsable no está activo
    // aquí, o el sujeto no vive en esta organización. Se distingue después para
    // responder con precisión sin revelar a quién pertenece un identificador
    // ajeno.
    if (insert.meta.changes !== 1) {
      if (!(await this.#isActiveMembership(scope, assignee))) {
        throw new MembershipNotActiveInOrganizationError(assignee);
      }
      throw new TaskSubjectNotInOrganizationError(subject?.id ?? "");
    }

    const created = await this.find(scope, id);
    if (created === null) throw new Error("TASK_CREATION_FAILED");
    return created;
  }

  /**
   * Tareas de la organización, con las pendientes primero y ordenadas por
   * vencimiento. Las que no tienen fecha van al final: no son más urgentes por
   * carecer de plazo.
   */
  async list(
    organizationId: string,
    filters: {
      assigneeMembershipId?: string;
      status?: TaskStatus;
      dueBefore?: string;
      limit?: number;
    } = {},
  ): Promise<Task[]> {
    const scope = requireOrganizationScope(organizationId, "TaskRepository.list");
    const conditions = ["t.organization_id = ?"];
    const bindings: unknown[] = [scope];

    if (filters.assigneeMembershipId) {
      conditions.push("t.assignee_membership_id = ?");
      bindings.push(filters.assigneeMembershipId);
    }
    if (filters.status) {
      conditions.push("t.status = ?");
      bindings.push(filters.status);
    }
    if (filters.dueBefore) {
      conditions.push("t.due_at IS NOT NULL AND t.due_at <= ?");
      bindings.push(filters.dueBefore);
    }

    const { results } = await this.#db
      .prepare(
        `${taskSelect}
          WHERE ${conditions.join(" AND ")}
          ORDER BY t.status = 'open' DESC, t.due_at IS NULL, t.due_at,
                   t.created_at DESC, t.id DESC
          LIMIT ?`,
      )
      .bind(...bindings, filters.limit ?? 100)
      .all<TaskRow>();

    return results.map(toTask);
  }

  /** Tareas colgadas de un sujeto concreto, para su ficha o su hilo. */
  async listBySubject(
    organizationId: string,
    subject: NonNullable<TaskSubject>,
    options: { limit?: number } = {},
  ): Promise<Task[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "TaskRepository.listBySubject",
    );
    const column =
      subject.type === "contact"
        ? "t.contact_id"
        : subject.type === "conversation"
          ? "t.conversation_id"
          : "t.opportunity_id";

    const { results } = await this.#db
      .prepare(
        `${taskSelect}
          WHERE t.organization_id = ? AND ${column} = ?
          ORDER BY t.status = 'open' DESC, t.due_at IS NULL, t.due_at,
                   t.created_at DESC, t.id DESC
          LIMIT ?`,
      )
      .bind(scope, subject.id, options.limit ?? 50)
      .all<TaskRow>();

    return results.map(toTask);
  }

  /** `null` fuera de la organización activa. */
  async find(organizationId: string, taskId: string): Promise<Task | null> {
    const scope = requireOrganizationScope(organizationId, "TaskRepository.find");
    const row = await this.#db
      .prepare(`${taskSelect} WHERE t.organization_id = ? AND t.id = ?`)
      .bind(scope, taskId)
      .first<TaskRow>();

    return row === null ? null : toTask(row);
  }

  /**
   * Actualiza con concurrencia optimista: `null` significa que la versión
   * quedó obsoleta y quien pide el cambio debe releer. El responsable solo se
   * escribe si es una membresía activa de esta organización, comprobado en la
   * misma sentencia.
   *
   * Cerrar sella `completed_at`; reabrir lo borra, porque una tarea abierta no
   * tiene fecha de cierre.
   */
  async update(
    organizationId: string,
    taskId: string,
    input: UpdateTaskInput,
  ): Promise<Task | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "TaskRepository.update",
    );
    const current = await this.find(scope, taskId);
    if (current === null || current.version !== input.expectedVersion) {
      return null;
    }

    const now = new Date().toISOString();
    const nextTitle = input.title ?? current.title;
    const nextDetails =
      input.details === undefined ? current.details : input.details;
    const nextAssignee =
      input.assigneeMembershipId ?? current.assigneeMembershipId;
    const nextDueAt = input.dueAt === undefined ? current.dueAt : input.dueAt;
    const nextStatus = input.status ?? current.status;
    const nextCompletedAt =
      nextStatus === "done" ? (current.completedAt ?? now) : null;

    const update = await this.#db
      .prepare(
        `UPDATE tasks
            SET title = ?, details = ?, assignee_membership_id = ?, due_at = ?,
                status = ?, completed_at = ?, version = version + 1,
                updated_at = ?
          WHERE organization_id = ? AND id = ? AND version = ?
            AND EXISTS (SELECT 1 FROM memberships m
                         WHERE m.organization_id = tasks.organization_id
                           AND m.id = ? AND m.status = 'active')`,
      )
      .bind(
        nextTitle,
        nextDetails,
        nextAssignee,
        nextDueAt,
        nextStatus,
        nextCompletedAt,
        now,
        scope,
        taskId,
        input.expectedVersion,
        nextAssignee,
      )
      .run();

    if (update.meta.changes !== 1) {
      // O la versión quedó obsoleta, o el responsable no está activo aquí.
      if (!(await this.#isActiveMembership(scope, nextAssignee))) {
        throw new MembershipNotActiveInOrganizationError(nextAssignee);
      }
      return null;
    }

    return this.find(scope, taskId);
  }

  /**
   * Deja constancia de quién creó o cambió una tarea. Guarda identificadores;
   * el título y el detalle no entran en la auditoría.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    taskId: string | null;
    action: "task.create" | "task.update";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "TaskRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'task', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.taskId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  #isActiveMembership(
    organizationId: string,
    membershipId: string,
  ): Promise<boolean> {
    return this.#db
      .prepare(
        `SELECT 1 AS present FROM memberships
          WHERE organization_id = ? AND id = ? AND status = 'active'`,
      )
      .bind(organizationId, membershipId)
      .first<{ present: number }>()
      .then((row) => row !== null);
  }
}
