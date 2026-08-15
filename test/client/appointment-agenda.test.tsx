import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import {
  AppointmentAgenda,
  AppointmentSheet,
} from "../../src/client/components/appointment-agenda";
import { formatDayLabel } from "../../src/client/lib/agenda-time";
import {
  createAppointment,
  listAppointments,
  listServices,
  listSubjectAppointments,
  listTeamMembers,
  updateAppointment,
  updateOrganizationTimeZone,
  type Appointment,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listAppointments: vi.fn(),
  listSubjectAppointments: vi.fn(),
  createAppointment: vi.fn(),
  updateAppointment: vi.fn(),
  updateOrganizationTimeZone: vi.fn(),
  listServices: vi.fn(),
  listTeamMembers: vi.fn(),
}));

const TIME_ZONE = "America/Mexico_City";

// 02:00Z del 20 de septiembre es todavía el 19 en Ciudad de México: la cita que
// más claramente distingue la zona de la empresa de UTC.
const LATE_NIGHT = "2026-09-20T02:00:00.000Z";

function appointment(overrides: Partial<Appointment> = {}): Appointment {
  return {
    id: "appointment-1",
    contactId: "contact-1",
    contactDisplayName: "Lucía Cliente",
    serviceId: "service-1",
    serviceName: "Corte y peinado",
    assigneeMembershipId: "membership-1",
    assigneeName: "Paula Peluquera",
    conversationId: "conversation-1",
    opportunityId: null,
    startsAt: LATE_NIGHT,
    endsAt: "2026-09-20T02:45:00.000Z",
    status: "pending",
    createdByMembershipId: "membership-1",
    version: 1,
    createdAt: "2026-09-01T10:00:00.000Z",
    updatedAt: "2026-09-01T10:00:00.000Z",
    ...overrides,
  };
}

function agenda(appointments: Appointment[] = [appointment()]) {
  return {
    appointments,
    timeZone: TIME_ZONE,
    date: "2026-09-19",
    range: "day" as const,
    window: { from: "2026-09-19T06:00:00.000Z", to: "2026-09-20T06:00:00.000Z" },
    limit: 100,
    truncated: false,
  };
}

function renderAgenda(
  permissions = ["appointments.read", "appointments.manage", "users.read"],
) {
  return render(
    <MemoryRouter initialEntries={["/app/agenda"]}>
      <Routes>
        <Route
          element={
            <Outlet
              context={{
                user: { id: "user-1", name: "Paula", email: "paula@example.com" },
                organizations: [],
                activeOrganization: {
                  organizationId: "11111111-1111-4111-8111-111111111111",
                  organizationName: "Salón Uno",
                  organizationSlug: "salon-uno",
                  organizationTimeZone: TIME_ZONE,
                  membershipId: "membership-1",
                  role: "owner" as const,
                  permissions,
                },
                requiresOrganizationSelection: false,
              }}
            />
          }
          path="/app"
        >
          <Route element={<AppointmentAgenda />} path="agenda" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  // El reloj queda en un instante que ya es del día siguiente en UTC, para que
  // «hoy» solo coincida si se resuelve con la zona de la empresa.
  vi.useFakeTimers({
    now: Date.parse("2026-09-20T02:30:00.000Z"),
    shouldAdvanceTime: true,
  });
  vi.mocked(listAppointments).mockResolvedValue(agenda());
  vi.mocked(listSubjectAppointments).mockResolvedValue([appointment()]);
  vi.mocked(createAppointment).mockResolvedValue({
    ...appointment({ id: "appointment-2" }),
    transitions: [],
  });
  vi.mocked(updateAppointment).mockResolvedValue({
    ...appointment({ status: "confirmed", version: 2 }),
    transitions: [],
  });
  vi.mocked(updateOrganizationTimeZone).mockResolvedValue({
    id: "11111111-1111-4111-8111-111111111111",
    displayName: "Salón Uno",
    timeZone: "Europe/Madrid",
  });
  vi.mocked(listServices).mockResolvedValue([
    {
      id: "service-1",
      name: "Corte y peinado",
      durationMinutes: 45,
      priceAmountCents: null,
      priceCurrency: null,
      status: "active",
      version: 1,
      createdAt: "2026-08-01T10:00:00.000Z",
      updatedAt: "2026-08-01T10:00:00.000Z",
    },
  ]);
  vi.mocked(listTeamMembers).mockResolvedValue([
    {
      membershipId: "membership-2",
      userId: "user-2",
      name: "Rosa Recepción",
      email: "rosa@example.com",
      role: "operator",
      status: "active",
      joinedAt: "2026-08-01T10:00:00.000Z",
    },
  ]);
});

