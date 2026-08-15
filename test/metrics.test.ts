import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  MAX_METRICS_RANGE_DAYS,
  civilDaysBetween,
  metricsRange,
} from "../src/worker/domain/time-zone";
import { MetricsRepository } from "../src/worker/repositories/metrics-repository";
import { ServiceRepository } from "../src/worker/repositories/service-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Métricas",
  organizationSlug: "salon-metricas",
  ownerName: "Ana Métrica",
  ownerEmail: "owner-metrics@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "66666666-6666-4666-8666-666666666666";

/** El periodo de todas las aserciones, en días civiles de la organización. */
const PERIOD = { from: "2026-08-01", to: "2026-08-31" };

describe("rango de métricas", () => {
  it("cuenta los días civiles con ambos extremos incluidos", () => {
    expect(civilDaysBetween("2026-08-15", "2026-08-15")).toBe(1);
    expect(civilDaysBetween("2026-08-01", "2026-08-31")).toBe(31);
    // Un rango invertido mide menos de un día, que es lo que permite
    // rechazarlo sin comparar cadenas.
    expect(civilDaysBetween("2026-08-31", "2026-08-01")).toBeLessThan(1);
  });

  it("abre y cierra el periodo donde lo vive la empresa, no donde lo vive UTC", () => {
    // El 31 de agosto entero: el fin es el inicio del día siguiente.
    expect(metricsRange("2026-08-01", "2026-08-31", "America/Mexico_City")).toEqual(
      { from: "2026-08-01T06:00:00.000Z", to: "2026-09-01T06:00:00.000Z" },
    );
    expect(metricsRange("2026-08-01", "2026-08-31", "UTC")).toEqual({
      from: "2026-08-01T00:00:00.000Z",
      to: "2026-09-01T00:00:00.000Z",
    });
  });
});

