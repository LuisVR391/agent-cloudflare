import {
  ArrowRight,
  Bot,
  Building2,
  Clock3,
  LoaderCircle,
  LockKeyhole,
  MessageCircleMore,
  ShieldCheck,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import {
  BrowserRouter,
  Link,
  Navigate,
  Route,
  Routes,
  useNavigate,
} from "react-router";

import { AppointmentAgenda } from "@/components/appointment-agenda";
import { LoginForm } from "@/components/login-form";
import { ContactDirectory } from "@/components/contact-directory";
import { ConversationInbox } from "@/components/conversation-inbox";
import { InvitationAcceptance } from "@/components/invitation-acceptance";
import { TeamDirectory } from "@/components/team-directory";
import { PanelOverview } from "@/components/panel-overview";
import { PanelShell } from "@/components/panel-shell";
import { PipelineBoard } from "@/components/pipeline-board";
import { ServiceCatalog } from "@/components/service-catalog";
import { TaskList } from "@/components/task-list";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  completeSetup,
  getAppContext,
  getSetupStatus,
  selectOrganization,
  signIn,
  signOut,
  type AppContext,
} from "@/lib/api";

function Brand() {
  return (
    <Link className="flex items-center gap-3 font-semibold" to="/">
      <span className="flex size-9 items-center justify-center rounded-xl bg-primary text-primary-foreground">
        <MessageCircleMore className="size-5" aria-hidden="true" />
      </span>
      <span>Agent Cloudflare</span>
    </Link>
  );
}

function LandingPage() {
  const [health, setHealth] = useState<"checking" | "online" | "offline">(
    "checking",
  );

  useEffect(() => {
    const controller = new AbortController();
    void fetch("/api/health", { signal: controller.signal })
      .then((response) => setHealth(response.ok ? "online" : "offline"))
      .catch(() => {
        if (!controller.signal.aborted) setHealth("offline");
      });
    return () => controller.abort();
  }, []);

  return (
    <main className="min-h-screen overflow-hidden bg-zinc-950 text-white">
      <div className="absolute inset-x-0 top-0 h-[560px] bg-[radial-gradient(circle_at_15%_20%,rgba(34,211,238,.17),transparent_32%),radial-gradient(circle_at_80%_10%,rgba(251,146,60,.15),transparent_30%)]" />
      <nav className="relative mx-auto flex max-w-6xl items-center justify-between px-6 py-6">
        <Brand />
        <Button
          asChild
          className="border-white/15 bg-white/10 text-white hover:bg-white/15"
          variant="outline"
        >
          <Link to="/login">Ingresar</Link>
        </Button>
      </nav>
      <section className="relative mx-auto grid max-w-6xl gap-14 px-6 pb-24 pt-16 lg:grid-cols-[1.08fr_.92fr] lg:items-center lg:pt-24">
        <div>
          <div className="inline-flex items-center gap-2 rounded-full border border-white/10 bg-white/5 px-3 py-1.5 text-xs text-zinc-300">
            <span
              className={`size-2 rounded-full ${
                health === "online"
                  ? "bg-emerald-400"
                  : health === "offline"
                    ? "bg-red-400"
                    : "animate-pulse bg-amber-300"
              }`}
            />
            Worker {health === "checking" ? "comprobando" : health}
          </div>
          <p className="mt-8 text-sm font-medium uppercase tracking-[.24em] text-cyan-300">
            Cloudflare-native customer care
          </p>
          <h1 className="mt-5 max-w-3xl text-5xl font-semibold tracking-[-.05em] sm:text-7xl">
            Cada conversación,
            <span className="text-zinc-500"> bajo control.</span>
          </h1>
          <p className="mt-7 max-w-xl text-lg leading-8 text-zinc-400">
            El CRM conversacional para salones que centraliza atención,
            seguimiento y agentes de IA, comenzando por WhatsApp.
          </p>
          <div className="mt-9 flex flex-wrap gap-3">
            <Button asChild size="lg">
              <Link to="/login">
                Abrir panel <ArrowRight aria-hidden="true" />
              </Link>
            </Button>
            <span className="flex items-center gap-2 px-3 text-sm text-zinc-500">
              <ShieldCheck className="size-4" /> Acceso privado por organización
            </span>
          </div>
        </div>
        <div className="relative">
          <div className="absolute -inset-10 rounded-full bg-cyan-400/10 blur-3xl" />
          <Card className="relative border-white/10 bg-white/[.055] text-white shadow-2xl backdrop-blur">
            <CardHeader>
              <div className="flex items-center justify-between">
                <div>
                  <CardDescription className="text-zinc-500">
                    Centro de operaciones
                  </CardDescription>
                  <CardTitle className="mt-1 text-white">
                    Resumen de hoy
                  </CardTitle>
                </div>
                <span className="rounded-full bg-emerald-400/10 px-3 py-1 text-xs text-emerald-300">
                  En línea
                </span>
              </div>
            </CardHeader>
            <CardContent className="space-y-3">
              {([
                ["Conversaciones", "24", MessageCircleMore],
                ["Pendientes", "7", Clock3],
                ["Agentes activos", "3", Bot],
              ] as const).map(([label, value, Icon]) => (
                <div
                  className="flex items-center gap-4 rounded-2xl border border-white/10 bg-black/20 p-4"
                  key={String(label)}
                >
                  <span className="flex size-10 items-center justify-center rounded-xl bg-white/5">
                    <Icon className="size-5 text-cyan-300" />
                  </span>
                  <span className="flex-1 text-sm text-zinc-400">{label}</span>
                  <strong className="text-xl">{value}</strong>
                </div>
              ))}
              <p className="pt-2 text-center text-xs text-zinc-600">
                Vista conceptual · los módulos operativos llegan por fases
              </p>
            </CardContent>
          </Card>
        </div>
      </section>
    </main>
  );
}

