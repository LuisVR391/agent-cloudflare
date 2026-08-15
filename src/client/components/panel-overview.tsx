import {
  CalendarCheck,
  ChartNoAxesColumn,
  Clock3,
  Contact,
  KanbanSquare,
  MessageCircleMore,
  UserRound,
} from "lucide-react";
import { useEffect, useState, type FormEvent, type ReactNode } from "react";
import { useOutletContext } from "react-router";

import { statusLabels } from "@/components/appointment-agenda";
import type { PanelContext } from "@/components/panel-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { formatDayLabel, shiftCivilDate, todayIn } from "@/lib/agenda-time";
import { getMetricsSummary, type MetricsSummary } from "@/lib/api";

const PRESETS = [
  { value: "7", label: "7 días" },
  { value: "30", label: "30 días" },
  { value: "90", label: "90 días" },
] as const;

type Preset = (typeof PRESETS)[number]["value"] | "custom";

/** Los últimos `days` días de la empresa, con hoy incluido. */
function lastDays(days: number, timeZone: string) {
  const today = todayIn(timeZone);
  return { from: shiftCivilDate(today, -(days - 1)), to: today };
}

/**
 * Una espera se lee en minutos hasta que deja de caber en la cabeza. A partir
 * de una hora, «1 h 25 min» dice más que «85 min».
 */
function formatMinutes(value: number | null): string {
  if (value === null) return "—";
  const total = Math.round(value);
  if (total < 60) return `${total} min`;
  const hours = Math.floor(total / 60);
  const minutes = total % 60;
  return minutes === 0 ? `${hours} h` : `${hours} h ${minutes} min`;
}

function Metric({
  label,
  value,
  hint,
  icon: Icon,
}: {
  label: string;
  value: string;
  hint: string;
  icon: typeof MessageCircleMore;
}) {
  return (
    <Card>
      <CardHeader className="flex flex-row items-center justify-between">
        <CardDescription>{label}</CardDescription>
        <Icon aria-hidden="true" className="size-4 text-muted-foreground" />
      </CardHeader>
      <CardContent>
        <p className="text-3xl font-semibold">{value}</p>
        <p className="mt-2 text-xs text-muted-foreground">{hint}</p>
      </CardContent>
    </Card>
  );
}

/** Distribución con su propio total; sin filas, lo dice en vez de dibujar nada. */
function Breakdown({
  title,
  description,
  rows,
  empty,
  children,
}: {
  title: string;
  description: string;
  rows: { key: string; label: string; count: number }[];
  empty: string;
  children?: ReactNode;
}) {
  const total = rows.reduce((sum, row) => sum + row.count, 0);

  return (
    <Card>
      <CardHeader>
        <CardTitle>{title}</CardTitle>
        <CardDescription>{description}</CardDescription>
      </CardHeader>
      <CardContent className="flex flex-col gap-3">
        {children}
        {rows.length === 0 ? (
          <p className="text-sm text-muted-foreground">{empty}</p>
        ) : (
          <ul className="flex flex-col gap-2">
            {rows.map((row) => (
              <li className="flex flex-col gap-1" key={row.key}>
                <div className="flex items-baseline justify-between gap-3 text-sm">
                  <span>{row.label}</span>
                  <span className="font-medium tabular-nums">{row.count}</span>
                </div>
                <div className="h-1.5 overflow-hidden rounded-full bg-muted">
                  <div
                    className="h-full rounded-full bg-primary"
                    style={{
                      width: `${total === 0 ? 0 : (row.count / total) * 100}%`,
                    }}
                  />
                </div>
              </li>
            ))}
          </ul>
        )}
      </CardContent>
    </Card>
  );
}


/**
 * Tablero de métricas de un periodo.
 *
 * Cada cifra es una lectura del historial, calculada en el backend para la
 * organización activa
 * ([ADR-0012](../../../.docs/decisions/ADR-0012-initial-metrics.md)). El periodo
 * viaja como dos días civiles y lo interpreta la zona horaria de la empresa: el
 * navegador de quien mira no decide dónde empieza un día del salón.
 *
 * Un periodo sin actividad lo dice. Antes había tres tarjetas con un guion y la
 * promesa de una etapa futura, y eso es exactamente lo que un resumen no debe
 * hacer: aparentar una cifra que nadie midió.
 */
