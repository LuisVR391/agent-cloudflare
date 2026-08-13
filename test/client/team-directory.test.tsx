import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter, Outlet, Route, Routes } from "react-router";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

import { TeamDirectory } from "../../src/client/components/team-directory";
import {
  createTeamInvitation,
  listTeamInvitations,
  listTeamMembers,
  revokeTeamInvitation,
} from "../../src/client/lib/api";

vi.mock("../../src/client/lib/api", () => ({
  listTeamMembers: vi.fn(),
  listTeamInvitations: vi.fn(),
  createTeamInvitation: vi.fn(),
  revokeTeamInvitation: vi.fn(),
}));

const member = {
  membershipId: "membership-1",
  userId: "user-1",
  name: "Ana Propietaria",
  email: "ana@example.com",
  role: "owner" as const,
  status: "active" as const,
  joinedAt: "2026-08-01T10:00:00.000Z",
};

const invitation = {
  id: "invitation-1",
  email: "nueva@example.com",
  role: "operator" as const,
  status: "pending" as const,
  expiresAt: "2999-01-01T10:00:00.000Z",
  invitedBy: "user-1",
  createdAt: "2026-08-13T10:00:00.000Z",
};

function renderTeam(permissions = ["users.read", "users.manage"]) {
  return render(
    <MemoryRouter initialEntries={["/app/equipo"]}>
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
          <Route element={<TeamDirectory />} path="equipo" />
        </Route>
      </Routes>
    </MemoryRouter>,
  );
}

describe("sección de equipo", () => {
  afterEach(() => cleanup());

  beforeEach(() => {
    vi.clearAllMocks();
    vi.mocked(listTeamMembers).mockResolvedValue([member]);
    vi.mocked(listTeamInvitations).mockResolvedValue([invitation]);
  });

  it("muestra a cada miembro con su rol vigente", async () => {
    renderTeam();

    expect(await screen.findByText("Ana Propietaria")).toBeInTheDocument();
    expect(screen.getByText("ana@example.com")).toBeInTheDocument();
    expect(screen.getByText("Propietario")).toBeInTheDocument();
  });

  it("entrega el enlace una sola vez al invitar", async () => {
    const user = userEvent.setup();
    vi.mocked(createTeamInvitation).mockResolvedValue({
      invitation,
      acceptUrl: "https://example.com/invitacion#token-secreto",
    });
    renderTeam();

    await user.type(
      await screen.findByLabelText("Correo"),
      "nueva@example.com",
    );
    await user.click(screen.getByRole("button", { name: "Crear invitación" }));

    await waitFor(() =>
      expect(createTeamInvitation).toHaveBeenCalledWith({
        email: "nueva@example.com",
        role: "operator",
      }),
    );
    expect(
      await screen.findByDisplayValue(
        "https://example.com/invitacion#token-secreto",
      ),
    ).toBeInTheDocument();
    expect(screen.getByText(/No volverá a mostrarse/)).toBeInTheDocument();
  });

  it("revoca una invitación pendiente", async () => {
    const user = userEvent.setup();
    vi.mocked(revokeTeamInvitation).mockResolvedValue({
      ...invitation,
      status: "revoked",
    });
    renderTeam();

    await user.click(await screen.findByRole("button", { name: "Revocar" }));

    expect(revokeTeamInvitation).toHaveBeenCalledWith("invitation-1");
  });

  it("oculta la administración a quien solo puede consultar", async () => {
    renderTeam(["users.read"]);

    expect(await screen.findByText("Ana Propietaria")).toBeInTheDocument();
    expect(
      screen.queryByRole("button", { name: "Crear invitación" }),
    ).not.toBeInTheDocument();
    expect(screen.queryByText("nueva@example.com")).not.toBeInTheDocument();
    expect(listTeamInvitations).not.toHaveBeenCalled();
  });

  it("anuncia la falta de acceso sin pedir datos al servidor", async () => {
    renderTeam([]);

    expect(
      await screen.findByText("No tienes acceso al equipo"),
    ).toBeInTheDocument();
    expect(listTeamMembers).not.toHaveBeenCalled();
  });
});