describe("agenda del panel", () => {
  it("abre en el día que vive la empresa, no en el de UTC", async () => {
    renderAgenda();

    await waitFor(() =>
      expect(listAppointments).toHaveBeenCalledWith({
        date: "2026-09-19",
        range: "day",
        assignee: "all",
      }),
    );

    // La cita de las 02:00Z pertenece al 19 local, así que cuelga de ese día y
    // no del 20. Si la agrupara en UTC, el día aparecería vacío.
    const day = await screen.findByRole("list", {
      name: `Citas del ${formatDayLabel("2026-09-19")}`,
    });
    expect(within(day).getByText(/Lucía Cliente/)).toBeInTheDocument();
    expect(screen.queryByText("Sin citas este día.")).toBeNull();
  });

  it("muestra la hora local del salón y no la del navegador", async () => {
    renderAgenda();
    const row = (await screen.findByText(/Lucía Cliente/)).closest("li");

    const local = new Date(LATE_NIGHT).toLocaleTimeString(undefined, {
      timeZone: TIME_ZONE,
      hour: "2-digit",
      minute: "2-digit",
    });
    const utc = new Date(LATE_NIGHT).toLocaleTimeString(undefined, {
      timeZone: "UTC",
      hour: "2-digit",
      minute: "2-digit",
    });

    expect(local).not.toBe(utc);
    expect(row?.textContent).toContain(local);
    expect(row?.textContent).not.toContain(utc);
  });

  it("cambia a la semana y vuelve a preguntar al backend", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAgenda();
    await screen.findByText(/Lucía Cliente/);

    await user.click(screen.getByRole("tab", { name: "Semana" }));

    await waitFor(() =>
      expect(listAppointments).toHaveBeenCalledWith({
        date: "2026-09-19",
        range: "week",
        assignee: "all",
      }),
    );
  });

  it("confirma la cita enviando la versión vigente", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAgenda();
    await screen.findByText(/Lucía Cliente/);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    await waitFor(() =>
      expect(updateAppointment).toHaveBeenCalledWith("appointment-1", {
        expectedVersion: 1,
        status: "confirmed",
      }),
    );
  });

  it("reprograma interpretando la hora escrita como la del salón", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAgenda();
    await screen.findByText(/Lucía Cliente/);

    await user.click(screen.getByRole("button", { name: "Reprogramar" }));
    const input = screen.getByLabelText("Nuevo inicio");
    await user.clear(input);
    await user.type(input, "2026-09-21T10:00");
    await user.click(screen.getByRole("button", { name: "Guardar" }));

    // Las diez de la mañana en Ciudad de México son las 16:00Z.
    await waitFor(() =>
      expect(updateAppointment).toHaveBeenCalledWith("appointment-1", {
        expectedVersion: 1,
        startsAt: "2026-09-21T16:00:00.000Z",
      }),
    );
  });

  it("muestra el conflicto de versión tal como lo explica el servidor", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    vi.mocked(updateAppointment).mockRejectedValue(
      new Error("La cita cambió; vuelve a cargarla."),
    );
    renderAgenda();
    await screen.findByText(/Lucía Cliente/);

    await user.click(screen.getByRole("button", { name: "Confirmar" }));

    expect(
      await screen.findByText("La cita cambió; vuelve a cargarla."),
    ).toBeInTheDocument();
  });

  it("no ofrece acciones sobre una cita ya cerrada", async () => {
    vi.mocked(listAppointments).mockResolvedValue(
      agenda([appointment({ status: "completed" })]),
    );
    renderAgenda();

    expect(await screen.findByText("Realizada")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Reprogramar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Cancelar" })).toBeNull();
  });

  it("sin permiso de gestión consulta pero no ofrece cambiar nada", async () => {
    renderAgenda(["appointments.read", "users.read"]);

    await screen.findByText(/Lucía Cliente/);
    expect(screen.queryByRole("button", { name: "Confirmar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Reprogramar" })).toBeNull();
  });

  it("sin permiso de lectura no pide nada al servidor", async () => {
    renderAgenda([]);

    expect(await screen.findByText("Sin acceso a la agenda")).toBeInTheDocument();
    expect(listAppointments).not.toHaveBeenCalled();
  });

  it("solo quien administra la organización ve el control de zona horaria", async () => {
    renderAgenda(["appointments.read", "appointments.manage"]);
    await screen.findByText(/Lucía Cliente/);

    expect(
      screen.queryByRole("button", {
        name: "Zona horaria de la organización",
      }),
    ).toBeNull();
  });

  it("cambia la zona horaria y relee la agenda con la nueva", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderAgenda([
      "appointments.read",
      "appointments.manage",
      "organization.manage",
    ]);
    await screen.findByText(/Lucía Cliente/);

    await user.click(
      screen.getByRole("button", { name: "Zona horaria de la organización" }),
    );
    await user.click(
      await screen.findByRole("menuitemradio", { name: "Europe/Madrid" }),
    );

    await waitFor(() =>
      expect(updateOrganizationTimeZone).toHaveBeenCalledWith("Europe/Madrid"),
    );
    // El día que la empresa vive cambia con la zona: en Madrid ya es 20.
    await waitFor(() =>
      expect(listAppointments).toHaveBeenLastCalledWith({
        date: "2026-09-20",
        range: "day",
        assignee: "all",
      }),
    );
  });
});