describe.sequential("métricas iniciales del proceso", () => {
  let sessionCookie: string;
  let organizationId: string;
  let ownerMembershipId: string;
  let serviceId: string;
  let stages: { id: string; name: string; pipelineId: string }[];
  let luciaId: string;

  const metrics = (query: string, correlationId = crypto.randomUUID()) =>
    fetchWorker(`/api/metrics${query}`, {
      headers: { cookie: sessionCookie, "X-Correlation-Id": correlationId },
    });

  const summary = async () => {
    const response = await metrics(`?from=${PERIOD.from}&to=${PERIOD.to}`);
    expect(response.status).toBe(200);
    return (await response.json()) as {
      timeZone: string;
      range: { from: string; to: string; days: number };
      window: { from: string; to: string };
      operations: {
        messagesReceived: number;
        activeConversations: number;
        firstResponse: {
          answered: number;
          pending: number;
          medianMinutes: number | null;
          averageMinutes: number | null;
        };
        humanInterventions: { replies: number; conversations: number };
      };
      commercial: {
        newContacts: number;
        opportunities: {
          created: number;
          withAppointment: number;
          byStage: { stageName: string; count: number }[];
        };
        appointmentsByStatus: { status: string; count: number }[];
      };
    };
  };

  beforeAll(async () => {
    const setup = await fetchWorker("/api/setup", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(setupBody),
    });
    const result = (await setup.json()) as { organization: { id: string } };
    organizationId = result.organization.id;

    const login = await fetchWorker("/api/auth/sign-in/email", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        email: setupBody.ownerEmail,
        password: setupBody.ownerPassword,
      }),
    });
    sessionCookie = cookiePair(login.headers.get("set-cookie"));

    const members = await fetchWorker("/api/team/members", {
      headers: { cookie: sessionCookie },
    });
    const { members: team } = (await members.json()) as {
      members: { membershipId: string; email: string }[];
    };
    ownerMembershipId = team.find(
      ({ email }) => email === setupBody.ownerEmail,
    )!.membershipId;

    // El pipeline inicial lo siembra la instalación; sus etapas dan la
    // distribución que se verifica más abajo.
    const { results: stageRows } = await env.DB.prepare(
      `SELECT id, name, pipeline_id FROM pipeline_stages
        WHERE organization_id = ? ORDER BY position`,
    )
      .bind(organizationId)
      .all<{ id: string; name: string; pipeline_id: string }>();
    stages = stageRows.map((row) => ({
      id: row.id,
      name: row.name,
      pipelineId: row.pipeline_id,
    }));

    serviceId = (
      await new ServiceRepository(env.DB).create(organizationId, {
        name: "Color completo",
        durationMinutes: 90,
      })
    ).id;

    const now = new Date().toISOString();
    const channelId = crypto.randomUUID();
    const conversationA = crypto.randomUUID();
    const conversationB = crypto.randomUUID();
    const foreignChannelId = crypto.randomUUID();
    const foreignConversationId = crypto.randomUUID();
    const foreignContactId = crypto.randomUUID();
    luciaId = crypto.randomUUID();
    const marcoId = crypto.randomUUID();
    const antiguoId = crypto.randomUUID();

    const contact = (id: string, name: string, createdAt: string) =>
      env.DB.prepare(
        `INSERT INTO contacts
           (id, organization_id, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, 'active', ?, ?)`,
      ).bind(id, organizationId, name, createdAt, createdAt);

    const channel = (id: string, scope: string) =>
      env.DB.prepare(
        `INSERT INTO communication_channels
           (id, organization_id, provider, adapter, external_account_id,
            status, created_at, updated_at)
         VALUES (?, ?, 'whatsapp', 'zernio', ?, 'active', ?, ?)`,
      ).bind(id, scope, `account-${id}`, now, now);

    const conversation = (id: string, scope: string, channel: string, contactId: string) =>
      env.DB.prepare(
        `INSERT INTO conversations
           (id, organization_id, channel_id, contact_id, external_conversation_id,
            last_message_at, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, scope, channel, contactId, `conversation-${id}`, now, now, now);

    const message = (
      scope: string,
      conversationId: string,
      direction: "incoming" | "outgoing",
      senderType: "customer" | "staff" | "system",
      occurredAt: string,
    ) =>
      env.DB.prepare(
        `INSERT INTO messages
           (id, organization_id, conversation_id, direction, sender_type,
            message_type, status, correlation_id, occurred_at, created_at,
            updated_at)
         VALUES (?, ?, ?, ?, ?, 'text', ?, ?, ?, ?, ?)`,
      ).bind(
        crypto.randomUUID(),
        scope,
        conversationId,
        direction,
        senderType,
        direction === "incoming" ? "received" : "sent",
        crypto.randomUUID(),
        occurredAt,
        occurredAt,
        occurredAt,
      );

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO organizations
           (id, slug, display_name, status, created_at, updated_at)
         VALUES (?, 'otro-salon-metricas', 'Otro salón', 'active', ?, ?)`,
      ).bind(otherOrganizationId, now, now),
      contact(luciaId, "Lucía Cliente", "2026-08-02T18:00:00.000Z"),
      // 31 de agosto a las 23:30 hora del salón: pertenece al periodo aunque en
      // UTC ya sea septiembre.
      contact(marcoId, "Marco Cliente", "2026-09-01T05:30:00.000Z"),
      contact(antiguoId, "Rosa Antigua", "2026-07-15T18:00:00.000Z"),
      channel(channelId, organizationId),
    ]);

    await env.DB.batch([
      env.DB.prepare(
        `INSERT INTO contacts
           (id, organization_id, display_name, status, created_at, updated_at)
         VALUES (?, ?, 'Ajena', 'active', ?, ?)`,
      ).bind(foreignContactId, otherOrganizationId, "2026-08-10T18:00:00.000Z", now),
      channel(foreignChannelId, otherOrganizationId),
      conversation(conversationA, organizationId, channelId, luciaId),
      conversation(conversationB, organizationId, channelId, marcoId),
    ]);

    await env.DB.batch([
      conversation(
        foreignConversationId,
        otherOrganizationId,
        foreignChannelId,
        foreignContactId,
      ),
      // ── Conversación A ────────────────────────────────────────────────
      // 31 de julio a las 23:00 hora del salón: fuera del periodo, pero el
      // cálculo lo mira para saber que el turno del 5 de agosto empieza limpio.
      message(organizationId, conversationA, "incoming", "customer", "2026-08-01T05:00:00.000Z"),
      message(organizationId, conversationA, "outgoing", "staff", "2026-08-01T05:30:00.000Z"),
      // Turno respondido en 10 minutos.
      message(organizationId, conversationA, "incoming", "customer", "2026-08-05T15:00:00.000Z"),
      message(organizationId, conversationA, "outgoing", "staff", "2026-08-05T15:10:00.000Z"),
      // Dos mensajes seguidos del contacto son un solo turno: se debe una
      // respuesta, no dos. Se mide desde el primero.
      message(organizationId, conversationA, "incoming", "customer", "2026-08-06T15:00:00.000Z"),
      message(organizationId, conversationA, "incoming", "customer", "2026-08-06T15:05:00.000Z"),
      message(organizationId, conversationA, "outgoing", "staff", "2026-08-06T15:20:00.000Z"),
      // Turno respondido en dos horas: mueve el promedio, no la mediana.
      message(organizationId, conversationA, "incoming", "customer", "2026-08-07T15:00:00.000Z"),
      message(organizationId, conversationA, "outgoing", "staff", "2026-08-07T17:00:00.000Z"),
      // Saliente del sistema: no es una intervención humana.
      message(organizationId, conversationA, "outgoing", "system", "2026-08-10T15:00:00.000Z"),
      // Turno sin responder.
      message(organizationId, conversationA, "incoming", "customer", "2026-08-20T15:00:00.000Z"),
      // ── Conversación B ────────────────────────────────────────────────
      // 31 de agosto a las 23:00 hora del salón.
      message(organizationId, conversationB, "incoming", "customer", "2026-09-01T05:00:00.000Z"),
      // ── Organización ajena ────────────────────────────────────────────
      message(otherOrganizationId, foreignConversationId, "incoming", "customer", "2026-08-12T15:00:00.000Z"),
      message(otherOrganizationId, foreignConversationId, "outgoing", "staff", "2026-08-12T15:05:00.000Z"),
    ]);

    const opportunity = (
      id: string,
      contactId: string,
      stageId: string,
      pipelineId: string,
      createdAt: string,
    ) =>
      env.DB.prepare(
        `INSERT INTO opportunities
           (id, organization_id, contact_id, pipeline_id, stage_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)`,
      ).bind(id, organizationId, contactId, pipelineId, stageId, createdAt, createdAt);

    const appointment = (
      id: string,
      contactId: string,
      opportunityId: string | null,
      startsAt: string,
      status: string,
    ) =>
      env.DB.prepare(
        `INSERT INTO appointments
           (id, organization_id, contact_id, service_id, opportunity_id,
            starts_at, ends_at, status, created_by_membership_id,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      ).bind(
        id,
        organizationId,
        contactId,
        serviceId,
        opportunityId,
        startsAt,
        new Date(Date.parse(startsAt) + 90 * 60 * 1000).toISOString(),
        status,
        ownerMembershipId,
        now,
        now,
      );

    const conAmarre = crypto.randomUUID();
    const sinAmarre = crypto.randomUUID();

    await env.DB.batch([
      opportunity(conAmarre, luciaId, stages[0].id, stages[0].pipelineId, "2026-08-03T18:00:00.000Z"),
      opportunity(sinAmarre, luciaId, stages[0].id, stages[0].pipelineId, "2026-08-04T18:00:00.000Z"),
      opportunity(crypto.randomUUID(), marcoId, stages[1].id, stages[1].pipelineId, "2026-08-05T18:00:00.000Z"),
      // Abierta antes del periodo: no cuenta.
      opportunity(crypto.randomUUID(), antiguoId, stages[0].id, stages[0].pipelineId, "2026-07-20T18:00:00.000Z"),
    ]);

    await env.DB.batch([
      appointment(crypto.randomUUID(), luciaId, conAmarre, "2026-08-10T18:00:00.000Z", "confirmed"),
      // Cita del mismo contacto sin enlace a la oportunidad: cuenta como cita
      // del periodo, no como conversión.
      appointment(crypto.randomUUID(), luciaId, null, "2026-08-11T18:00:00.000Z", "pending"),
      // Fuera del periodo.
      appointment(crypto.randomUUID(), marcoId, null, "2026-09-05T18:00:00.000Z", "confirmed"),
    ]);

    // La oportunidad sin cita enlazada existe para que la conversión estricta
    // pueda distinguirse de la atribución por contacto.
    expect(sinAmarre).not.toBe(conAmarre);
  });

  it("devuelve el periodo resuelto en la zona horaria de la organización", async () => {
    const body = await summary();

    expect(body.timeZone).toBe("America/Mexico_City");
    expect(body.range).toEqual({ from: "2026-08-01", to: "2026-08-31", days: 31 });
    expect(body.window).toEqual({
      from: "2026-08-01T06:00:00.000Z",
      to: "2026-09-01T06:00:00.000Z",
    });
  });

  it("cuenta la actividad del periodo sin incluir la de otra organización", async () => {
    const { operations } = await summary();

    // Seis entrantes propios: los dos de la organización ajena y el del 31 de
    // julio a las 23:00 locales quedan fuera.
    expect(operations.messagesReceived).toBe(6);
    expect(operations.activeConversations).toBe(2);
    // Tres respuestas del equipo; la saliente del sistema no es una.
    expect(operations.humanInterventions).toEqual({
      replies: 3,
      conversations: 1,
    });
  });

  it("mide la primera respuesta por turno y deja fuera los que siguen esperando", async () => {
    const { operations } = await summary();

    expect(operations.firstResponse).toEqual({
      answered: 3,
      pending: 2,
      // Esperas de 10, 20 y 120 minutos.
      medianMinutes: 20,
      averageMinutes: 50,
    });
  });

  it("distribuye las oportunidades del periodo y solo convierte las que tienen cita enlazada", async () => {
    const { commercial } = await summary();

    expect(commercial.newContacts).toBe(2);
    expect(commercial.opportunities.created).toBe(3);
    expect(commercial.opportunities.withAppointment).toBe(1);
    expect(
      commercial.opportunities.byStage.map(({ stageName, count }) => [
        stageName,
        count,
      ]),
    ).toEqual([
      [stages[0].name, 2],
      [stages[1].name, 1],
    ]);
    expect(commercial.appointmentsByStatus).toEqual([
      { status: "confirmed", count: 1 },
      { status: "pending", count: 1 },
    ]);
  });

  it("no mezcla los agregados de dos organizaciones", async () => {
    const repository = new MetricsRepository(env.DB);
    const window = metricsRange(PERIOD.from, PERIOD.to, "America/Mexico_City");

    const ajena = await repository.summary(otherOrganizationId, window);

    expect(ajena.operations.messagesReceived).toBe(1);
    expect(ajena.operations.humanInterventions.replies).toBe(1);
    expect(ajena.commercial.newContacts).toBe(1);
    expect(ajena.commercial.opportunities.created).toBe(0);
    expect(ajena.commercial.appointmentsByStatus).toEqual([]);
  });

  it("rechaza un periodo ausente, mal formado o invertido", async () => {
    for (const query of [
      "",
      "?from=2026-08-01",
      "?to=2026-08-31",
      "?from=ayer&to=hoy",
      // Existe en el formato, no en el calendario.
      "?from=2026-02-30&to=2026-03-01",
    ]) {
      const response = await metrics(query);
      expect(response.status).toBe(400);
      expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
        "INVALID_RANGE",
      );
    }

    const inverted = await metrics("?from=2026-08-31&to=2026-08-01");
    expect(inverted.status).toBe(400);
    expect(
      ((await inverted.json()) as { error: { code: string } }).error.code,
    ).toBe("INVALID_RANGE");
  });

  it("rechaza un periodo mayor al máximo declarado y acepta el máximo", async () => {
    const start = Date.UTC(2026, 4, 1);
    const day = 86_400_000;
    const civil = (offset: number) =>
      new Date(start + offset * day).toISOString().slice(0, 10);

    const tooLong = await metrics(
      `?from=${civil(0)}&to=${civil(MAX_METRICS_RANGE_DAYS)}`,
    );
    expect(tooLong.status).toBe(400);
    expect(
      ((await tooLong.json()) as { error: { code: string } }).error.code,
    ).toBe("RANGE_TOO_LONG");

    const exact = await metrics(
      `?from=${civil(0)}&to=${civil(MAX_METRICS_RANGE_DAYS - 1)}`,
    );
    expect(exact.status).toBe(200);
    expect(((await exact.json()) as { range: { days: number } }).range.days).toBe(
      MAX_METRICS_RANGE_DAYS,
    );
  });

  it("responde un periodo sin actividad con ceros, no con silencio", async () => {
    const response = await metrics("?from=2026-01-01&to=2026-01-31");
    expect(response.status).toBe(200);

    const body = (await response.json()) as {
      operations: {
        messagesReceived: number;
        firstResponse: { answered: number; medianMinutes: number | null };
      };
      commercial: {
        newContacts: number;
        opportunities: { created: number; byStage: unknown[] };
        appointmentsByStatus: unknown[];
      };
    };

    expect(body.operations.messagesReceived).toBe(0);
    expect(body.operations.firstResponse.answered).toBe(0);
    // Sin turnos respondidos no hay mediana que inventar.
    expect(body.operations.firstResponse.medianMinutes).toBeNull();
    expect(body.commercial.newContacts).toBe(0);
    expect(body.commercial.opportunities.created).toBe(0);
    expect(body.commercial.opportunities.byStage).toEqual([]);
    expect(body.commercial.appointmentsByStatus).toEqual([]);
  });

  it("concede el mismo catálogo a una organización instalada y a una migrada", async () => {
    const now = new Date().toISOString();
    const legacyId = crypto.randomUUID();
    const roleIds = {
      owner: crypto.randomUUID(),
      manager: crypto.randomUUID(),
      operator: crypto.randomUUID(),
    };
    await env.DB.prepare(
      `INSERT INTO organizations (id, slug, display_name, status, created_at, updated_at)
       VALUES (?, ?, 'Salón heredado', 'active', ?, ?)`,
    )
      .bind(legacyId, `legacy-${legacyId}`, now, now)
      .run();
    await env.DB.batch(
      Object.entries(roleIds).map(([roleKey, roleId]) =>
        env.DB.prepare(
          `INSERT INTO roles (id, organization_id, role_key, display_name, created_at, updated_at)
           VALUES (?, ?, ?, ?, ?, ?)`,
        ).bind(roleId, legacyId, roleKey, roleKey, now, now),
      ),
    );
    // Estado previo al corte: la organización tiene todo menos el permiso que
    // este corte introduce.
    await env.DB.batch(
      Object.values(roleIds).map((roleId) =>
        env.DB.prepare(
          `INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
           SELECT ?, ?, p.id, ?
             FROM permissions p
            WHERE p.permission_key NOT LIKE 'metrics.%'`,
        ).bind(legacyId, roleId, now),
      ),
    );

    // Solo las sentencias de catálogo: reaplicar el DDL fallaría porque los
    // índices ya existen, y la propagación es lo que se verifica.
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
      .TEST_MIGRATIONS;
    const migration = migrations.find(
      (item) => item.name === "0018_metrics_read_access.sql",
    );
    expect(migration).toBeDefined();
    const grants = migration!.queries.filter((query) =>
      /INSERT INTO (permissions|role_permissions)/i.test(query),
    );
    expect(grants).toHaveLength(2);
    for (const query of grants) {
      await env.DB.prepare(query).run();
    }

    const catalog = async (scope: string) => {
      const { results } = await env.DB.prepare(
        `SELECT r.role_key, p.permission_key
           FROM role_permissions rp
           JOIN roles r ON r.id = rp.role_id
           JOIN permissions p ON p.id = rp.permission_id
          WHERE rp.organization_id = ? AND p.permission_key LIKE 'metrics.%'
          ORDER BY r.role_key, p.permission_key`,
      )
        .bind(scope)
        .all<{ role_key: string; permission_key: string }>();
      return results.map((row) => `${row.role_key}:${row.permission_key}`);
    };

    expect(await catalog(legacyId)).toEqual(await catalog(organizationId));
    expect(await catalog(legacyId)).toEqual([
      "manager:metrics.read",
      "operator:metrics.read",
      "owner:metrics.read",
    ]);
  });

  // Va al final porque retira el permiso a la organización de la sesión.
  it("falla cerrado sin permiso de lectura de métricas", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'metrics.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await metrics(`?from=${PERIOD.from}&to=${PERIOD.to}`);
    expect(response.status).toBe(403);
    expect(((await response.json()) as { error: { code: string } }).error.code).toBe(
      "FORBIDDEN",
    );
  });
});
