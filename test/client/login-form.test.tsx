import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { describe, expect, it, vi } from "vitest";

import { LoginForm } from "../../src/client/components/login-form";

describe("LoginForm", () => {
  it("envía credenciales sin ofrecer registro público", async () => {
    const user = userEvent.setup();
    const onLogin = vi.fn().mockResolvedValue(undefined);

    render(
      <LoginForm error={null} loading={false} onLogin={onLogin} />,
    );

    await user.type(
      screen.getByLabelText("Correo electrónico"),
      "ana@example.com",
    );
    await user.type(screen.getByLabelText("Contraseña"), "secure-password");
    await user.click(screen.getByRole("button", { name: "Iniciar sesión" }));

    expect(onLogin).toHaveBeenCalledWith(
      "ana@example.com",
      "secure-password",
    );
    expect(screen.queryByText(/crear cuenta/i)).not.toBeInTheDocument();
  });

  it("expone el error y bloquea el envío mientras carga", () => {
    render(
      <LoginForm
        error="Correo o contraseña incorrectos."
        loading
        onLogin={vi.fn()}
      />,
    );

    expect(screen.getByRole("alert")).toHaveTextContent(
      "Correo o contraseña incorrectos.",
    );
    expect(screen.getByRole("button", { name: "Ingresando…" })).toBeDisabled();
  });
});
