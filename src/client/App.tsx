import {
  ArrowRight,
  Bot,
  Building2,
  CheckCircle2,
  ChevronDown,
  CircleGauge,
  Clock3,
  Inbox,
  LoaderCircle,
  LockKeyhole,
  LogOut,
  MessageCircleMore,
  Settings2,
  ShieldCheck,
  Sparkles,
  Users,
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

import { LoginForm } from "@/components/login-form";
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

const navigation = [
  { label: "Resumen", icon: CircleGauge, available: true },
  { label: "Conversaciones", icon: Inbox, available: false },
  { label: "Agentes", icon: Bot, available: false },
  { label: "Equipo", icon: Users, available: false },
  { label: "Configuración", icon: Settings2, available: false },
];

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

  const active = context.activeOrganization;
  return (
    <div className="min-h-screen bg-muted/35 lg:grid lg:grid-cols-[260px_1fr]">
      <aside className="border-b bg-zinc-950 p-5 text-white lg:min-h-screen lg:border-b-0 lg:border-r lg:border-white/10">
        <Brand />
        <div className="mt-8 rounded-xl border border-white/10 bg-white/5 p-3">
          <p className="truncate text-sm font-medium">{active.organizationName}</p>
          <p className="mt-1 text-xs capitalize text-zinc-500">{active.role}</p>
        </div>
        <nav className="mt-6 grid grid-cols-2 gap-1 sm:grid-cols-5 lg:grid-cols-1">
          {navigation.map(({ label, icon: Icon, available }) => (
            <button
              className={`flex items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm ${
                available
                  ? "bg-white/10 text-white"
                  : "cursor-not-allowed text-zinc-600"
              }`}
              disabled={!available}
              key={label}
              type="button"
            >
              <Icon className="size-4" />
              <span>{label}</span>
              {!available && (
                <span className="ml-auto hidden text-[10px] uppercase lg:block">
                  Planeado
                </span>
              )}
            </button>
          ))}
        </nav>
        <Button
          className="mt-6 w-full justify-start text-zinc-400 hover:bg-white/10 hover:text-white lg:mt-12"
          onClick={() => void leave()}
          variant="ghost"
        >
          <LogOut /> Cerrar sesión
        </Button>
      </aside>
      <main className="p-5 sm:p-8 lg:p-10">
        <header className="flex flex-col justify-between gap-4 sm:flex-row sm:items-center">
          <div>
            <p className="text-sm text-muted-foreground">Panel administrativo</p>
            <h1 className="mt-1 text-3xl font-semibold tracking-tight">
              Hola, {context.user.name.split(" ")[0]}
            </h1>
          </div>
          <button
            className="flex items-center gap-3 self-start rounded-full border bg-background py-1.5 pl-1.5 pr-3 text-sm shadow-xs"
            type="button"
          >
            <span className="flex size-8 items-center justify-center rounded-full bg-primary text-xs font-semibold text-primary-foreground">
              {context.user.name.slice(0, 2).toUpperCase()}
            </span>
            <span className="max-w-40 truncate">{context.user.email}</span>
            <ChevronDown className="size-4 text-muted-foreground" />
          </button>
        </header>
        {error ? (
          <div className="mt-6 rounded-xl border border-destructive/30 bg-destructive/10 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        ) : null}
        <section className="mt-8 grid gap-4 md:grid-cols-3">
          {([
            ["Conversaciones abiertas", "—", MessageCircleMore],
            ["Esperando respuesta", "—", Clock3],
            ["Agentes configurados", "—", Bot],
          ] as const).map(([label, value, Icon]) => (
            <Card key={String(label)}>
              <CardHeader className="flex flex-row items-center justify-between">
                <CardDescription>{label}</CardDescription>
                <Icon className="size-4 text-muted-foreground" />
              </CardHeader>
              <CardContent>
                <p className="text-3xl font-semibold">{value}</p>
                <p className="mt-2 text-xs text-muted-foreground">
                  Disponible en la etapa correspondiente
                </p>
              </CardContent>
            </Card>
          ))}
        </section>
        <section className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_.6fr]">
          <Card>
            <CardHeader>
              <CardTitle>Base administrativa lista</CardTitle>
              <CardDescription>
                El acceso y el contexto organizacional ya protegen las futuras
                capacidades.
              </CardDescription>
            </CardHeader>
            <CardContent className="space-y-4">
              {[
                "Sesión segura persistida en D1",
                "Organización activa validada en backend",
                `Rol ${active.role} con permisos efectivos`,
              ].map((item) => (
                <div className="flex items-center gap-3 text-sm" key={item}>
                  <CheckCircle2 className="size-5 text-emerald-600" />
                  {item}
                </div>
              ))}
            </CardContent>
          </Card>
          <Card className="bg-zinc-950 text-white">
            <CardHeader>
              <Sparkles className="mb-2 size-5 text-cyan-300" />
              <CardTitle>Próxima etapa</CardTitle>
              <CardDescription className="text-zinc-500">
                El panel de conversaciones y agentes se habilitará cuando sus
                issues entren en fase activa.
              </CardDescription>
            </CardHeader>
          </Card>
        </section>
      </main>
    </div>
  );
}

export function App() {
  return (
    <BrowserRouter>
      <Routes>
        <Route element={<LandingPage />} path="/" />
        <Route element={<LoginPage />} path="/login" />
        <Route element={<SetupPage />} path="/setup" />
        <Route element={<PanelPage />} path="/app/*" />
        <Route element={<Navigate replace to="/" />} path="*" />
      </Routes>
    </BrowserRouter>
  );
}
