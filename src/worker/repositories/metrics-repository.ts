import { requireOrganizationScope } from "../domain/errors";
import type {
  AppointmentStatus,
  AppointmentStatusCount,
  MetricsSummary,
  MetricsWindow,
  OpportunityStageCount,
} from "../domain/types";

/**
 * Margen con el que se mira fuera del periodo al medir la primera respuesta.
 *
 * Hace falta por los dos extremos. Hacia atrás, para saber si el primer mensaje
 * del periodo continuaba una espera que ya venía abierta. Hacia adelante, para
 * encontrar la respuesta de un turno que se abrió justo antes del cierre.
 *
 * Es un día, y no ilimitado, porque el rango acotado es el control de costo de
 * un cálculo derivado (ADR-0012). La consecuencia se documenta: un turno cuya
 * respuesta llega más de un día después del cierre se cuenta como pendiente.
 */
const RESPONSE_GRACE_MS = 24 * 60 * 60 * 1000;

type ActivityRow = {
  messages_received: number;
  active_conversations: number;
  staff_replies: number;
  attended_conversations: number;
};

type FirstResponseRow = {
  answered: number;
  pending: number;
  average_minutes: number | null;
  median_minutes: number | null;
};

type StageRow = {
  stage_id: string;
  stage_name: string;
  position: number;
  pipeline_id: string;
  pipeline_name: string;
  total: number;
  with_appointment: number;
};

type StatusRow = { status: string; total: number };

const appointmentStatuses: AppointmentStatus[] = [
  "requested",
  "pending",
  "confirmed",
  "rescheduled",
  "cancelled",
  "completed",
  "no_show",
];

function shift(instant: string, milliseconds: number): string {
  return new Date(Date.parse(instant) + milliseconds).toISOString();
}

/**
 * Métricas del proceso, derivadas por consulta sobre D1 en el momento en que se
 * piden ([ADR-0012](../../../.docs/decisions/ADR-0012-initial-metrics.md)). No
 * hay tabla de agregados, columna contador ni proyección materializada: cada
 * cifra es una lectura del historial que ya tiene dueño.
 *
 * Todo método recibe `organizationId` como primer parámetro y lo incluye en su
 * cláusula `WHERE`; una consulta sin organización falla antes de tocar D1
 * (ADR-0006). Los resultados son agregados: conteos, promedios y
 * distribuciones, nunca contenido de mensajes ni datos personales.
 */
