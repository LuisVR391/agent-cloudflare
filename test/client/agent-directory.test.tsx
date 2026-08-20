import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { AgentDirectory } from "../../src/client/components/agent-directory";
import {
  createAgent,
  createAgentVersion,
  fetchAgentTools,
  getAgent,
  listAgents,
  replaceAgentVersion,
  setAgentPublication,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listAgents: vi.fn(),
  getAgent: vi.fn(),
  createAgent: vi.fn(),
  updateAgent: vi.fn(),
  createAgentVersion: vi.fn(),
  replaceAgentVersion: vi.fn(),
  setAgentPublication: vi.fn(),
  fetchAgentTools: vi.fn(),
}));

/**
 * El catálogo es del producto y lo sirve el backend: la pantalla no lo declara,
 * solo lo pinta. Las dos claves son las del corte.
 */
const toolCatalog = [
  {
    key: "list_services",
    label: "Consultar los servicios",
    description: "Servicios activos con su duración y su precio.",
  },
  {
    key: "get_own_appointment",
    label: "Consultar la cita del contacto",
    description: "La próxima cita de quien escribe en esa conversación.",
  },
];

const summary = {
  id: "agent-1",
  name: "Recepción",
  purpose: "Atiende la primera pregunta",
  status: "active" as const,
  publishedVersionId: "version-2",
  publishedVersionNumber: 2,
  version: 5,
  createdAt: "2026-08-16T10:00:00.000Z",
  updatedAt: "2026-08-16T10:00:00.000Z",
};

const publishedVersion = {
  id: "version-2",
  agentId: "agent-1",
  versionNumber: 2,
  status: "published" as const,
  instructions: "Responde con el catálogo vigente.",
  model: "modelo-previsto",
  playbook: null,
  changeReason: "Ajuste de tono",
  tools: ["list_services"],
  knowledgeScopes: ["Servicios"],
  createdByName: "Ana Propietaria",
  createdAt: "2026-08-16T10:00:00.000Z",
  updatedAt: "2026-08-16T10:00:00.000Z",
};

const archivedVersion = {
  ...publishedVersion,
  id: "version-1",
  versionNumber: 1,
  status: "archived" as const,
  instructions: "Texto original.",
  changeReason: "Primera versión",
  // Declarada cuando el campo era texto libre: el catálogo ya no la ofrece.
  tools: ["agenda.crear"],
};

const draftVersion = {
  ...publishedVersion,
  id: "version-3",
  versionNumber: 3,
  status: "draft" as const,
  instructions: "Borrador en curso.",
  changeReason: "Probar otro tono",
  tools: ["list_services", "agenda.crear"],
};

const detail = {
  ...summary,
  versions: [draftVersion, publishedVersion, archivedVersion],
  publications: [
    {
      id: "publication-1",
      previousVersionNumber: 1,
      nextVersionNumber: 2,
      action: "published" as const,
      reason: "Arranque del piloto",
      actorName: "Ana Propietaria",
      occurredAt: "2026-08-16T11:00:00.000Z",
    },
  ],
};

