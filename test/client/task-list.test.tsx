import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TaskList, TaskSheet } from "../../src/client/components/task-list";
import {
  createTask,
  listSubjectTasks,
  listTasks,
  listTeamMembers,
  updateTask,
  type Task,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listTasks: vi.fn(),
  listSubjectTasks: vi.fn(),
  createTask: vi.fn(),
  updateTask: vi.fn(),
  listTeamMembers: vi.fn(),
}));

function task(overrides: Partial<Task> = {}): Task {
  return {
    id: "task-1",
    title: "Confirmar la cita del sábado",
    details: null,
    assigneeMembershipId: "membership-1",
    assigneeName: "Paula Peluquera",
    createdByMembershipId: "membership-1",
    dueAt: "2026-08-18T16:00:00.000Z",
    status: "open",
    subject: { type: "conversation", id: "conversation-1" },
    subjectLabel: "Lucía Cliente",
    version: 1,
    completedAt: null,
    createdAt: "2026-08-14T10:00:00.000Z",
    updatedAt: "2026-08-14T10:00:00.000Z",
    ...overrides,
  };
}

function renderTasks(permissions = ["tasks.read", "tasks.manage", "users.read"]) {
  return render(
    <MemoryRouter initialEntries={["/app/tareas"]}>
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
          <Route element={<TaskList />} path="tareas" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

afterEach(() => cleanup());

beforeEach(() => {
  vi.clearAllMocks();
  vi.mocked(listTasks).mockResolvedValue({
    tasks: [task()],
    limit: 100,
    truncated: false,
  });
  vi.mocked(listSubjectTasks).mockResolvedValue([task()]);
  vi.mocked(createTask).mockResolvedValue(task({ id: "task-2" }));
  vi.mocked(updateTask).mockResolvedValue(task({ status: "done" }));
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

describe("lista de tareas", () => {
  it("arranca en las pendientes de quien mira", async () => {
    renderTasks();

    expect(await screen.findByText("Confirmar la cita del sábado")).toBeInTheDocument();
    expect(listTasks).toHaveBeenCalledWith({ assignee: "me", status: "open" });
    // El sujeto viaja resuelto para que la fila explique de dónde salió.
    expect(screen.getByText(/Conversación: Lucía Cliente/)).toBeInTheDocument();
  });

  it("filtra por todo el equipo sin enviar identificadores propios", async () => {
    const user = userEvent.setup();
    renderTasks();
    await screen.findByText("Confirmar la cita del sábado");

    await user.click(screen.getByRole("button", { name: "Filtrar por responsable" }));
    await user.click(screen.getByRole("menuitemradio", { name: "Todo el equipo" }));

    await waitFor(() =>
      expect(listTasks).toHaveBeenCalledWith({ assignee: "all", status: "open" }),
    );
  });

  it("crea la tarea con su vencimiento y relee la lista", async () => {
    const user = userEvent.setup();
    renderTasks();
    await screen.findByText("Confirmar la cita del sábado");

    await user.type(screen.getByLabelText("Tarea"), "Cotizar paquete de novia");
    await user.type(screen.getByLabelText("Vencimiento"), "2026-08-18T10:00");
    await user.click(screen.getByRole("button", { name: "Crear tarea" }));

    await waitFor(() => expect(createTask).toHaveBeenCalledTimes(1));
    const [input] = vi.mocked(createTask).mock.calls[0];
    expect(input.title).toBe("Cotizar paquete de novia");
    // Sin responsable explícito, el Worker la deja a nombre de quien la crea.
    expect(input.assigneeMembershipId).toBeUndefined();
    expect(input.dueAt).toMatch(/^\d{4}-\d{2}-\d{2}T/);
    await waitFor(() => expect(listTasks).toHaveBeenCalledTimes(2));
  });

  it("cierra la tarea enviando la versión vigente", async () => {
    const user = userEvent.setup();
    renderTasks();
    await screen.findByText("Confirmar la cita del sábado");

    await user.click(
      screen.getByRole("button", { name: "Cerrar Confirmar la cita del sábado" }),
    );

    await waitFor(() =>
      expect(updateTask).toHaveBeenCalledWith("task-1", {
        expectedVersion: 1,
        status: "done",
      }),
    );
  });

  it("muestra el conflicto de versión tal como lo explica el servidor", async () => {
    const user = userEvent.setup();
    vi.mocked(updateTask).mockRejectedValue(
      new Error("La tarea cambió; vuelve a cargarla."),
    );
    renderTasks();
    await screen.findByText("Confirmar la cita del sábado");

    await user.click(
      screen.getByRole("button", { name: "Cerrar Confirmar la cita del sábado" }),
    );

    expect(
      await screen.findByText("La tarea cambió; vuelve a cargarla."),
    ).toBeInTheDocument();
  });

  it("marca como vencida la pendiente cuyo plazo ya pasó", async () => {
    vi.mocked(listTasks).mockResolvedValue({
      tasks: [task({ dueAt: "2020-01-01T10:00:00.000Z" })],
      limit: 100,
      truncated: false,
    });
    renderTasks();

    expect(await screen.findByText("Vencida")).toBeInTheDocument();
  });

  it("sin permiso de gestión consulta pero no ofrece crear ni cerrar", async () => {
    renderTasks(["tasks.read", "users.read"]);

    await screen.findByText("Confirmar la cita del sábado");
    expect(screen.queryByLabelText("Tarea")).toBeNull();
    expect(
      screen.queryByRole("button", { name: /Cerrar Confirmar la cita/ }),
    ).toBeNull();
  });

  it("sin permiso de lectura no pide nada al servidor", async () => {
    renderTasks([]);

    expect(await screen.findByText("Sin acceso a las tareas")).toBeInTheDocument();
    expect(listTasks).not.toHaveBeenCalled();
  });
});

describe("tareas desde la conversación", () => {
  it("no consulta hasta abrir el panel y cuelga la tarea del hilo", async () => {
    const user = userEvent.setup();
    render(
      <TaskSheet
        canManage
        canReadTeam
        subject={{ type: "conversation", id: "conversation-1" }}
      />,
    );

    expect(listSubjectTasks).not.toHaveBeenCalled();

    await user.click(screen.getByRole("button", { name: "Tareas" }));
    expect(await screen.findByText("Tareas de la conversación")).toBeInTheDocument();
    await waitFor(() =>
      expect(listSubjectTasks).toHaveBeenCalledWith({
        type: "conversation",
        id: "conversation-1",
      }),
    );

    await user.type(screen.getByLabelText("Tarea"), "Llamar mañana");
    await user.click(screen.getByRole("button", { name: "Crear tarea" }));

    await waitFor(() =>
      expect(createTask).toHaveBeenCalledWith(
        expect.objectContaining({
          title: "Llamar mañana",
          subject: { type: "conversation", id: "conversation-1" },
        }),
      ),
    );
  });
});
