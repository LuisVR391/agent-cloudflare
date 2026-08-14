import { cleanup, render, screen } from "@testing-library/react";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { PipelineBoard } from "../../src/client/components/pipeline-board";
import { listPipelines } from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listPipelines: vi.fn(),
}));

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

function renderBoard(permissions = ["pipelines.read"]) {
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

  it("anuncia cada etapa vacía en vez de fingir contenido", async () => {
    renderBoard();

    expect(
      await screen.findAllByText("Sin oportunidades todavía."),
    ).toHaveLength(2);
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