function LoginPage() {
  const navigate = useNavigate();
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [setupRequired, setSetupRequired] = useState(false);

  useEffect(() => {
    void getSetupStatus().then(setSetupRequired).catch(() => undefined);
  }, []);

  async function submit(email: string, password: string) {
    setLoading(true);
    setError(null);
    try {
      await signIn(email, password);
      navigate("/app", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible iniciar sesión.",
      );
    } finally {
      setLoading(false);
    }
  }

  return (
    <main className="relative flex min-h-screen items-center justify-center overflow-hidden bg-zinc-950 px-5 py-12 text-white">
      <div className="absolute inset-0 bg-[radial-gradient(circle_at_25%_15%,rgba(34,211,238,.12),transparent_28%),radial-gradient(circle_at_75%_85%,rgba(251,146,60,.12),transparent_28%)]" />
      <div className="relative w-full max-w-5xl">
        <div className="mb-7 flex justify-center">
          <Brand />
        </div>
        <LoginForm error={error} loading={loading} onLogin={submit} />
        <p className="mt-6 text-center text-xs text-zinc-600">
          Registro público deshabilitado · acceso administrado por tu empresa
        </p>
        {setupRequired ? (
          <p className="mt-3 text-center text-sm text-zinc-400">
            Esta instancia aún no está configurada.{" "}
            <Link className="text-cyan-300 hover:underline" to="/setup">
              Iniciar configuración
            </Link>
          </p>
        ) : null}
      </div>
    </main>
  );
}

function SetupPage() {
  const navigate = useNavigate();
  const [checking, setChecking] = useState(true);
  const [required, setRequired] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    void getSetupStatus()
      .then(setRequired)
      .catch((caught) =>
        setError(caught instanceof Error ? caught.message : "Error inesperado."),
      )
      .finally(() => setChecking(false));
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const form = new FormData(event.currentTarget);
    setLoading(true);
    setError(null);
    try {
      await completeSetup({
        setupToken: String(form.get("setupToken") ?? ""),
        organizationName: String(form.get("organizationName") ?? ""),
        organizationSlug: String(form.get("organizationSlug") ?? ""),
        ownerName: String(form.get("ownerName") ?? ""),
        ownerEmail: String(form.get("ownerEmail") ?? ""),
        ownerPassword: String(form.get("ownerPassword") ?? ""),
      });
      navigate("/login", { replace: true });
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible completar la configuración.",
      );
    } finally {
      setLoading(false);
    }
  }

  if (checking) return <FullScreenLoading label="Comprobando instalación…" />;
  if (!required && !error) return <Navigate replace to="/login" />;

  return (
    <main className="min-h-screen bg-muted/40 px-5 py-12">
      <div className="mx-auto max-w-2xl">
        <div className="mb-8 flex justify-center">
          <Brand />
        </div>
        <Card>
          <CardHeader>
            <div className="mb-3 flex size-11 items-center justify-center rounded-2xl bg-primary text-primary-foreground">
              <LockKeyhole className="size-5" />
            </div>
            <CardTitle>Configuración inicial</CardTitle>
            <CardDescription>
              Crea la primera organización y su cuenta propietaria. Este flujo
              queda cerrado permanentemente al finalizar.
            </CardDescription>
          </CardHeader>
          <CardContent>
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
                  <FieldLabel htmlFor="setupToken">Token de instalación</FieldLabel>
                  <Input
                    autoComplete="off"
                    id="setupToken"
                    name="setupToken"
                    required
                    type="password"
                  />
                </Field>
                <div className="grid gap-5 sm:grid-cols-2">
                  <Field>
                    <FieldLabel htmlFor="organizationName">
                      Nombre de la empresa
                    </FieldLabel>
                    <Input id="organizationName" name="organizationName" required />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="organizationSlug">
                      Identificador
                    </FieldLabel>
                    <Input
                      id="organizationSlug"
                      name="organizationSlug"
                      pattern="[a-z0-9]+(?:-[a-z0-9]+)*"
                      placeholder="mi-salon"
                      required
                    />
                  </Field>
                </div>
                <Field>
                  <FieldLabel htmlFor="ownerName">Nombre del propietario</FieldLabel>
                  <Input id="ownerName" name="ownerName" required />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ownerEmail">Correo</FieldLabel>
                  <Input
                    autoComplete="email"
                    id="ownerEmail"
                    name="ownerEmail"
                    required
                    type="email"
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="ownerPassword">Contraseña</FieldLabel>
                  <Input
                    autoComplete="new-password"
                    id="ownerPassword"
                    minLength={12}
                    name="ownerPassword"
                    required
                    type="password"
                  />
                </Field>
                <Button disabled={loading} type="submit">
                  {loading && <LoaderCircle className="animate-spin" />}
                  {loading ? "Configurando…" : "Crear espacio de trabajo"}
                </Button>
              </FieldGroup>
            </form>
          </CardContent>
        </Card>
      </div>
    </main>
  );
}

