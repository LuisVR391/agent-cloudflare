import { useState, type FormEvent } from "react";
import { ArrowRight, LoaderCircle, MessageCircleMore, ShieldCheck } from "lucide-react";

import { Button } from "@/components/ui/button";
import { Card, CardContent } from "@/components/ui/card";
import {
  Field,
  FieldDescription,
  FieldGroup,
  FieldLabel,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { cn } from "@/lib/utils";

type LoginFormProps = Omit<React.ComponentProps<"div">, "onSubmit"> & {
  error: string | null;
  loading: boolean;
  onLogin: (email: string, password: string) => Promise<void>;
};

export function LoginForm({
  className,
  error,
  loading,
  onLogin,
  ...props
}: LoginFormProps) {
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await onLogin(email, password);
  }

  return (
    <div className={cn("flex w-full flex-col gap-6", className)} {...props}>
      <Card className="overflow-hidden border-white/10 bg-card/95 p-0 shadow-2xl shadow-black/30">
        <CardContent className="grid p-0 md:grid-cols-[1.05fr_.95fr]">
          <form className="p-7 sm:p-10" onSubmit={submit}>
            <FieldGroup>
              <div className="flex flex-col gap-3">
                <div className="flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
                  <MessageCircleMore className="size-5" aria-hidden="true" />
                </div>
                <div>
                  <h1 className="text-2xl font-semibold tracking-tight">
                    Bienvenido de vuelta
                  </h1>
                  <p className="mt-2 text-sm text-muted-foreground">
                    Ingresa al centro de operaciones de tus conversaciones.
                  </p>
                </div>
              </div>
              {error ? (
                <div
                  className="rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive"
                  role="alert"
                >
                  {error}
                </div>
              ) : null}
              <Field>
                <FieldLabel htmlFor="email">Correo electrónico</FieldLabel>
                <Input
                  autoComplete="email"
                  id="email"
                  onChange={(event) => setEmail(event.target.value)}
                  placeholder="tu@empresa.com"
                  required
                  type="email"
                  value={email}
                />
              </Field>
              <Field>
                <FieldLabel htmlFor="password">Contraseña</FieldLabel>
                <Input
                  autoComplete="current-password"
                  id="password"
                  minLength={12}
                  onChange={(event) => setPassword(event.target.value)}
                  required
                  type="password"
                  value={password}
                />
                <FieldDescription>
                  El acceso es creado por el propietario de tu organización.
                </FieldDescription>
              </Field>
              <Field>
                <Button className="w-full" disabled={loading} type="submit">
                  {loading ? (
                    <LoaderCircle className="animate-spin" aria-hidden="true" />
                  ) : (
                    <ArrowRight aria-hidden="true" />
                  )}
                  {loading ? "Ingresando…" : "Iniciar sesión"}
                </Button>
              </Field>
            </FieldGroup>
          </form>
          <div className="relative hidden min-h-[520px] overflow-hidden border-l border-white/10 bg-zinc-950 p-10 text-white md:flex md:flex-col md:justify-between">
            <div className="absolute -right-20 -top-20 size-64 rounded-full bg-cyan-400/20 blur-3xl" />
            <div className="absolute -bottom-20 -left-20 size-64 rounded-full bg-orange-400/20 blur-3xl" />
            <div className="relative">
              <div className="flex size-10 items-center justify-center rounded-xl border border-white/15 bg-white/10">
                <ShieldCheck className="size-5" aria-hidden="true" />
              </div>
              <p className="mt-6 text-xl font-medium leading-relaxed">
                Un espacio privado para atender, organizar y convertir cada
                conversación.
              </p>
            </div>
            <div className="relative rounded-2xl border border-white/10 bg-white/5 p-5 backdrop-blur">
              <p className="text-sm text-zinc-300">
                Acceso aislado por organización
              </p>
              <p className="mt-2 text-xs leading-relaxed text-zinc-500">
                La organización activa y los permisos siempre se validan en el
                Worker antes de exponer información o acciones.
              </p>
            </div>
          </div>
        </CardContent>
      </Card>
    </div>
  );
}
