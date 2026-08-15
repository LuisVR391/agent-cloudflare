import { canTransition, isTerminal } from "../domain/appointment-status";
import {
  AppointmentReferenceNotInOrganizationError,
  AppointmentTransitionNotAllowedError,
  MembershipNotActiveInOrganizationError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  Appointment,
  AppointmentDetail,
  AppointmentStatus,
  AppointmentTransition,
  CreateAppointmentInput,
  UpdateAppointmentInput,
} from "../domain/types";

type AppointmentRow = {
  id: string;
  organization_id: string;
  contact_id: string;
  contact_display_name: string | null;
  service_id: string;
  service_name: string | null;
  assignee_membership_id: string | null;
  assignee_name: string | null;
  conversation_id: string | null;
  opportunity_id: string | null;
  starts_at: string;
  ends_at: string;
  status: string;
  created_by_membership_id: string;
  version: number;
  created_at: string;
  updated_at: string;
};

type TransitionRow = {
  id: string;
  previous_status: string | null;
  next_status: string;
  previous_starts_at: string | null;
  previous_ends_at: string | null;
  next_starts_at: string;
  next_ends_at: string;
  actor_type: string;
  actor_id: string | null;
  correlation_id: string;
  occurred_at: string;
};

const statuses: AppointmentStatus[] = [
  "requested",
  "pending",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
];

/**
 * El contacto, el servicio y el responsable se resuelven en la misma consulta
 * que lee la cita: la agenda los muestra en cada fila y resolverlos aparte
 * produciría una consulta por cita. El servicio usa `LEFT JOIN` como el
 * responsable porque archivarlo no debe hacer desaparecer las citas que lo
 * reservaron.
 */
const appointmentSelect = `SELECT a.id, a.organization_id, a.contact_id,
    c.display_name AS contact_display_name, a.service_id, sv.name AS service_name,
    a.assignee_membership_id, u.name AS assignee_name, a.conversation_id,
    a.opportunity_id, a.starts_at, a.ends_at, a.status,
    a.created_by_membership_id, a.version, a.created_at, a.updated_at
  FROM appointments a
  LEFT JOIN contacts c
    ON c.organization_id = a.organization_id AND c.id = a.contact_id
  LEFT JOIN services sv
    ON sv.organization_id = a.organization_id AND sv.id = a.service_id
  LEFT JOIN memberships m
    ON m.organization_id = a.organization_id AND m.id = a.assignee_membership_id
  LEFT JOIN users u ON u.id = m.user_id`;

/**
 * Una columna de estado fuera del dominio indica corrupción, no una entrada del
 * usuario; la cita se degrada a `pending` en vez de romper la agenda entera.
 */
function toStatus(value: string): AppointmentStatus {
  return statuses.includes(value as AppointmentStatus)
    ? (value as AppointmentStatus)
    : "pending";
}