function FullScreenLoading({ label }: { label: string }) {
  return (
    <main className="flex min-h-screen items-center justify-center bg-background">
      <div className="flex items-center gap-3 text-sm text-muted-foreground">
        <LoaderCircle className="size-5 animate-spin" />
        {label}
      </div>
    </main>
  );
}

function PanelPage() {
  const navigate = useNavigate();
  const [context, setContext] = useState<AppContext | null>(null);
  const [error, setError] = useState<string | null>(null);

  async function loadContext() {
    try {
      const nextContext = await getAppContext();
      setContext(nextContext);
    } catch (caught) {
      if (caught instanceof Error && caught.message === "UNAUTHENTICATED") {
        navigate("/login", { replace: true });
        return;
      }
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible cargar el panel.",
      );
    }
  }

  useEffect(() => {
    void loadContext();
  }, []);

  async function chooseOrganization(organizationId: string) {
    setError(null);
    try {
      await selectOrganization(organizationId);
      await loadContext();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "Error inesperado.");
    }
  }

  async function leave() {
    await signOut();
    navigate("/login", { replace: true });
  }

  if (!context && !error) return <FullScreenLoading label="Cargando tu espacio…" />;
  if (!context) {
    return (
      <main className="flex min-h-screen items-center justify-center p-6">
        <Card className="max-w-md">
          <CardHeader>
            <CardTitle>No pudimos abrir el panel</CardTitle>
            <CardDescription>{error}</CardDescription>
          </CardHeader>
          <CardContent>
            <Button onClick={() => void loadContext()}>Reintentar</Button>
          </CardContent>
        </Card>
      </main>
    );
  }

  if (context.requiresOrganizationSelection || !context.activeOrganization) {
    return (
      <main className="flex min-h-screen items-center justify-center bg-muted/30 p-6">
        <Card className="w-full max-w-lg">
          <CardHeader>
            <CardTitle>Elige una organización</CardTitle>
            <CardDescription>
              Validaremos tu membresía antes de cambiar el contexto activo.
            </CardDescription>
          </CardHeader>
          <CardContent className="space-y-3">
            {context.organizations.map((organization) => (
              <Button
                className="h-auto w-full justify-between p-4"
                key={organization.organizationId}
                onClick={() => void chooseOrganization(organization.organizationId)}
                variant="outline"
              >
                <span className="flex items-center gap-3">
                  <Building2 />
                  <span className="text-left">
                    <span className="block">{organization.organizationName}</span>
                    <span className="block text-xs font-normal text-muted-foreground">
                      {organization.role}
                    </span>
                  </span>
                </span>
                <ArrowRight />
              </Button>
            ))}
          </CardContent>
        </Card>
      </main>
    );
  }

  return (
    <PanelShell
      context={{ ...context, activeOrganization: context.activeOrganization }}
      onSignOut={() => void leave()}
    />
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<LandingPage />} path="/" />
        <Route element={<LoginPage />} path="/login" />
        <Route element={<SetupPage />} path="/setup" />
        {/* Fuera del panel: quien acepta todavía no tiene cuenta ni sesión. */}
        <Route element={<InvitationAcceptance />} path="/invitacion" />
        <Route element={<PanelPage />} path="/app">
          <Route element={<PanelOverview />} index />
          <Route element={<ConversationInbox />} path="conversaciones" />
          <Route element={<ContactDirectory />} path="contactos" />
          <Route element={<ServiceCatalog />} path="servicios" />
          <Route element={<PipelineBoard />} path="pipeline" />
          <Route element={<TaskList />} path="tareas" />
          <Route element={<AppointmentAgenda />} path="agenda" />
          <Route element={<TeamDirectory />} path="equipo" />
          <Route element={<Navigate replace to="/app" />} path="*" />
        </Route>
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}