function renderDirectory(permissions = ["agents.read", "agents.manage"]) {
  return render(
    <MemoryRouter initialEntries={["/app/agentes"]}>
      <Routes>
        <Route
          element={
            <Outlet
              context={{
                user: { id: "user-1", name: "Ana", email: "ana@example.com" },
                organizations: [],
                activeOrganization: {
                  organizationId: "11111111-1111-4111-8111-111111111111",
                  organizationName: "Salón Uno",
                  organizationSlug: "salon-uno",
                  organizationTimeZone: "America/Mexico_City",
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
          <Route element={<AgentDirectory />} path="agentes" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(cleanup);

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listAgents).mockResolvedValue([summary]);
  vi.mocked(getAgent).mockResolvedValue(detail);
  vi.mocked(createAgent).mockResolvedValue(summary);
  vi.mocked(createAgentVersion).mockResolvedValue(detail);
  vi.mocked(replaceAgentVersion).mockResolvedValue(detail);
  vi.mocked(setAgentPublication).mockResolvedValue(detail);
  vi.mocked(fetchAgentTools).mockResolvedValue(toolCatalog);
});

/** Abre el detalle del agente y deja el borrador en edición. */
async function openDraftEditor(browserUser: ReturnType<typeof userEvent.setup>) {
  await browserUser.click(await screen.findByRole("button", { name: "Versiones" }));
  await browserUser.click(await screen.findByRole("button", { name: "Editar" }));
}

describe("configuración de agentes", () => {
  it("lista los agentes con la versión que está publicada", async () => {
    renderDirectory();

    expect(await screen.findByText("Recepción")).toBeInTheDocument();
    expect(screen.getByText("v2 publicada")).toBeInTheDocument();
    expect(
      screen.getByText("Atiende la primera pregunta"),
    ).toBeInTheDocument();
  });

  it("anuncia el estado vacío de una organización recién instalada", async () => {
    vi.mocked(listAgents).mockResolvedValue([]);

    renderDirectory();

    expect(
      await screen.findByText(/Todavía no hay agentes configurados/),
    ).toBeInTheDocument();
  });

  it("dice que publicar no mueve conversaciones y que el agente asignado sí responde", async () => {
    renderDirectory();

    expect(
      await screen.findByText(/Publicar no cambia ninguna conversación en curso/),
    ).toBeInTheDocument();
    expect(
      screen.getByText(
        /un agente asignado responde con la versión publicada/,
      ),
    ).toBeInTheDocument();
  });

  it("crea un agente con su nombre y su propósito", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await screen.findByText("Recepción");

    await browserUser.type(screen.getByLabelText("Nombre"), "Agenda");
    await browserUser.type(screen.getByLabelText("Propósito"), "Reserva citas");
    await browserUser.click(screen.getByRole("button", { name: "Crear agente" }));

    await waitFor(() =>
      expect(createAgent).toHaveBeenCalledWith({
        name: "Agenda",
        purpose: "Reserva citas",
      }),
    );
  });

  it("envía el motivo y la versión vigente al publicar un borrador", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );

    await browserUser.type(
      await screen.findByLabelText("Motivo del cambio de publicación"),
      "Probar el tono nuevo",
    );
    await browserUser.click(screen.getAllByRole("button", { name: "Publicar" })[0]);

    await waitFor(() =>
      expect(setAgentPublication).toHaveBeenCalledWith("agent-1", {
        expectedVersion: 5,
        versionId: "version-3",
        reason: "Probar el tono nuevo",
      }),
    );
  });

  it("ofrece revertir, no publicar, cuando la versión es anterior a la vigente", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );

    await browserUser.type(
      await screen.findByLabelText("Motivo del cambio de publicación"),
      "La dos respondía de más",
    );
    await browserUser.click(
      screen.getByRole("button", { name: "Revertir a esta" }),
    );

    await waitFor(() =>
      expect(setAgentPublication).toHaveBeenCalledWith("agent-1", {
        expectedVersion: 5,
        versionId: "version-1",
        reason: "La dos respondía de más",
      }),
    );
  });

  it("exige un motivo antes de dejar cambiar la publicación", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );

    expect(
      await screen.findByRole("button", { name: "Desactivar la publicación" }),
    ).toBeDisabled();
    expect(screen.getAllByRole("button", { name: "Publicar" })[0]).toBeDisabled();
  });

  it("no ofrece editar una versión que ya se publicó", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );

    // Solo el borrador es editable; la publicada y la archivada no.
    expect(await screen.findAllByRole("button", { name: "Editar" })).toHaveLength(
      1,
    );
    // Y la publicada tampoco ofrece publicarse otra vez.
    expect(screen.getAllByRole("button", { name: "Publicar" })).toHaveLength(1);
  });

  it("edita el borrador reemplazando su contenido entero", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );
    await browserUser.click(await screen.findByRole("button", { name: "Editar" }));

    const instructions = screen.getByLabelText("Instrucciones");
    await browserUser.clear(instructions);
    await browserUser.type(instructions, "Texto corregido.");
    await browserUser.click(
      screen.getByRole("button", { name: "Guardar el borrador" }),
    );

    await waitFor(() =>
      expect(replaceAgentVersion).toHaveBeenCalledWith("agent-1", "version-3", {
        expectedVersion: 5,
        instructions: "Texto corregido.",
        model: "modelo-previsto",
        playbook: null,
        tools: ["list_services"],
        knowledgeScopes: ["Servicios"],
        changeReason: "Probar otro tono",
      }),
    );
  });

  it("ofrece el catálogo de herramientas en vez de un campo para escribirlas", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await openDraftEditor(browserUser);

    // Ya no se escribe una lista separada por comas.
    expect(screen.queryByLabelText("Herramientas declaradas")).toBeNull();
    expect(screen.queryByText(/no habilitan nada todavía/)).toBeNull();

    // Se elige del catálogo, con lo que cada herramienta consulta a la vista.
    expect(
      screen.getByRole("checkbox", { name: "Consultar los servicios" }),
    ).toBeChecked();
    expect(
      screen.getByRole("checkbox", { name: "Consultar la cita del contacto" }),
    ).not.toBeChecked();
    expect(
      screen.getByText("Servicios activos con su duración y su precio."),
    ).toBeInTheDocument();
  });

  it("guarda el borrador con las herramientas que quedaron marcadas", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await openDraftEditor(browserUser);

    await browserUser.click(
      screen.getByRole("checkbox", { name: "Consultar la cita del contacto" }),
    );
    await browserUser.click(
      screen.getByRole("checkbox", { name: "Consultar los servicios" }),
    );
    await browserUser.click(
      screen.getByRole("button", { name: "Guardar el borrador" }),
    );

    await waitFor(() =>
      expect(replaceAgentVersion).toHaveBeenCalledWith(
        "agent-1",
        "version-3",
        expect.objectContaining({ tools: ["get_own_appointment"] }),
      ),
    );
  });

  it("lee una declaración fuera del catálogo sin dejar volver a marcarla", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );

    // La versión antigua conserva lo que declaró, aunque ya no se ofrezca.
    expect(
      (await screen.findAllByText("agenda.crear · fuera del catálogo")).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText("Consultar los servicios").length).toBeGreaterThan(0);

    await browserUser.click(screen.getByRole("button", { name: "Editar" }));
    expect(screen.queryByRole("checkbox", { name: /agenda\.crear/ })).toBeNull();
    expect(screen.getAllByRole("checkbox")).toHaveLength(toolCatalog.length);
  });

  it("no deja guardar mientras el catálogo de herramientas no se pudo cargar", async () => {
    vi.mocked(fetchAgentTools).mockRejectedValue(
      new Error("No fue posible cargar las herramientas."),
    );
    const browserUser = userEvent.setup();
    renderDirectory();
    await openDraftEditor(browserUser);

    expect(
      await screen.findByText(/Sin el catálogo no se puede declarar/),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: "Guardar el borrador" }),
    ).toBeDisabled();
  });

  it("muestra el historial con quién cambió la publicación y por qué", async () => {
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );
    await browserUser.click(await screen.findByRole("tab", { name: "Historial" }));

    expect(await screen.findByText(/Publicó la v2, antes la v1/)).toBeInTheDocument();
    expect(screen.getByText("Arranque del piloto")).toBeInTheDocument();
    expect(screen.getByText(/Ana Propietaria/)).toBeInTheDocument();
  });

  it("conserva el mensaje del servidor cuando la versión cambió", async () => {
    vi.mocked(setAgentPublication).mockRejectedValue(
      new Error("El agente cambió; vuelve a cargarlo."),
    );
    const browserUser = userEvent.setup();
    renderDirectory();
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );

    await browserUser.type(
      await screen.findByLabelText("Motivo del cambio de publicación"),
      "Publicar",
    );
    await browserUser.click(screen.getAllByRole("button", { name: "Publicar" })[0]);

    expect(
      await screen.findByText("El agente cambió; vuelve a cargarlo."),
    ).toBeInTheDocument();
  });

  it("oculta la gestión a quien solo puede consultar", async () => {
    const browserUser = userEvent.setup();
    renderDirectory(["agents.read"]);
    await browserUser.click(
      await screen.findByRole("button", { name: "Versiones" }),
    );

    expect(screen.queryByRole("button", { name: "Crear agente" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Publicar" })).toBeNull();
    expect(screen.queryByRole("button", { name: "Editar" })).toBeNull();
    expect(
      screen.queryByLabelText("Motivo del cambio de publicación"),
    ).toBeNull();
  });

  it("anuncia la falta de acceso sin pedir datos al servidor", async () => {
    renderDirectory([]);

    expect(
      await screen.findByText("No tienes acceso a los agentes"),
    ).toBeInTheDocument();
    expect(listAgents).not.toHaveBeenCalled();
    expect(fetchAgentTools).not.toHaveBeenCalled();
  });
});
