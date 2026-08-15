import { cleanup, render, screen, waitFor, within } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PanelOverview } from "../../src/client/components/panel-overview";
import {
  getMetricsSummary,
  type MetricsSummary,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  getMetricsSummary: vi.fn(),
}));

const TIME_ZONE = "America/Mexico_City";

function summary(overrides: Partial<MetricsSummary> = {}): MetricsSummary {
  return {
    timeZone: TIME_ZONE,
    range: { from: "2026-08-21", to: "2026-09-19", days: 30 },
    window: {
      from: "2026-08-21T06:00:00.000Z",
      to: "2026-09-20T06:00:00.000Z",
    },
    operations: {
      messagesReceived: 128,
      activeConversations: 24,
      firstResponse: {
        answered: 21,
        pending: 3,
        medianMinutes: 7,
        averageMinutes: 95,
      },
      humanInterventions: { replies: 96, conversations: 22 },
    },
    commercial: {
      newContacts: 15,
      opportunities: {
        created: 12,
        withAppointment: 3,
        byStage: [
          {
            stageId: "stage-1",
            stageName: "Interesada",
            position: 1,
            pipelineId: "pipeline-1",
            pipelineName: "Ventas",
            count: 8,
          },
          {
            stageId: "stage-2",
            stageName: "Cierre",
            position: 2,
            pipelineId: "pipeline-1",
            pipelineName: "Ventas",
            count: 4,
          },
        ],
      },
      appointmentsByStatus: [
        { status: "confirmed", count: 9 },
        { status: "no_show", count: 1 },
      ],
    },
    ...overrides,
  };
}

const emptySummary = summary({
  operations: {
    messagesReceived: 0,
    activeConversations: 0,
    firstResponse: {
      answered: 0,
      pending: 0,
      medianMinutes: null,
      averageMinutes: null,
    },
    humanInterventions: { replies: 0, conversations: 0 },
  },
  commercial: {
    newContacts: 0,
    opportunities: { created: 0, withAppointment: 0, byStage: [] },
    appointmentsByStatus: [],
  },
});

function renderOverview(permissions = ["panel.read", "metrics.read"]) {
  return render(
    <MemoryRouter initialEntries={["/app"]}>
      <Routes>
        <Route
          element={
            <Outlet
              context={{
                user: { id: "user-1", name: "Ana Propietaria", email: "ana@example.com" },
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
          <Route element={<PanelOverview />} index />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

/** Cifra de una tarjeta, buscada por su etiqueta para no depender del orden. */
function metricValue(label: string): string {
  const card = screen.getByText(label).closest("[data-slot='card']");
  return within(card as HTMLElement).getByText(/^[\d.,]+( %| min| h.*)?$|^—$/)
    .textContent!;
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

beforeEach(() => {
  vi.clearAllMocks();
  // 02:30Z del 20 de septiembre es todavía el 19 en Ciudad de México: el
  // periodo por defecto solo coincide si se calcula con la zona de la empresa.
  vi.useFakeTimers({
    now: Date.parse("2026-09-20T02:30:00.000Z"),
    shouldAdvanceTime: true,
  });
  vi.mocked(getMetricsSummary).mockResolvedValue(summary());
});

describe("resumen del panel", () => {
  it("consulta los últimos treinta días de la empresa y muestra sus cifras", async () => {
    renderOverview();

    await waitFor(() =>
      expect(getMetricsSummary).toHaveBeenCalledWith({
        from: "2026-08-21",
        to: "2026-09-19",
      }),
    );

    expect(await screen.findByText("Mensajes recibidos")).toBeInTheDocument();
    expect(metricValue("Mensajes recibidos")).toBe("128");
    expect(metricValue("Conversaciones activas")).toBe("24");
    // La mediana, no el promedio: una respuesta a la mañana siguiente no debe
    // describir el día entero.
    expect(metricValue("Primera respuesta")).toBe("7 min");
    expect(metricValue("Intervenciones humanas")).toBe("96");
    expect(metricValue("Contactos nuevos")).toBe("15");
    expect(metricValue("Conversión a cita")).toBe("25 %");
    expect(
      screen.getByText("3 de 12 llegaron a una cita."),
    ).toBeInTheDocument();
  });

  it("distribuye las oportunidades por etapa y las citas por estado", async () => {
    renderOverview();

    const stages = await screen.findByText("Oportunidades por etapa");
    const stageCard = stages.closest("[data-slot='card']") as HTMLElement;
    expect(within(stageCard).getByText("Interesada · Ventas")).toBeInTheDocument();
    expect(within(stageCard).getByText("8")).toBeInTheDocument();

    const statuses = screen.getByText("Citas por estado");
    const statusCard = statuses.closest("[data-slot='card']") as HTMLElement;
    // El estado se nombra como en la agenda, no con la clave del esquema.
    expect(within(statusCard).getByText("Confirmada")).toBeInTheDocument();
    expect(within(statusCard).getByText("No asistió")).toBeInTheDocument();
  });

  it("vuelve a consultar al cambiar de preset y al elegir fechas", async () => {
    const user = userEvent.setup({ advanceTimers: vi.advanceTimersByTime });
    renderOverview();
    await screen.findByText("Mensajes recibidos");

    await user.click(screen.getByRole("tab", { name: "7 días" }));
    await waitFor(() =>
      expect(getMetricsSummary).toHaveBeenLastCalledWith({
        from: "2026-09-13",
        to: "2026-09-19",
      }),
    );

    await user.click(screen.getByRole("tab", { name: "Elegir" }));
    const from = screen.getByLabelText("Desde");
    await user.clear(from);
    await user.type(from, "2026-08-01");
    await user.click(screen.getByRole("button", { name: "Aplicar" }));

    await waitFor(() =>
      expect(getMetricsSummary).toHaveBeenLastCalledWith({
        from: "2026-08-01",
        to: "2026-09-19",
      }),
    );
  });

  it("dice que no hubo actividad en vez de mostrar cifras inventadas", async () => {
    vi.mocked(getMetricsSummary).mockResolvedValue(emptySummary);
    renderOverview();

    expect(
      await screen.findByText("Sin actividad en este periodo"),
    ).toBeInTheDocument();
    // Ni guiones de relleno ni tarjetas con una promesa de etapa futura.
    expect(screen.queryByText("Mensajes recibidos")).toBeNull();
    expect(screen.queryByText("—")).toBeNull();
  });

  it("muestra el motivo cuando el backend rechaza el periodo", async () => {
    vi.mocked(getMetricsSummary).mockRejectedValue(
      new Error("El periodo no puede superar 92 días."),
    );
    renderOverview();

    expect(
      await screen.findByText("El periodo no puede superar 92 días."),
    ).toBeInTheDocument();
    expect(screen.queryByText("Mensajes recibidos")).toBeNull();
  });

  it("no consulta métricas sin permiso para leerlas", async () => {
    renderOverview(["panel.read"]);

    expect(
      await screen.findByText("Sin acceso a las métricas"),
    ).toBeInTheDocument();
    expect(getMetricsSummary).not.toHaveBeenCalled();
  });
});