function toAppointment(row: AppointmentRow): Appointment {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    contactDisplayName: row.contact_display_name,
    serviceId: row.service_id,
    serviceName: row.service_name,
    assigneeMembershipId: row.assignee_membership_id,
    assigneeName: row.assignee_name,
    conversationId: row.conversation_id,
    opportunityId: row.opportunity_id,
    startsAt: row.starts_at,
    endsAt: row.ends_at,
    status: toStatus(row.status),
    createdByMembershipId: row.created_by_membership_id,
    version: row.version,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

function toTransition(row: TransitionRow): AppointmentTransition {
  return {
    id: row.id,
    previousStatus: row.previous_status === null ? null : toStatus(row.previous_status),
    nextStatus: toStatus(row.next_status),
    previousStartsAt: row.previous_starts_at,
    previousEndsAt: row.previous_ends_at,
    nextStartsAt: row.next_starts_at,
    nextEndsAt: row.next_ends_at,
    actorType: row.actor_type === "system" ? "system" : "staff",
    actorId: row.actor_id,
    correlationId: row.correlation_id,
    occurredAt: row.occurred_at,
  };
}

/**
 * Citas de la organización. Todo método recibe `organizationId` como primer
 * parámetro y lo incluye en su cláusula `WHERE`: una consulta sin organización
 * falla antes de tocar D1 (ADR-0006).
 */
export class AppointmentRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Crea la cita y su primera transición en el mismo lote. Contacto, servicio,
   * responsable y origen se comprueban dentro de la propia sentencia que
   * inserta, así que no queda ventana entre verificar y escribir.
   *
   * El `FROM services` cumple dos funciones: exige que el servicio esté activo
   * en esta organización y permite derivar el fin desde su duración cuando el
   * cliente no lo envía. El valor se persiste porque editar el catálogo después
   * no debe mover una cita ya acordada.
   */
  async create(
    organizationId: string,
    input: CreateAppointmentInput,
  ): Promise<AppointmentDetail> {
    const scope = requireOrganizationScope(
      organizationId,
      "AppointmentRepository.create",
    );
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const status = input.status ?? "pending";
    const assignee = input.assigneeMembershipId ?? null;
    const conversationId = input.conversationId ?? null;
    const opportunityId = input.opportunityId ?? null;
    const endsAt = input.endsAt ?? null;

    const [insert] = await this.#db.batch([
      this.#db
        .prepare(
          `INSERT INTO appointments
             (id, organization_id, contact_id, service_id,
              assignee_membership_id, conversation_id, opportunity_id,
              starts_at, ends_at, status, created_by_membership_id,
              created_at, updated_at)
           SELECT ?, ?, ?, sv.id, ?, ?, ?, ?,
                  COALESCE(?, strftime('%Y-%m-%dT%H:%M:%fZ', ?,
                           '+' || sv.duration_minutes || ' minutes')),
                  ?, ?, ?, ?
             FROM services sv
            WHERE sv.organization_id = ? AND sv.id = ? AND sv.status = 'active'
              AND EXISTS (SELECT 1 FROM contacts
                           WHERE organization_id = ? AND id = ?)
              AND EXISTS (SELECT 1 FROM memberships m
                           WHERE m.organization_id = ? AND m.id = ?
                             AND m.status = 'active')
              AND (? IS NULL OR EXISTS (
                    SELECT 1 FROM memberships m
                     WHERE m.organization_id = ? AND m.id = ?
                       AND m.status = 'active'))
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
          input.contactId,
          assignee,
          conversationId,
          opportunityId,
          input.startsAt,
          endsAt,
          input.startsAt,
          status,
          input.createdByMembershipId,
          now,
          now,
          scope,
          input.serviceId,
          scope,
          input.contactId,
          scope,
          input.createdByMembershipId,
          assignee,
          scope,
          assignee,
          conversationId,
          scope,
          conversationId,
          opportunityId,
          scope,
          opportunityId,
        ),
      this.#db
        .prepare(
          `INSERT INTO appointment_transitions
             (id, organization_id, appointment_id, previous_status, next_status,
              previous_starts_at, previous_ends_at, next_starts_at,
              next_ends_at, actor_type, actor_id, correlation_id, occurred_at)
           SELECT ?, ?, a.id, NULL, a.status, NULL, NULL, a.starts_at,
                  a.ends_at, 'staff', ?, ?, ?
             FROM appointments a
            WHERE a.organization_id = ? AND a.id = ?`,
        )
        .bind(
          crypto.randomUUID(),
          scope,
          input.actorId,
          input.correlationId,
          now,
          scope,
          id,
        ),
    ]);

    // Sin filas candidatas no hubo inserción: alguna referencia no vive en esta
    // organización, o la membresía dejó de estar activa. Se distingue después
    // para responder con precisión sin revelar a quién pertenece un
    // identificador ajeno.
    if (insert.meta.changes !== 1) {
      await this.#explainRejection(scope, {
        assignee,
        creator: input.createdByMembershipId,
        contactId: input.contactId,
        serviceId: input.serviceId,
        conversationId,
        opportunityId,
      });
    }

    const created = await this.findDetail(scope, id);
    if (created === null) throw new Error("APPOINTMENT_CREATION_FAILED");
    return created;
  }

  /**
   * Agenda de un rango `[from, to)`. El rango llega resuelto a UTC desde la zona
   * horaria de la organización: aquí solo se compara texto ISO, que ordena igual
   * que los instantes porque el formato es uniforme en todo el esquema.
   */
  async list(
    organizationId: string,
    filters: {
      from?: string;
      to?: string;
      assigneeMembershipId?: string;
      status?: AppointmentStatus;
      limit?: number;
    } = {},
  ): Promise<Appointment[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "AppointmentRepository.list",
    );
    const conditions = ["a.organization_id = ?"];
    const bindings: unknown[] = [scope];

    if (filters.from) {
      conditions.push("a.starts_at >= ?");
      bindings.push(filters.from);
    }
    if (filters.to) {
      // Semiabierto: una cita que empieza a la medianoche pertenece a un solo
      // día y no aparece en dos.
      conditions.push("a.starts_at < ?");
      bindings.push(filters.to);
    }
    if (filters.assigneeMembershipId) {
      conditions.push("a.assignee_membership_id = ?");
      bindings.push(filters.assigneeMembershipId);
    }
    if (filters.status) {
      conditions.push("a.status = ?");
      bindings.push(filters.status);
    }

    const { results } = await this.#db
      .prepare(
        `${appointmentSelect}
          WHERE ${conditions.join(" AND ")}
          ORDER BY a.starts_at, a.id
          LIMIT ?`,
      )
      .bind(...bindings, filters.limit ?? 100)
      .all<AppointmentRow>();

    return results.map(toAppointment);
  }

  /** Citas colgadas de un contacto, una conversación o una oportunidad. */
  async listBySubject(
    organizationId: string,
    subject: { type: "contact" | "conversation" | "opportunity"; id: string },
    options: { limit?: number } = {},
  ): Promise<Appointment[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "AppointmentRepository.listBySubject",
    );
    const column =
      subject.type === "contact"
        ? "a.contact_id"
        : subject.type === "conversation"
          ? "a.conversation_id"
          : "a.opportunity_id";

    const { results } = await this.#db
      .prepare(
        `${appointmentSelect}
          WHERE a.organization_id = ? AND ${column} = ?
          ORDER BY a.starts_at DESC, a.id DESC
          LIMIT ?`,
      )
      .bind(scope, subject.id, options.limit ?? 50)
      .all<AppointmentRow>();

    return results.map(toAppointment);
  }

  /** `null` fuera de la organización activa. */
  async find(
    organizationId: string,
    appointmentId: string,
  ): Promise<Appointment | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AppointmentRepository.find",
    );
    const row = await this.#db
      .prepare(`${appointmentSelect} WHERE a.organization_id = ? AND a.id = ?`)
      .bind(scope, appointmentId)
      .first<AppointmentRow>();

    return row === null ? null : toAppointment(row);
  }

  /** La cita con su historial completo, de la transición más reciente hacia atrás. */
  async findDetail(
    organizationId: string,
    appointmentId: string,
  ): Promise<AppointmentDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AppointmentRepository.findDetail",
    );
    const appointment = await this.find(scope, appointmentId);
    if (appointment === null) return null;

    const { results } = await this.#db
      .prepare(
        `SELECT id, previous_status, next_status, previous_starts_at,
                previous_ends_at, next_starts_at, next_ends_at, actor_type,
                actor_id, correlation_id, occurred_at
           FROM appointment_transitions
          WHERE organization_id = ? AND appointment_id = ?
          ORDER BY occurred_at DESC, id DESC`,
      )
      .bind(scope, appointmentId)
      .all<TransitionRow>();

    return { ...appointment, transitions: results.map(toTransition) };
  }

  /**
   * Actualiza con concurrencia optimista: `null` significa que la versión quedó
   * obsoleta y quien pide el cambio debe releer.
   *
   * Cambiar el horario es reprogramar y el estado lo refleja sin pedirlo, salvo
   * cuando la cita solo estaba solicitada: ahí todavía no había nada acordado
   * que mover. Mover el inicio sin decir hasta cuándo conserva la duración
   * vigente; recortarla por accidente sería peor que respetarla.
   */
  async update(
    organizationId: string,
    appointmentId: string,
    input: UpdateAppointmentInput,
  ): Promise<AppointmentDetail | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "AppointmentRepository.update",
    );
    const current = await this.find(scope, appointmentId);
    if (current === null || current.version !== input.expectedVersion) {
      return null;
    }

    const now = new Date().toISOString();
    const nextStartsAt = input.startsAt ?? current.startsAt;
    const nextEndsAt =
      input.endsAt ??
      (input.startsAt === undefined
        ? current.endsAt
        : new Date(
            Date.parse(input.startsAt) +
              (Date.parse(current.endsAt) - Date.parse(current.startsAt)),
          ).toISOString());
    const scheduleChanged =
      nextStartsAt !== current.startsAt || nextEndsAt !== current.endsAt;

    if (scheduleChanged && isTerminal(current.status)) {
      throw new AppointmentTransitionNotAllowedError(
        current.status,
        "rescheduled",
      );
    }

    const nextStatus =
      input.status ??
      (scheduleChanged && current.status !== "requested"
        ? "rescheduled"
        : current.status);

    if (!canTransition(current.status, nextStatus)) {
      throw new AppointmentTransitionNotAllowedError(current.status, nextStatus);
    }

    const nextAssignee =
      input.assigneeMembershipId === undefined
        ? current.assigneeMembershipId
        : input.assigneeMembershipId;

    // Sonda de que la fila quedó como la dejó esta operación: la versión sola no
    // basta, porque otra petición podría haber alcanzado el mismo número.
    const applied = `WHERE EXISTS (SELECT 1 FROM appointments
      WHERE organization_id = ? AND id = ? AND version = ? AND updated_at = ?)`;
    const appliedBindings = [
      scope,
      appointmentId,
      input.expectedVersion + 1,
      now,
    ];

    const statements = [
      this.#db
        .prepare(
          `UPDATE appointments
              SET starts_at = ?, ends_at = ?, status = ?,
                  assignee_membership_id = ?, version = version + 1,
                  updated_at = ?
            WHERE organization_id = ? AND id = ? AND version = ?
              AND (? IS NULL OR EXISTS (
                    SELECT 1 FROM memberships m
                     WHERE m.organization_id = appointments.organization_id
                       AND m.id = ? AND m.status = 'active'))`,
        )
        .bind(
          nextStartsAt,
          nextEndsAt,
          nextStatus,
          nextAssignee,
          now,
          scope,
          appointmentId,
          input.expectedVersion,
          nextAssignee,
          nextAssignee,
        ),
    ];

    if (scheduleChanged || nextStatus !== current.status) {
      statements.push(
        this.#db
          .prepare(
            `INSERT INTO appointment_transitions
               (id, organization_id, appointment_id, previous_status,
                next_status, previous_starts_at, previous_ends_at,
                next_starts_at, next_ends_at, actor_type, actor_id,
                correlation_id, occurred_at)
             SELECT ?, ?, ?, ?, ?, ?, ?, ?, ?, 'staff', ?, ?, ? ${applied}`,
          )
          .bind(
            crypto.randomUUID(),
            scope,
            appointmentId,
            current.status,
            nextStatus,
            current.startsAt,
            current.endsAt,
            nextStartsAt,
            nextEndsAt,
            input.actorId,
            input.correlationId,
            now,
            ...appliedBindings,
          ),
      );
    }

    const [update] = await this.#db.batch(statements);
    if (update.meta.changes !== 1) {
      // O la versión quedó obsoleta, o el responsable no está activo aquí.
      if (nextAssignee && !(await this.#isActiveMembership(scope, nextAssignee))) {
        throw new MembershipNotActiveInOrganizationError(nextAssignee);
      }
      return null;
    }

    return this.findDetail(scope, appointmentId);
  }

  /**
   * Deja constancia de quién agendó o cambió una cita. Guarda identificadores;
   * ni el contacto ni el servicio entran como texto en la auditoría.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    appointmentId: string | null;
    action: "appointment.create" | "appointment.update";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "AppointmentRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'appointment', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.appointmentId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  /**
   * Traduce «no se insertó nada» al motivo concreto. Se consulta después del
   * intento, no antes: comprobar primero abriría la ventana que la sentencia
   * única evita.
   */
  async #explainRejection(
    scope: string,
    references: {
      assignee: string | null;
      creator: string;
      contactId: string;
      serviceId: string;
      conversationId: string | null;
      opportunityId: string | null;
    },
  ): Promise<never> {
    if (
      references.assignee &&
      !(await this.#isActiveMembership(scope, references.assignee))
    ) {
      throw new MembershipNotActiveInOrganizationError(references.assignee);
    }
    if (!(await this.#isActiveMembership(scope, references.creator))) {
      throw new MembershipNotActiveInOrganizationError(references.creator);
    }
    throw new AppointmentReferenceNotInOrganizationError(references.serviceId);
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
