import { LoaderCircle, UserRoundPlus } from "lucide-react";
import { useEffect, useRef, useState, type FormEvent } from "react";
import { useNavigate } from "react-router";

import { roleLabels } from "@/components/team-directory";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldDescription, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  acceptInvitation,
  previewInvitation,
  type TeamRole,
} from "@/lib/api";

type Invitation = {
  organizationName: string;
  role: TeamRole;
  expiresAt: string;
};

/**
 * Alta de una persona invitada. Es el único camino que crea credenciales fuera
 * de la instalación: el registro público sigue cerrado.
 *
 * El token llega en el fragmento del enlace, que el navegador no envía al
 * servidor. Se lee una vez, se guarda fuera del estado de React —para que no
 * acabe en un árbol serializado— y se borra de la barra de direcciones, de modo
 * que no quede en el historial ni se comparta al copiar la URL.
 */
export function InvitationAcceptance() {
  const navigate = useNavigate();
  const token = useRef<string>(
    typeof window === "undefined" ? "" : window.location.hash.slice(1),
  );
  const [invitation, setInvitation] = useState<Invitation | null>(null);
  const [checking, setChecking] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    window.history.replaceState({}, "", "/invitacion");
    if (!token.current) {
      setError("El enlace de invitación está incompleto.");
      setChecking(false);
      return;
    }
    void previewInvitation(token.current)
      .then(setInvitation)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "La invitación no está disponible.",
        ),
      )
      .finally(() => setChecking(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setSubmitting(true);
    setError(null);
    try {
      await acceptInvitation({
        token: token.current,
        email: String(form.get("email") ?? ""),
        name: String(form.get("name") ?? ""),
        password: String(form.get("password") ?? ""),
      });
      navigate("/login", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible aceptar la invitación.",
      );
    } finally {
      setSubmitting(false);
    }
  }

  return (
    <main className="min-h-screen bg-muted/40 px-5 py-12">
      <div className="mx-auto max-w-2xl">
        <Card>
          <CardHeader>
            <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <UserRoundPlus className="size-5" />
            </div>
            <CardTitle>
              {invitation
                ? `Únete a ${invitation.organizationName}`
                : "Aceptar invitación"}
            </CardTitle>
            <CardDescription>
              {invitation
                ? `Entrarás como ${roleLabels[invitation.role].toLowerCase()}. Crea tu contraseña para completar el alta.`
                : "Comprobando el enlace que recibiste."}
            </CardDescription>
          </CardHeader>
          <CardContent>
            {checking ? (
              <p className="flex items-center gap-2 text-sm text-muted-foreground">
                <LoaderCircle className="size-4 animate-spin" />
                Comprobando la invitación…
              </p>
            ) : null}
            {!checking && error && !invitation ? (
              <div
                className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                role="alert"
              >
                {error}
              </div>
            ) : null}
            {invitation ? (
              <form onSubmit={submit}>
                <FieldGroup>
                  {error ? (
                    <div
                      className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                      role="alert"
                    >
                      {error}
                    </div>
                  ) : null}
                  <Field>
                    <FieldLabel htmlFor="email">Correo</FieldLabel>
                    <Input
                      autoComplete="email"
                      id="email"
                      name="email"
                      required
                      type="email"
                    />
                    <FieldDescription>
                      El mismo correo al que se dirigió la invitación.
                    </FieldDescription>
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="name">Nombre</FieldLabel>
                    <Input autoComplete="name" id="name" name="name" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                    <Input
                      autoComplete="new-password"
                      id="password"
                      minLength={12}
                      name="password"
                      required
                      type="password"
                    />
                    <FieldDescription>Al menos 12 caracteres.</FieldDescription>
                  </Field>
                  <Button disabled={submitting} type="submit">
                    {submitting && <LoaderCircle className="animate-spin" />}
                    {submitting ? "Creando tu cuenta…" : "Crear mi cuenta"}
                  </Button>
                </FieldGroup>
              </form>
            ) : null}
          </CardContent>
        </Card>
      </div>
    </main>
  );
}
