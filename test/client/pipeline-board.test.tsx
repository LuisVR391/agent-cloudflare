import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineBoard } from "../../src/client/components/pipeline-board";
import {
  listPipelineOpportunities,
  listPipelines,
  updateOpportunity,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listPipelines: vi.fn(),
  listPipelineOpportunities: vi.fn(),
  updateOpportunity: vi.fn(),
}));

const opportunity = {
  id: "opportunity-1",
  contactId: "contact-1",
  contactDisplayName: "Lucía Cliente",
  conversationId: "conversation-1",
  pipelineId: "pipeline-1",
  stageId: "stage-1",
  stageName: "Nuevo contacto",
  stagePosition: 1,
  serviceId: "service-1",
  serviceName: "Corte y peinado",
  version: 3,
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

const pipeline = {
  id: "pipeline-1",
  name: "Pipeline de salón",
  templateKey: "beauty-salon-initial",
  version: 1,
  stages: [
    {
      id: "stage-1",
      pipelineId: "pipeline-1",
      name: "Nuevo contacto",
      position: 1,
      color: "neutral" as const,
    },
    {
      id: "stage-2",
      pipelineId: "pipeline-1",
      name: "Cita agendada",
      position: 2,
      color: "warning" as const,
    },
  ],
};

function renderBoard(
  permissions = [
    "pipelines.read",
    "opportunities.read",
    "opportunities.manage",
  ],
) {
  return render(
    <MemoryRouter initialEntries={["/app/pipeline"]}>
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
          <Route element={<PipelineBoard />} path="pipeline" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("tablero del pipeline", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listPipelines).mockResolvedValue([pipeline]);
    vi.mocked(listPipelineOpportunities).mockResolvedValue({
      opportunities: [opportunity],
      limit: 100,
      truncated: false,
    });
  });

  it("muestra una columna por etapa, en su orden", async () => {
    renderBoard();

    expect(
      await screen.findByRole("heading", { name: "Pipeline de salón" }),
    ).toBeInTheDocument();
    const columns = screen.getAllByRole("region");
    expect(columns.map((column) => column.getAttribute("aria-label"))).toEqual([
      "Nuevo contacto",
      "Cita agendada",
    ]);
  });

  it("coloca cada oportunidad en su etapa y deja vacías las demás", async () => {
    renderBoard();

    expect(await screen.findByText("Lucía Cliente")).toBeInTheDocument();
    expect(screen.getByText("Corte y peinado")).toBeInTheDocument();
    // Solo la segunda columna queda sin tarjetas.
    expect(screen.getAllByText("Sin oportunidades todavía.")).toHaveLength(1);
  });

  it("mueve una oportunidad enviando la versión vigente", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOpportunity).mockResolvedValue({
      ...opportunity,
      stageId: "stage-2",
      version: 4,
      transitions: [],
    });
    renderBoard();

    await user.click(
      await screen.findByRole("button", { name: "Mover Lucía Cliente" }),
    );
    await user.click(await screen.findByRole("menuitemradio", { name: "Cita agendada" }));

    await waitFor(() =>
      expect(updateOpportunity).toHaveBeenCalledWith("opportunity-1", {
        expectedVersion: 3,
        stageId: "stage-2",
      }),
    );
  });

  it("muestra el conflicto de versión sin dejar la vista a medias", async () => {
    const user = userEvent.setup();
    vi.mocked(updateOpportunity).mockRejectedValue(
      new Error("La oportunidad cambió; vuelve a cargarla."),
    );
    renderBoard();

    await user.click(
      await screen.findByRole("button", { name: "Mover Lucía Cliente" }),
    );
    await user.click(await screen.findByRole("menuitemradio", { name: "Cita agendada" }));

    expect(
      await screen.findByText("La oportunidad cambió; vuelve a cargarla."),
    ).toBeInTheDocument();
  });

  it("oculta el movimiento a quien solo puede consultar", async () => {
    renderBoard(["pipelines.read", "opportunities.read"]);

    expect(await screen.findByText("Lucía Cliente")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Mover Lucía Cliente" }),
    ).not.toBeInTheDocument();
  });

  it("explica el pipeline ausente sin culpar a la persona", async () => {
    vi.mocked(listPipelines).mockResolvedValue([]);
    renderBoard();

    expect(await screen.findByText("Todavía no hay etapas")).toBeInTheDocument();
  });

  it("anuncia la falta de acceso sin pedir datos al servidor", async () => {
    renderBoard([]);

    expect(
      await screen.findByText("No tienes acceso al pipeline"),
    ).toBeInTheDocument();
    expect(listPipelines).not.toHaveBeenCalled();
  });
});