describe("citas desde la conversación", () => {
  it("no consulta hasta abrir el panel y agenda con el hilo como origen", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppointmentSheet
        canManage
        canReadTeam
        contactId="contact-1"
        conversationId="conversation-1"
        timeZone={TIME_ZONE}
      />,
    );

    expect(listSubjectAppointments).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Citas" }));
    expect(
      await screen.findByText("Citas de la conversación"),
    ).toBeInTheDocument();
    await waitFor(() =>
      expect(listSubjectAppointments).toHaveBeenCalledWith({
        type: "conversation",
        id: "conversation-1",
      }),
    );

    await user.click(screen.getByLabelText("Servicio"));
    await user.click(
      await screen.findByRole("menuitemradio", { name: /Corte y peinado/ }),
    );
    await user.type(screen.getByLabelText("Inicio"), "2026-09-21T10:00");
    await user.click(screen.getByRole("button", { name: "Agendar cita" }));

    await waitFor(() =>
      expect(createAppointment).toHaveBeenCalledWith({
        contactId: "contact-1",
        conversationId: "conversation-1",
        serviceId: "service-1",
        // Las diez de la mañana del salón, no las del navegador.
        startsAt: "2026-09-21T16:00:00.000Z",
        assigneeMembershipId: null,
        status: "pending",
      }),
    );
  });

  it("sin permiso de gestión lista las citas pero no ofrece agendar", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    render(
      <AppointmentSheet
        canManage={false}
        canReadTeam={false}
        contactId="contact-1"
        conversationId="conversation-1"
        timeZone={TIME_ZONE}
      />,
    );

    await user.click(screen.getByRole("button", { name: "Citas" }));
    await screen.findByText("Citas de la conversación");

    expect(listServices).not.toHaveBeenCalled();
    expect(screen.queryByRole("button", { name: "Agendar cita" })).toBeNull();
  });
});
