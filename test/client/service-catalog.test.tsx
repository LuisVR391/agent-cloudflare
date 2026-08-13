import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { ServiceCatalog } from "../../src/client/components/service-catalog";
import {
  createService,
  listServices,
  updateService,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listServices: vi.fn(),
  createService: vi.fn(),
  updateService: vi.fn(),
}));

const service = {
  id: "service-1",
  name: "Corte de dama",
  durationMinutes: 45,
  priceAmountCents: 35000,
  priceCurrency: "MXN",
  status: "active" as const,
  version: 1,
  createdAt: "2026-08-13T10:00:00.000Z",
  updatedAt: "2026-08-13T10:00:00.000Z",
};

function renderCatalog(permissions = ["services.read", "services.manage"]) {
  return render(
    <MemoryRouter initialEntries={["/app/servicios"]}>
      <Routes>
        <Route
          element={
            <Outlet
              context={{
                user: { id: "user-1", name: "Sara", email: "sara@example.com" },
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
          <Route element={<ServiceCatalog />} path="servicios" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("sección de servicios", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listServices).mockResolvedValue([service]);
  });

  it("muestra cada servicio con su duración y su precio", async () => {
    renderCatalog();

    expect(await screen.findByText("Corte de dama")).toBeInTheDocument();
    expect(screen.getByText(/45 min/)).toBeInTheDocument();
    expect(screen.getByText(/350/)).toBeInTheDocument();
  });

  it("crea un servicio con el importe convertido a centavos", async () => {
    const user = userEvent.setup();
    vi.mocked(createService).mockResolvedValue(service);
    renderCatalog();

    await user.type(await screen.findByLabelText("Nombre"), "Manicura");
    await user.clear(screen.getByLabelText("Duración en minutos"));
    await user.type(screen.getByLabelText("Duración en minutos"), "30");
    await user.type(screen.getByLabelText("Precio"), "250.50");
    await user.click(screen.getByRole("button", { name: "Agregar servicio" }));

    await waitFor(() =>
      expect(createService).toHaveBeenCalledWith({
        name: "Manicura",
        durationMinutes: 30,
        price: { amountCents: 25050, currency: "MXN" },
      }),
    );
  });

  it("deja el servicio sin precio cuando el importe queda vacío", async () => {
    const user = userEvent.setup();
    vi.mocked(createService).mockResolvedValue(service);
    renderCatalog();

    await user.type(await screen.findByLabelText("Nombre"), "Peinado");
    await user.click(screen.getByRole("button", { name: "Agregar servicio" }));

    await waitFor(() =>
      expect(createService).toHaveBeenCalledWith({
        name: "Peinado",
        durationMinutes: 60,
        price: null,
      }),
    );
  });

  it("archiva un servicio enviando la versión vigente", async () => {
    const user = userEvent.setup();
    vi.mocked(updateService).mockResolvedValue({ ...service, status: "archived", version: 2 });
    renderCatalog();

    await user.click(await screen.findByRole("button", { name: "Archivar" }));

    expect(updateService).toHaveBeenCalledWith("service-1", {
      expectedVersion: 1,
      status: "archived",
    });
  });

  it("muestra el conflicto de versión sin perder lo escrito", async () => {
    const user = userEvent.setup();
    vi.mocked(updateService).mockRejectedValue(
      new Error("El servicio cambió; vuelve a cargarlo."),
    );
    renderCatalog();

    await user.click(await screen.findByRole("button", { name: "Editar" }));
    await user.click(screen.getByRole("button", { name: "Guardar cambios" }));

    expect(
      await screen.findByText("El servicio cambió; vuelve a cargarlo."),
    ).toBeInTheDocument();
    expect(screen.getByLabelText("Nombre")).toHaveValue("Corte de dama");
  });

  it("oculta la gestión a quien solo puede consultar", async () => {
    renderCatalog(["services.read"]);

    expect(await screen.findByText("Corte de dama")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Agregar servicio" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "Archivar" })).not.toBeInTheDocument();
    // Sin gestión no hay motivo para pedir los archivados.
    expect(listServices).toHaveBeenCalledWith("active");
  });

  it("anuncia la falta de acceso sin pedir datos al servidor", async () => {
    renderCatalog([]);

    expect(
      await screen.findByText("No tienes acceso al catálogo"),
    ).toBeInTheDocument();
    expect(listServices).not.toHaveBeenCalled();
  });
});
