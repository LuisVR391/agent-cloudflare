import type { D1Migration } from "cloudflare:test";
import { env, exports } from "cloudflare:workers";
import { beforeAll, describe, expect, it } from "vitest";

import {
  AppointmentReferenceNotInOrganizationError,
  AppointmentTransitionNotAllowedError,
  MembershipNotActiveInOrganizationError,
} from "../src/worker/domain/errors";
import {
  agendaRange,
  isCivilDate,
  isSupportedTimeZone,
  startOfWeek,
  zonedStartOfDay,
  zonedToday,
} from "../src/worker/domain/time-zone";
import { AppointmentRepository } from "../src/worker/repositories/appointment-repository";
import { ContactRepository } from "../src/worker/repositories/contact-repository";
import { ServiceRepository } from "../src/worker/repositories/service-repository";

const fetchWorker = (path: string, init?: RequestInit) =>
  exports.default.fetch(new Request(`https://example.com${path}`, init));

const setupBody = {
  setupToken: "test-only-setup-token",
  organizationName: "Salón de Citas",
  organizationSlug: "salon-citas",
  ownerName: "Ana Agenda",
  ownerEmail: "owner-appointments@example.com",
  ownerPassword: "correct-horse-battery-staple",
};

function cookiePair(setCookie: string | null): string {
  return (setCookie ?? "").split(";", 1)[0];
}

const otherOrganizationId = "55555555-5555-4555-8555-555555555555";

describe("zona horaria de la organización", () => {
  it("acepta identificadores IANA y rechaza lo que no describe una zona", () => {
    expect(isSupportedTimeZone("America/Mexico_City")).toBe(true);
    expect(isSupportedTimeZone("Europe/Madrid")).toBe(true);
    expect(isSupportedTimeZone("UTC")).toBe(true);
    expect(isSupportedTimeZone("Marte/Olympus")).toBe(false);
    // Un desfase no es una zona: no describe el horario de verano.
    expect(isSupportedTimeZone("+05:00")).toBe(false);
    expect(isSupportedTimeZone("")).toBe(false);
  });

  it("rechaza fechas que no existen en el calendario", () => {
    expect(isCivilDate("2026-08-15")).toBe(true);
    expect(isCivilDate("2026-02-30")).toBe(false);
    expect(isCivilDate("15-08-2026")).toBe(false);
  });

  it("empieza el día donde lo empieza la empresa, no donde lo empieza UTC", () => {
    expect(zonedStartOfDay("2026-08-15", "America/Mexico_City")).toBe(
      "2026-08-15T06:00:00.000Z",
    );
    expect(zonedStartOfDay("2026-08-15", "UTC")).toBe("2026-08-15T00:00:00.000Z");
  });

  it("sigue el horario de verano en vez de fijar un desfase", () => {
    // Madrid en agosto es UTC+2; en enero, UTC+1.
    expect(zonedStartOfDay("2026-08-15", "Europe/Madrid")).toBe(
      "2026-08-14T22:00:00.000Z",
    );
    expect(zonedStartOfDay("2026-01-15", "Europe/Madrid")).toBe(
      "2026-01-14T23:00:00.000Z",
    );
  });

  it("mide 25 horas el día en que se atrasa el reloj", () => {
    // 2026-10-25 es el domingo del cambio en la Unión Europea.
    const { from, to } = agendaRange("2026-10-25", "day", "Europe/Madrid");
    expect(from).toBe("2026-10-24T22:00:00.000Z");
    expect(to).toBe("2026-10-25T23:00:00.000Z");
    expect(Date.parse(to) - Date.parse(from)).toBe(25 * 60 * 60 * 1000);
  });

  it("abre la semana en lunes", () => {
    // 2026-08-15 es sábado.
    expect(startOfWeek("2026-08-15")).toBe("2026-08-10");
    expect(startOfWeek("2026-08-10")).toBe("2026-08-10");

    const week = agendaRange("2026-08-15", "week", "America/Mexico_City");
    expect(week.from).toBe("2026-08-10T06:00:00.000Z");
    expect(week.to).toBe("2026-08-17T06:00:00.000Z");
  });

  it("responde «hoy» con el día que vive la empresa", () => {
    // 2026-08-15T02:00Z todavía es 14 de agosto en Ciudad de México.
    const instant = new Date("2026-08-15T02:00:00.000Z");
    expect(zonedToday("America/Mexico_City", instant)).toBe("2026-08-14");
    expect(zonedToday("UTC", instant)).toBe("2026-08-15");
  });
});