function MetricsBoard({ timeZone }: { timeZone: string }) {
  const [preset, setPreset] = useState<Preset>("30");
  const [range, setRange] = useState(() => lastDays(30, timeZone));
  const [draft, setDraft] = useState(() => lastDays(30, timeZone));
  const [summary, setSummary] = useState<MetricsSummary | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setSummary(null);
    setError(null);
    void (async () => {
      try {
        setSummary(await getMetricsSummary(range));
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las métricas.",
        );
      }
    })();
  }, [range]);

  function choosePreset(value: string) {
    setPreset(value as Preset);
    if (value === "custom") return;
    const next = lastDays(Number(value), timeZone);
    setDraft(next);
    setRange(next);
  }

  const operations = summary?.operations;
  const commercial = summary?.commercial;
  const opportunities = commercial?.opportunities;
  const conversion =
    opportunities && opportunities.created > 0
      ? Math.round((opportunities.withAppointment / opportunities.created) * 100)
      : null;
  // «Sin actividad» es una afirmación sobre el periodo, no sobre una tarjeta:
  // solo se dice cuando ninguna de las fuentes tuvo nada que contar.
  const empty =
    summary !== null &&
    operations!.messagesReceived === 0 &&
    operations!.activeConversations === 0 &&
    operations!.humanInterventions.replies === 0 &&
    commercial!.newContacts === 0 &&
    opportunities!.created === 0 &&
    commercial!.appointmentsByStatus.length === 0;

  return (
    <>
      <section aria-label="Periodo" className="mt-6 flex flex-wrap items-end gap-3">
        <Tabs onValueChange={choosePreset} value={preset}>
          <TabsList>
            {PRESETS.map((option) => (
              <TabsTrigger key={option.value} value={option.value}>
                {option.label}
              </TabsTrigger>
            ))}
            <TabsTrigger value="custom">Elegir</TabsTrigger>
          </TabsList>
        </Tabs>
        {preset === "custom" ? (
          <form
            className="flex flex-wrap items-end gap-2"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              setRange(draft);
            }}
          >
            <Field className="w-40">
              <FieldLabel htmlFor="metrics-from">Desde</FieldLabel>
              <Input
                id="metrics-from"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, from: event.target.value }))
                }
                type="date"
                value={draft.from}
              />
            </Field>
            <Field className="w-40">
              <FieldLabel htmlFor="metrics-to">Hasta</FieldLabel>
              <Input
                id="metrics-to"
                onChange={(event) =>
                  setDraft((current) => ({ ...current, to: event.target.value }))
                }
                type="date"
                value={draft.to}
              />
            </Field>
            <Button size="sm" type="submit" variant="outline">
              Aplicar
            </Button>
          </form>
        ) : null}
      </section>

      <p className="mt-3 text-sm text-muted-foreground">
        Del {formatDayLabel(range.from, { day: "numeric", month: "long" })} al{" "}
        {formatDayLabel(range.to, {
          day: "numeric",
          month: "long",
          year: "numeric",
        })}
      </p>

      {error ? (
        <Alert className="mt-4" variant="destructive">
          <AlertTitle>No pudimos cargar las métricas</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {summary === null && !error ? (
        <div className="mt-6 grid gap-4 md:grid-cols-2 lg:grid-cols-4">
          {[0, 1, 2, 3].map((index) => (
            <Skeleton className="h-32 w-full" key={index} />
          ))}
        </div>
      ) : null}

      {summary && empty ? (
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesColumn />
            </EmptyMedia>
            <EmptyTitle>Sin actividad en este periodo</EmptyTitle>
            <EmptyDescription>
              No hubo mensajes, contactos nuevos ni citas entre estas dos fechas.
              Amplía el periodo para ver un tramo con movimiento.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {summary && !empty ? (
        <>
          <section aria-label="Operación" className="mt-6">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Operación
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Metric
                hint="Mensajes que entraron por el canal."
                icon={MessageCircleMore}
                label="Mensajes recibidos"
                value={operations!.messagesReceived.toLocaleString()}
              />
              <Metric
                hint="Conversaciones con al menos un mensaje."
                icon={Contact}
                label="Conversaciones activas"
                value={operations!.activeConversations.toLocaleString()}
              />
              <Metric
                hint={
                  operations!.firstResponse.answered === 0
                    ? "Todavía no hay turnos respondidos en el periodo."
                    : `Mediana de ${operations!.firstResponse.answered} turnos; ${operations!.firstResponse.pending} siguen esperando.`
                }
                icon={Clock3}
                label="Primera respuesta"
                value={formatMinutes(operations!.firstResponse.medianMinutes)}
              />
              <Metric
                hint={`Respuestas del equipo en ${operations!.humanInterventions.conversations} conversaciones.`}
                icon={UserRound}
                label="Intervenciones humanas"
                value={operations!.humanInterventions.replies.toLocaleString()}
              />
            </div>
          </section>

          <section aria-label="Comercial" className="mt-6">
            <h2 className="mb-3 text-sm font-medium text-muted-foreground">
              Comercial
            </h2>
            <div className="grid gap-4 md:grid-cols-2 lg:grid-cols-4">
              <Metric
                hint="Personas que aparecieron por primera vez."
                icon={Contact}
                label="Contactos nuevos"
                value={commercial!.newContacts.toLocaleString()}
              />
              <Metric
                hint="Oportunidades abiertas en el periodo."
                icon={KanbanSquare}
                label="Oportunidades"
                value={opportunities!.created.toLocaleString()}
              />
              <Metric
                hint={
                  conversion === null
                    ? "Sin oportunidades abiertas que convertir."
                    : `${opportunities!.withAppointment} de ${opportunities!.created} llegaron a una cita.`
                }
                icon={CalendarCheck}
                label="Conversión a cita"
                value={conversion === null ? "—" : `${conversion} %`}
              />
              <Metric
                hint="Citas que ocurren dentro del periodo."
                icon={CalendarCheck}
                label="Citas del periodo"
                value={commercial!.appointmentsByStatus
                  .reduce((total, row) => total + row.count, 0)
                  .toLocaleString()}
              />
            </div>
          </section>

          <section className="mt-6 grid gap-4 lg:grid-cols-2">
            <Breakdown
              description="Dónde está lo que se abrió en el periodo."
              empty="No se abrió ninguna oportunidad en este periodo."
              rows={opportunities!.byStage.map((stage) => ({
                key: stage.stageId,
                label: `${stage.stageName} · ${stage.pipelineName}`,
                count: stage.count,
              }))}
              title="Oportunidades por etapa"
            />
            <Breakdown
              description="Cómo terminaron las citas agendadas para estas fechas."
              empty="No hay citas agendadas en este periodo."
              rows={commercial!.appointmentsByStatus.map((row) => ({
                key: row.status,
                label: statusLabels[row.status],
                count: row.count,
              }))}
              title="Citas por estado"
            />
          </section>
        </>
      ) : null}
    </>
  );
}

/**
 * Inicio del panel. La bienvenida y el periodo permanecen aunque no haya
 * permiso para leer las métricas: quien entra sigue llegando a su panel, y lo
 * que falta se explica en vez de dejar la pantalla en blanco.
 */
export function PanelOverview() {
  const context = useOutletContext<PanelContext>();
  const active = context.activeOrganization;
  const canRead = active.permissions.includes("metrics.read");

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header>
        <p className="text-sm text-muted-foreground">Panel administrativo</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Hola, {context.user.name.split(" ")[0]}
        </h1>
        <p className="mt-2 text-sm text-muted-foreground">
          Lo que ocurrió en {active.organizationName} durante el periodo, en la
          hora de {active.organizationTimeZone}.
        </p>
      </header>

      {canRead ? (
        <MetricsBoard timeZone={active.organizationTimeZone} />
      ) : (
        <Empty className="mt-6">
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ChartNoAxesColumn />
            </EmptyMedia>
            <EmptyTitle>Sin acceso a las métricas</EmptyTitle>
            <EmptyDescription>
              Pide a quien administra la organización el permiso para
              consultarlas.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      )}
    </div>
  );
}