export class MetricsRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Resumen operativo y comercial del periodo. El rango llega resuelto a UTC
   * desde la zona horaria de la organización, así que aquí solo se compara
   * texto ISO, que ordena igual que los instantes porque el formato es uniforme
   * en todo el esquema.
   *
   * Las cinco consultas viajan en un solo `batch`: son independientes entre sí
   * y encadenarlas multiplicaría la latencia por cinco sin ganar nada.
   */
  async summary(
    organizationId: string,
    window: MetricsWindow,
  ): Promise<MetricsSummary> {
    const scope = requireOrganizationScope(
      organizationId,
      "MetricsRepository.summary",
    );
    const { from, to } = window;

    const [activity, firstResponse, contacts, stages, appointments] =
      await this.#db.batch([
        // Mensajes recibidos, conversaciones con actividad y respuestas del
        // equipo salen de la misma exploración del periodo.
        this.#db
          .prepare(
            `SELECT
               COALESCE(SUM(CASE WHEN direction = 'incoming' THEN 1 ELSE 0 END), 0)
                 AS messages_received,
               COUNT(DISTINCT conversation_id) AS active_conversations,
               COALESCE(SUM(CASE WHEN direction = 'outgoing' AND sender_type = 'staff'
                                 THEN 1 ELSE 0 END), 0) AS staff_replies,
               COUNT(DISTINCT CASE WHEN direction = 'outgoing' AND sender_type = 'staff'
                                   THEN conversation_id END) AS attended_conversations
             FROM messages
            WHERE organization_id = ? AND occurred_at >= ? AND occurred_at < ?`,
          )
          .bind(scope, from, to),

        this.#firstResponseStatement(scope, window),

        this.#db
          .prepare(
            `SELECT COUNT(*) AS total FROM contacts
              WHERE organization_id = ? AND created_at >= ? AND created_at < ?`,
          )
          .bind(scope, from, to),

        // La distribución por etapa y la conversión a cita se responden juntas:
        // ambas parten de las oportunidades abiertas en el periodo, y separarlas
        // recorrería dos veces las mismas filas.
        this.#db
          .prepare(
            `SELECT s.id AS stage_id, s.name AS stage_name, s.position,
                    p.id AS pipeline_id, p.name AS pipeline_name,
                    COUNT(*) AS total,
                    COALESCE(SUM(CASE WHEN EXISTS (
                      SELECT 1 FROM appointments a
                       WHERE a.organization_id = o.organization_id
                         AND a.opportunity_id = o.id) THEN 1 ELSE 0 END), 0)
                      AS with_appointment
               FROM opportunities o
               JOIN pipeline_stages s
                 ON s.organization_id = o.organization_id AND s.id = o.stage_id
               JOIN pipelines p
                 ON p.organization_id = o.organization_id AND p.id = o.pipeline_id
              WHERE o.organization_id = ? AND o.created_at >= ? AND o.created_at < ?
              GROUP BY s.id, s.name, s.position, p.id, p.name
              ORDER BY p.name, s.position, s.name`,
          )
          .bind(scope, from, to),

        // Las citas del periodo son las que ocurren en él, no las que se
        // registraron: la agenda de un salón se mide por cuándo se atiende.
        this.#db
          .prepare(
            `SELECT status, COUNT(*) AS total FROM appointments
              WHERE organization_id = ? AND starts_at >= ? AND starts_at < ?
              GROUP BY status
              ORDER BY status`,
          )
          .bind(scope, from, to),
      ]);

    const activityRow = (activity.results as ActivityRow[])[0];
    const responseRow = (firstResponse.results as FirstResponseRow[])[0];
    const contactsRow = (contacts.results as { total: number }[])[0];
    const stageRows = stages.results as StageRow[];
    const statusRows = appointments.results as StatusRow[];

    const byStage: OpportunityStageCount[] = stageRows.map((row) => ({
      stageId: row.stage_id,
      stageName: row.stage_name,
      position: row.position,
      pipelineId: row.pipeline_id,
      pipelineName: row.pipeline_name,
      count: row.total,
    }));

    const appointmentsByStatus: AppointmentStatusCount[] = statusRows
      // Un estado fuera del dominio indica corrupción, no una entrada de
      // usuario: se descarta de la distribución en vez de inventar una
      // categoría que el panel no sabría nombrar.
      .filter((row) => appointmentStatuses.includes(row.status as AppointmentStatus))
      .map((row) => ({ status: row.status as AppointmentStatus, count: row.total }));

    return {
      operations: {
        messagesReceived: activityRow.messages_received,
        activeConversations: activityRow.active_conversations,
        firstResponse: {
          answered: responseRow.answered,
          pending: responseRow.pending,
          medianMinutes: responseRow.median_minutes,
          averageMinutes: responseRow.average_minutes,
        },
        humanInterventions: {
          replies: activityRow.staff_replies,
          conversations: activityRow.attended_conversations,
        },
      },
      commercial: {
        newContacts: contactsRow.total,
        opportunities: {
          created: stageRows.reduce((total, row) => total + row.total, 0),
          withAppointment: stageRows.reduce(
            (total, row) => total + row.with_appointment,
            0,
          ),
          byStage,
        },
        appointmentsByStatus,
      },
    };
  }

  /**
   * Tiempo de primera respuesta.
   *
   * Un turno es un mensaje entrante que abre una espera: el anterior de esa
   * conversación no fue entrante. Dos mensajes seguidos del contacto son un
   * solo turno, porque quien atiende solo debe una respuesta.
   *
   * `LAG` identifica el turno y el `MIN` sobre las filas siguientes encuentra la
   * respuesta, ambos dentro de la conversación. Resolverlo en SQL evita traer
   * el historial al Worker para contarlo, que es justo lo que el mínimo
   * privilegio prohíbe.
   *
   * La mediana es la cifra que el panel destaca: un promedio se distorsiona con
   * un solo mensaje contestado a la mañana siguiente.
   */
  #firstResponseStatement(scope: string, window: MetricsWindow) {
    const scanFrom = shift(window.from, -RESPONSE_GRACE_MS);
    const scanTo = shift(window.to, RESPONSE_GRACE_MS);

    return this.#db
      .prepare(
        `WITH scanned AS (
           SELECT conversation_id, direction, occurred_at,
                  LAG(direction) OVER (
                    PARTITION BY conversation_id ORDER BY occurred_at, id
                  ) AS previous_direction,
                  MIN(CASE WHEN direction = 'outgoing' THEN occurred_at END) OVER (
                    PARTITION BY conversation_id ORDER BY occurred_at, id
                    ROWS BETWEEN CURRENT ROW AND UNBOUNDED FOLLOWING
                  ) AS answered_at
             FROM messages
            WHERE organization_id = ? AND occurred_at >= ? AND occurred_at < ?
         ),
         turns AS (
           SELECT occurred_at, answered_at
             FROM scanned
            WHERE direction = 'incoming'
              AND (previous_direction IS NULL OR previous_direction <> 'incoming')
              AND occurred_at >= ? AND occurred_at < ?
         ),
         answered AS (
           SELECT ROUND((julianday(answered_at) - julianday(occurred_at)) * 1440, 1)
                    AS minutes
             FROM turns
            WHERE answered_at IS NOT NULL
         ),
         ranked AS (
           SELECT minutes,
                  ROW_NUMBER() OVER (ORDER BY minutes) AS rn,
                  COUNT(*) OVER () AS total
             FROM answered
         )
         SELECT
           (SELECT COUNT(*) FROM answered) AS answered,
           (SELECT COUNT(*) FROM turns WHERE answered_at IS NULL) AS pending,
           (SELECT ROUND(AVG(minutes), 1) FROM answered) AS average_minutes,
           -- Con un número par de turnos la mediana promedia los dos centrales;
           -- con impar, las dos expresiones señalan la misma fila.
           (SELECT ROUND(AVG(minutes), 1) FROM ranked
             WHERE rn IN ((total + 1) / 2, (total + 2) / 2)) AS median_minutes`,
      )
      .bind(scope, scanFrom, scanTo, window.from, window.to);
  }
}