describe.sequential("citas desde la conversación", () => {
  let sessionCookie: string;
  let organizationId: string;
  let ownerMembershipId: string;
  let contactId: string;
  let conversationId: string;
  let serviceId: string;
  let foreignMembershipId: string;
  let foreignServiceId: string;

  const inThirtyDays = (offsetHours: number) =>
    new Date(
      Date.UTC(2026, 8, 15, 0, 0, 0) + offsetHours * 60 * 60 * 1000,
    ).toISOString();

  const createAppointment = (
    body: Record<string, unknown>,
    correlationId = crypto.randomUUID(),
  ) =>
    fetchWorker("/api/appointments", {
      method: "POST",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify(body),
    });

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

    const now = new Date().toISOString();
    const channelId = crypto.randomUUID();
    const foreignUserId = crypto.randomUUID();
    conversationId = crypto.randomUUID();
    foreignMembershipId = crypto.randomUUID();

    const contact = await new ContactRepository(env.DB).create(organizationId, {
      displayName: "Lucía Cliente",
    });
    contactId = contact.id;

    const services = new ServiceRepository(env.DB);
    serviceId = (
      await services.create(organizationId, {
        name: "Corte y peinado",
        durationMinutes: 45,
      })
    ).id;

    await env.DB.batch([
      env.DB.prepare(`INSERT INTO organizations
        (id, slug, display_name, status, created_at, updated_at)
        VALUES (?, 'otro-salon-citas', 'Otro salón', 'active', ?, ?)`)
        .bind(otherOrganizationId, now, now),
      env.DB.prepare(`INSERT INTO users
        (id, name, email, email_verified, status, created_at, updated_at)
        VALUES (?, 'Ajena', 'ajena-appointments@example.com', 0, 'active', ?, ?)`)
        .bind(foreignUserId, now, now),
      env.DB.prepare(`INSERT INTO communication_channels
        (id, organization_id, provider, adapter, external_account_id,
         status, created_at, updated_at)
        VALUES (?, ?, 'whatsapp', 'zernio', ?, 'active', ?, ?)`)
        .bind(channelId, organizationId, `account-${channelId}`, now, now),
    ]);
    await env.DB.batch([
      env.DB.prepare(`INSERT INTO memberships
        (id, organization_id, user_id, status, created_at, updated_at)
        VALUES (?, ?, ?, 'active', ?, ?)`)
        .bind(foreignMembershipId, otherOrganizationId, foreignUserId, now, now),
      env.DB.prepare(`INSERT INTO conversations
        (id, organization_id, channel_id, contact_id, external_conversation_id,
         last_message_at, created_at, updated_at)
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)`)
        .bind(conversationId, organizationId, channelId, contactId,
          `conversation-${conversationId}`, now, now, now),
    ]);

    foreignServiceId = (
      await services.create(otherOrganizationId, {
        name: "Servicio ajeno",
        durationMinutes: 30,
      })
    ).id;
  });

  it("da a las organizaciones existentes una zona horaria explícita", async () => {
    // La organización de otro salón se insertó sin declarar `time_zone`, igual
    // que las filas anteriores a la migración.
    const row = await env.DB.prepare(
      `SELECT time_zone FROM organizations WHERE id = ?`,
    )
      .bind(otherOrganizationId)
      .first<{ time_zone: string }>();

    expect(row!.time_zone).toBe("America/Mexico_City");
  });

  it("deriva el fin de la duración del servicio y estrena el historial", async () => {
    const repository = new AppointmentRepository(env.DB);
    const created = await repository.create(organizationId, {
      contactId,
      serviceId,
      startsAt: inThirtyDays(16),
      conversationId,
      createdByMembershipId: ownerMembershipId,
      actorId: "usuario-de-prueba",
      correlationId: "correlacion-de-prueba",
    });

    expect(created).toMatchObject({
      status: "pending",
      contactDisplayName: "Lucía Cliente",
      serviceName: "Corte y peinado",
      assigneeMembershipId: null,
      conversationId,
      version: 1,
    });
    // 45 minutos de servicio, no una duración inventada por el cliente.
    expect(Date.parse(created.endsAt) - Date.parse(created.startsAt)).toBe(
      45 * 60 * 1000,
    );
    expect(created.transitions).toHaveLength(1);
    expect(created.transitions[0]).toMatchObject({
      previousStatus: null,
      nextStatus: "pending",
      correlationId: "correlacion-de-prueba",
    });
  });

  it("recorre confirmar, reprogramar y realizar dejando cada paso", async () => {
    const repository = new AppointmentRepository(env.DB);
    const created = await repository.create(organizationId, {
      contactId,
      serviceId,
      startsAt: inThirtyDays(18),
      createdByMembershipId: ownerMembershipId,
      actorId: "usuario-de-prueba",
      correlationId: crypto.randomUUID(),
    });

    const confirmed = await repository.update(organizationId, created.id, {
      expectedVersion: created.version,
      status: "confirmed",
      actorId: "usuario-de-prueba",
      correlationId: crypto.randomUUID(),
    });
    expect(confirmed).toMatchObject({ status: "confirmed", version: 2 });

    // Mover el inicio sin decir hasta cuándo conserva la duración acordada, y
    // el estado refleja que la cita se movió.
    const moved = await repository.update(organizationId, created.id, {
      expectedVersion: confirmed!.version,
      startsAt: inThirtyDays(20),
      actorId: "usuario-de-prueba",
      correlationId: crypto.randomUUID(),
    });
    expect(moved).toMatchObject({ status: "rescheduled" });
    expect(Date.parse(moved!.endsAt) - Date.parse(moved!.startsAt)).toBe(
      45 * 60 * 1000,
    );

    const done = await repository.update(organizationId, created.id, {
      expectedVersion: moved!.version,
      status: "completed",
      actorId: "usuario-de-prueba",
      correlationId: crypto.randomUUID(),
    });
    expect(done!.status).toBe("completed");
    // Creación, confirmación, reprogramación y cierre: cuatro hechos.
    expect(done!.transitions).toHaveLength(4);
    const reschedule = done!.transitions.find(
      (transition) => transition.nextStatus === "rescheduled",
    );
    expect(reschedule).toMatchObject({
      previousStartsAt: created.startsAt,
      nextStartsAt: inThirtyDays(20),
    });
  });

  it("rechaza una transición que el ciclo de vida no declara", async () => {
    const repository = new AppointmentRepository(env.DB);
    const created = await repository.create(organizationId, {
      contactId,
      serviceId,
      startsAt: inThirtyDays(22),
      status: "requested",
      createdByMembershipId: ownerMembershipId,
      actorId: "usuario-de-prueba",
      correlationId: crypto.randomUUID(),
    });

    // Una cita solo solicitada no se realiza: primero se agenda.
    await expect(
      repository.update(organizationId, created.id, {
        expectedVersion: created.version,
        status: "completed",
        actorId: "usuario-de-prueba",
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AppointmentTransitionNotAllowedError);

    const cancelled = await repository.update(organizationId, created.id, {
      expectedVersion: created.version,
      status: "cancelled",
      actorId: "usuario-de-prueba",
      correlationId: crypto.randomUUID(),
    });
    expect(cancelled!.status).toBe("cancelled");

    // Y una cancelada tampoco se reprograma: corregirla es agendar de nuevo.
    await expect(
      repository.update(organizationId, created.id, {
        expectedVersion: cancelled!.version,
        startsAt: inThirtyDays(23),
        actorId: "usuario-de-prueba",
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AppointmentTransitionNotAllowedError);
  });

  it("no acepta el servicio, el contacto ni el responsable de otra organización", async () => {
    const repository = new AppointmentRepository(env.DB);

    await expect(
      repository.create(organizationId, {
        contactId,
        serviceId: foreignServiceId,
        startsAt: inThirtyDays(10),
        createdByMembershipId: ownerMembershipId,
        actorId: "usuario-de-prueba",
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AppointmentReferenceNotInOrganizationError);

    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Cliente ajena" },
    );
    await expect(
      repository.create(organizationId, {
        contactId: foreignContact.id,
        serviceId,
        startsAt: inThirtyDays(10),
        createdByMembershipId: ownerMembershipId,
        actorId: "usuario-de-prueba",
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(AppointmentReferenceNotInOrganizationError);

    await expect(
      repository.create(organizationId, {
        contactId,
        serviceId,
        startsAt: inThirtyDays(10),
        assigneeMembershipId: foreignMembershipId,
        createdByMembershipId: ownerMembershipId,
        actorId: "usuario-de-prueba",
        correlationId: crypto.randomUUID(),
      }),
    ).rejects.toBeInstanceOf(MembershipNotActiveInOrganizationError);

    const { results } = await env.DB.prepare(
      `SELECT id FROM appointments WHERE organization_id = ? AND contact_id = ?`,
    )
      .bind(organizationId, foreignContact.id)
      .all<{ id: string }>();
    expect(results).toEqual([]);
  });

  it("no expone ni cambia la cita de otra organización", async () => {
    const repository = new AppointmentRepository(env.DB);
    const foreignContact = await new ContactRepository(env.DB).create(
      otherOrganizationId,
      { displayName: "Cliente del otro salón" },
    );
    const foreign = await repository.create(otherOrganizationId, {
      contactId: foreignContact.id,
      serviceId: foreignServiceId,
      startsAt: inThirtyDays(12),
      createdByMembershipId: foreignMembershipId,
      actorId: "usuario-ajeno",
      correlationId: crypto.randomUUID(),
    });

    await expect(repository.find(organizationId, foreign.id)).resolves.toBeNull();
    await expect(
      repository.update(organizationId, foreign.id, {
        expectedVersion: foreign.version,
        status: "confirmed",
        actorId: "usuario-de-prueba",
        correlationId: crypto.randomUUID(),
      }),
    ).resolves.toBeNull();

    const response = await fetchWorker(`/api/appointments/${foreign.id}`, {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(404);
  });

  it("agrupa la agenda por el día de la empresa y no por el de UTC", async () => {
    const repository = new AppointmentRepository(env.DB);
    // 2026-09-20T02:00Z es todavía el 19 de septiembre en Ciudad de México.
    const lateNight = await repository.create(organizationId, {
      contactId,
      serviceId,
      startsAt: "2026-09-20T02:00:00.000Z",
      createdByMembershipId: ownerMembershipId,
      actorId: "usuario-de-prueba",
      correlationId: crypto.randomUUID(),
    });

    const local = await fetchWorker(
      "/api/appointments?date=2026-09-19&range=day",
      { headers: { cookie: sessionCookie } },
    );
    expect(local.status).toBe(200);
    const localAgenda = (await local.json()) as {
      appointments: Array<{ id: string }>;
      timeZone: string;
      window: { from: string; to: string };
    };
    expect(localAgenda.timeZone).toBe("America/Mexico_City");
    expect(localAgenda.window).toEqual({
      from: "2026-09-19T06:00:00.000Z",
      to: "2026-09-20T06:00:00.000Z",
    });
    expect(localAgenda.appointments.map((item) => item.id)).toContain(
      lateNight.id,
    );

    // El día 20 en UTC la contendría; el día 20 local, no.
    const nextDay = await fetchWorker(
      "/api/appointments?date=2026-09-20&range=day",
      { headers: { cookie: sessionCookie } },
    );
    const nextAgenda = (await nextDay.json()) as {
      appointments: Array<{ id: string }>;
    };
    expect(nextAgenda.appointments.map((item) => item.id)).not.toContain(
      lateNight.id,
    );

    // La semana que contiene ese día sí la muestra.
    const week = await fetchWorker(
      "/api/appointments?date=2026-09-19&range=week",
      { headers: { cookie: sessionCookie } },
    );
    const weekAgenda = (await week.json()) as {
      appointments: Array<{ id: string }>;
      window: { from: string; to: string };
    };
    expect(weekAgenda.window.from).toBe("2026-09-14T06:00:00.000Z");
    expect(weekAgenda.appointments.map((item) => item.id)).toContain(
      lateNight.id,
    );
  });

  it("agenda desde la conversación, confirma y deja constancia", async () => {
    const correlationId = crypto.randomUUID();
    const created = await createAppointment(
      {
        contactId,
        serviceId,
        startsAt: "2026-09-25T17:00:00.000Z",
        assigneeMembershipId: ownerMembershipId,
        conversationId,
      },
      correlationId,
    );
    expect(created.status).toBe(201);
    const { appointment } = (await created.json()) as {
      appointment: { id: string; version: number; assigneeName: string | null };
    };
    expect(appointment.assigneeName).toBe(setupBody.ownerName);

    const fromConversation = await fetchWorker(
      `/api/appointments?subjectType=conversation&subjectId=${conversationId}`,
      { headers: { cookie: sessionCookie } },
    );
    const listed = (await fromConversation.json()) as {
      appointments: Array<{ id: string }>;
    };
    expect(listed.appointments.map((item) => item.id)).toContain(appointment.id);

    const confirmed = await fetchWorker(`/api/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: appointment.version,
        status: "confirmed",
      }),
    });
    expect(confirmed.status).toBe(200);
    await expect(confirmed.json()).resolves.toMatchObject({
      appointment: { status: "confirmed", version: appointment.version + 1 },
    });

    const audit = await env.DB.prepare(
      `SELECT action, resource_id, result FROM audit_logs
        WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; resource_id: string; result: string }>();
    expect(audit).toEqual({
      action: "appointment.create",
      resource_id: appointment.id,
      result: "allowed",
    });
  });

  it("conserva la versión vigente al reprogramar dos veces", async () => {
    const created = await createAppointment({
      contactId,
      serviceId,
      startsAt: "2026-09-26T17:00:00.000Z",
    });
    const { appointment } = (await created.json()) as {
      appointment: { id: string; version: number; startsAt: string };
    };

    const first = await fetchWorker(`/api/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: appointment.version,
        startsAt: "2026-09-26T19:00:00.000Z",
      }),
    });
    expect(first.status).toBe(200);

    const stale = await fetchWorker(`/api/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: appointment.version,
        startsAt: "2026-09-26T21:00:00.000Z",
      }),
    });
    expect(stale.status).toBe(409);
    await expect(stale.json()).resolves.toMatchObject({
      error: { code: "APPOINTMENT_VERSION_CONFLICT" },
    });

    const current = await fetchWorker(`/api/appointments/${appointment.id}`, {
      headers: { cookie: sessionCookie },
    });
    const { appointment: latest } = (await current.json()) as {
      appointment: { startsAt: string };
    };
    expect(latest.startsAt).toBe("2026-09-26T19:00:00.000Z");
  });

  it("falla cerrado ante entrada inválida, sesión ausente y transición prohibida", async () => {
    await expect(
      fetchWorker("/api/appointments").then((r) => r.status),
    ).resolves.toBe(401);

    const backwards = await createAppointment({
      contactId,
      serviceId,
      startsAt: "2026-09-27T18:00:00.000Z",
      endsAt: "2026-09-27T17:00:00.000Z",
    });
    expect(backwards.status).toBe(400);

    const badInstant = await createAppointment({
      contactId,
      serviceId,
      startsAt: "el jueves",
    });
    expect(badInstant.status).toBe(400);

    await expect(
      fetchWorker("/api/appointments?date=2026-13-01", {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(400);

    await expect(
      fetchWorker("/api/appointments?range=mes", {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(400);

    await expect(
      fetchWorker(`/api/appointments/${crypto.randomUUID()}`, {
        headers: { cookie: sessionCookie },
      }).then((r) => r.status),
    ).resolves.toBe(404);

    const created = await createAppointment({
      contactId,
      serviceId,
      startsAt: "2026-09-28T17:00:00.000Z",
      status: "requested",
    });
    const { appointment } = (await created.json()) as {
      appointment: { id: string; version: number };
    };
    const forbidden = await fetchWorker(`/api/appointments/${appointment.id}`, {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({
        expectedVersion: appointment.version,
        status: "no_show",
      }),
    });
    expect(forbidden.status).toBe(409);
    await expect(forbidden.json()).resolves.toMatchObject({
      error: { code: "APPOINTMENT_TRANSITION_NOT_ALLOWED" },
    });
  });

  it("cambia la zona horaria solo con permiso y solo si existe", async () => {
    const invalid = await fetchWorker("/api/organization", {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone: "Marte/Olympus" }),
    });
    expect(invalid.status).toBe(400);
    await expect(invalid.json()).resolves.toMatchObject({
      error: { code: "INVALID_TIME_ZONE" },
    });

    const updated = await fetchWorker("/api/organization", {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone: "Europe/Madrid" }),
    });
    expect(updated.status).toBe(200);
    await expect(updated.json()).resolves.toMatchObject({
      organization: { timeZone: "Europe/Madrid" },
    });

    // El contexto de la sesión la refleja: la agenda del panel la necesita en
    // cada carga.
    const context = await fetchWorker("/api/context", {
      headers: { cookie: sessionCookie },
    });
    await expect(context.json()).resolves.toMatchObject({
      activeOrganization: { organizationTimeZone: "Europe/Madrid" },
    });

    // Y el rango de la agenda pasa a interpretarse con la zona nueva.
    const agenda = await fetchWorker("/api/appointments?date=2026-09-19", {
      headers: { cookie: sessionCookie },
    });
    await expect(agenda.json()).resolves.toMatchObject({
      timeZone: "Europe/Madrid",
      window: { from: "2026-09-18T22:00:00.000Z" },
    });

    await fetchWorker("/api/organization", {
      method: "PATCH",
      headers: { cookie: sessionCookie, "Content-Type": "application/json" },
      body: JSON.stringify({ timeZone: "America/Mexico_City" }),
    });

    // Sin `organization.manage` el cambio se rechaza y queda auditado.
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'organization.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();
    const forbidden = await fetchWorker("/api/organization", {
      method: "PATCH",
      headers: {
        cookie: sessionCookie,
        "Content-Type": "application/json",
        "X-Correlation-Id": correlationId,
      },
      body: JSON.stringify({ timeZone: "UTC" }),
    });
    expect(forbidden.status).toBe(403);

    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; result: string }>();
    expect(audit).toEqual({ action: "organization.update", result: "rejected" });
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
    // Estado previo al corte: la organización tiene todo menos los permisos
    // que este corte introduce.
    await env.DB.batch(
      Object.values(roleIds).map((roleId) =>
        env.DB.prepare(
          `INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
           SELECT ?, ?, p.id, ?
             FROM permissions p
            WHERE p.permission_key NOT LIKE 'appointments.%'`,
        ).bind(legacyId, roleId, now),
      ),
    );

    // Solo las sentencias de catálogo: reaplicar el DDL fallaría porque las
    // tablas ya existen, y la propagación es lo que se verifica.
    const migrations = (env as unknown as { TEST_MIGRATIONS: D1Migration[] })
      .TEST_MIGRATIONS;
    const migration = migrations.find(
      (item) => item.name === "0017_appointments_and_time_zone.sql",
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
          WHERE rp.organization_id = ? AND p.permission_key LIKE 'appointments.%'
          ORDER BY r.role_key, p.permission_key`,
      )
        .bind(scope)
        .all<{ role_key: string; permission_key: string }>();
      return results.map((row) => `${row.role_key}:${row.permission_key}`);
    };

    expect(await catalog(legacyId)).toEqual(await catalog(organizationId));
    expect(await catalog(legacyId)).toEqual([
      "manager:appointments.manage",
      "manager:appointments.read",
      "operator:appointments.manage",
      "operator:appointments.read",
      "owner:appointments.manage",
      "owner:appointments.read",
    ]);
  });

  it("audita el rechazo sin permiso de gestión y conserva la lectura", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'appointments.manage'
          )`,
    )
      .bind(organizationId)
      .run();
    const correlationId = crypto.randomUUID();

    const response = await createAppointment(
      { contactId, serviceId, startsAt: "2026-09-29T17:00:00.000Z" },
      correlationId,
    );
    expect(response.status).toBe(403);

    const audit = await env.DB.prepare(
      `SELECT action, result FROM audit_logs WHERE correlation_id = ?`,
    )
      .bind(correlationId)
      .first<{ action: string; result: string }>();
    expect(audit).toEqual({
      action: "appointment.create",
      result: "rejected",
    });

    const listed = await fetchWorker("/api/appointments", {
      headers: { cookie: sessionCookie },
    });
    expect(listed.status).toBe(200);
  });

  it("rechaza la consulta sin el permiso de agenda", async () => {
    await env.DB.prepare(
      `DELETE FROM role_permissions
        WHERE organization_id = ?
          AND permission_id IN (
            SELECT id FROM permissions WHERE permission_key = 'appointments.read'
          )`,
    )
      .bind(organizationId)
      .run();

    const response = await fetchWorker("/api/appointments", {
      headers: { cookie: sessionCookie },
    });
    expect(response.status).toBe(403);
    await expect(response.json()).resolves.toMatchObject({
      error: { code: "FORBIDDEN" },
    });
  });
});
