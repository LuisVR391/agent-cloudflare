import {
  CalendarClock,
  CalendarDays,
  ChevronLeft,
  ChevronRight,
  Globe,
} from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router";

import type { PanelContext } from "@/components/panel-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import {
  formatDayLabel,
  formatTime,
  instantFromZonedInput,
  shiftCivilDate,
  todayIn,
  weekDays,
  zonedDayOf,
  zonedInputValue,
} from "@/lib/agenda-time";
import {
  createAppointment,
  listAppointments,
  listContactOpportunities,
  listServices,
  listSubjectAppointments,
  listTeamMembers,
  updateAppointment,
  updateOrganizationTimeZone,
  type AgendaRange,
  type Appointment,
  type AppointmentStatus,
  type Opportunity,
  type Service,
  type TaskAssigneeFilter,
  type TeamMember,
} from "@/lib/api";

const ANY_ASSIGNEE = "all";

/**
 * Nombre de cada estado en el panel. Se exporta porque el resumen también los
 * nombra al distribuir las citas del periodo, y dos tablas distintas acabarían
 * llamando a lo mismo de dos maneras.
 */
export const statusLabels: Record<AppointmentStatus, string> = {
  requested: "Solicitada",
  pending: "Pendiente",
  confirmed: "Confirmada",
  rescheduled: "Reprogramada",
  cancelled: "Cancelada",
  completed: "Realizada",
  no_show: "No asistió",
};

/**
 * Acciones que el panel ofrece desde cada estado. Es una ayuda para no mostrar
 * botones que fallarían: el control real vive en el backend, que rechaza
 * cualquier transición no declarada aunque llegue por otro camino.
 *
 * Reprogramar no aparece aquí porque no es un botón de estado: cambia el
 * horario, y el estado lo decide el servidor a partir de ese cambio.
 */
const offeredTransitions: Record<AppointmentStatus, AppointmentStatus[]> = {
  requested: ["pending", "confirmed", "cancelled"],
  pending: ["confirmed", "cancelled", "no_show"],
  confirmed: ["completed", "no_show", "cancelled"],
  rescheduled: ["confirmed", "completed", "no_show", "cancelled"],
  cancelled: [],
  completed: [],
  no_show: [],
};

const actionLabels: Partial<Record<AppointmentStatus, string>> = {
  pending: "Agendar",
  confirmed: "Confirmar",
  completed: "Realizada",
  no_show: "No asistió",
  cancelled: "Cancelar",
};

function statusVariant(
  status: AppointmentStatus,
): "default" | "secondary" | "outline" | "destructive" {
  if (status === "cancelled" || status === "no_show") return "destructive";
  if (status === "completed") return "secondary";
  if (status === "confirmed") return "default";
  return "outline";
}

/**
 * Una cita en la agenda. La hora se muestra siempre en la zona de la empresa:
 * quien revise la agenda desde otro país debe ver la hora del salón, no la
 * suya.
 */
function AppointmentRow({
  appointment,
  timeZone,
  canManage,
  onChangeStatus,
  onReschedule,
}: {
  appointment: Appointment;
  timeZone: string;
  canManage: boolean;
  onChangeStatus: (appointment: Appointment, status: AppointmentStatus) => void;
  onReschedule: (appointment: Appointment, startsAt: string) => void;
}) {
  const [moving, setMoving] = useState(false);
  const [nextStart, setNextStart] = useState(() =>
    zonedInputValue(appointment.startsAt, timeZone),
  );
  const actions = canManage ? offeredTransitions[appointment.status] : [];

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className="font-medium">
          {formatTime(appointment.startsAt, timeZone)} –{" "}
          {formatTime(appointment.endsAt, timeZone)}
          <span className="text-muted-foreground">
            {" · "}
            {appointment.contactDisplayName ?? "Contacto sin nombre"}
          </span>
        </p>
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3" aria-hidden="true" />
            {appointment.serviceName ?? "Servicio retirado"}
          </span>
          <span>· {appointment.assigneeName ?? "Sin responsable"}</span>
          <Badge variant={statusVariant(appointment.status)}>
            {statusLabels[appointment.status]}
          </Badge>
        </div>
        {moving ? (
          <form
            className="mt-3 flex flex-wrap items-end gap-2"
            onSubmit={(event: FormEvent<HTMLFormElement>) => {
              event.preventDefault();
              const instant = instantFromZonedInput(nextStart, timeZone);
              if (!instant) return;
              onReschedule(appointment, instant);
              setMoving(false);
            }}
          >
            <Field className="min-w-52 flex-1">
              <FieldLabel htmlFor={`move-${appointment.id}`}>
                Nuevo inicio
              </FieldLabel>
              <Input
                id={`move-${appointment.id}`}
                onChange={(event) => setNextStart(event.target.value)}
                type="datetime-local"
                value={nextStart}
              />
              <FieldDescription>
                Hora de {timeZone}. La duración acordada se conserva.
              </FieldDescription>
            </Field>
            <Button size="sm" type="submit">
              Guardar
            </Button>
            <Button
              onClick={() => setMoving(false)}
              size="sm"
              type="button"
              variant="ghost"
            >
              Cancelar
            </Button>
          </form>
        ) : null}
      </div>
      {actions.length > 0 ? (
        <div className="flex flex-wrap gap-2">
          {actions.map((next) => (
            <Button
              key={next}
              onClick={() => onChangeStatus(appointment, next)}
              size="sm"
              variant={next === "cancelled" ? "ghost" : "outline"}
            >
              {actionLabels[next] ?? statusLabels[next]}
            </Button>
          ))}
          <Button
            onClick={() => {
              setNextStart(zonedInputValue(appointment.startsAt, timeZone));
              setMoving((value) => !value);
            }}
            size="sm"
            variant="outline"
          >
            Reprogramar
          </Button>
        </div>
      ) : null}
    </li>
  );
}

/**
 * Zona horaria de la organización. Vive en la agenda y no en una sección de
 * configuración porque es aquí donde se nota que está mal: si el día empieza
 * cuando no debe, la agenda muestra otro día.
 */
function TimeZoneControl({
  timeZone,
  onChange,
}: {
  timeZone: string;
  onChange: (timeZone: string) => void;
}) {
  const [value, setValue] = useState(timeZone);
  const zones =
    typeof Intl.supportedValuesOf === "function"
      ? Intl.supportedValuesOf("timeZone")
      : [];

  useEffect(() => setValue(timeZone), [timeZone]);

  if (zones.length === 0) {
    // Sin catálogo en el navegador se escribe a mano; el backend valida igual.
    return (
      <form
        className="flex items-end gap-2"
        onSubmit={(event: FormEvent<HTMLFormElement>) => {
          event.preventDefault();
          onChange(value);
        }}
      >
        <Field className="min-w-52">
          <FieldLabel htmlFor="agenda-time-zone">Zona horaria</FieldLabel>
          <Input
            id="agenda-time-zone"
            onChange={(event) => setValue(event.target.value)}
            value={value}
          />
        </Field>
        <Button size="sm" type="submit" variant="outline">
          Guardar
        </Button>
      </form>
    );
  }

  return (
    <DropdownMenu>
      <DropdownMenuTrigger asChild>
        <Button aria-label="Zona horaria de la organización" variant="outline">
          <Globe aria-hidden="true" />
          {timeZone}
        </Button>
      </DropdownMenuTrigger>
      <DropdownMenuContent align="end" className="max-h-80 w-72 overflow-y-auto">
        <DropdownMenuRadioGroup onValueChange={onChange} value={timeZone}>
          {zones.map((zone) => (
            <DropdownMenuRadioItem key={zone} value={zone}>
              {zone}
            </DropdownMenuRadioItem>
          ))}
        </DropdownMenuRadioGroup>
      </DropdownMenuContent>
    </DropdownMenu>
  );
}

/**
 * Agenda del panel. La fecha viaja como día civil y el backend la interpreta
 * con la zona de la organización: el cliente no decide dónde empieza el día.
 *
 * Las citas se crean desde la conversación, que es donde se acuerdan; aquí se
 * consultan y se llevan por su ciclo de estados.
 */
export function AppointmentAgenda() {
  const panel = useOutletContext<PanelContext>();
  const { permissions } = panel.activeOrganization;
  const canRead = permissions.includes("appointments.read");
  const canManage = permissions.includes("appointments.manage");
  const canReadTeam = permissions.includes("users.read");
  const canManageOrganization = permissions.includes("organization.manage");

  const [timeZone, setTimeZone] = useState(
    panel.activeOrganization.organizationTimeZone,
  );
  const [date, setDate] = useState(() =>
    todayIn(panel.activeOrganization.organizationTimeZone),
  );
  const [range, setRange] = useState<AgendaRange>("day");
  const [assignee, setAssignee] = useState<TaskAssigneeFilter>(ANY_ASSIGNEE);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (!canRead) return;
    setAppointments(null);
    setError(null);
    void (async () => {
      try {
        const result = await listAppointments({ date, range, assignee });
        setAppointments(result.appointments);
        setTruncated(result.truncated);
        // La zona la manda el servidor: si otra persona la corrigió, la agenda
        // se alinea sin recargar el panel entero.
        setTimeZone(result.timeZone);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar la agenda.",
        );
      }
    })();
  }, [assignee, canRead, date, range, reloadToken]);

  useEffect(() => {
    if (!canRead || !canReadTeam) return;
    void listTeamMembers()
      .then(setMembers)
      .catch(() => {
        // El equipo solo alimenta el filtro: sin él se sigue viendo todo.
      });
  }, [canRead, canReadTeam]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
      setReloadToken((token) => token + 1);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    }
  }

  if (!canRead) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <CalendarDays />
          </EmptyMedia>
          <EmptyTitle>Sin acceso a la agenda</EmptyTitle>
          <EmptyDescription>
            Pide a quien administra la organización el permiso para consultarla.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const step = range === "week" ? 7 : 1;
  const days = range === "week" ? weekDays(date) : [date];
  const selectedMember = members.find(
    (member) => member.membershipId === assignee,
  );
  const assigneeLabel =
    assignee === ANY_ASSIGNEE
      ? "Todo el equipo"
      : assignee === "me"
        ? "Mis citas"
        : (selectedMember?.name ?? "Responsable");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
      <header className="mb-6 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-semibold tracking-tight">Agenda</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Las citas del salón, en su hora local.
          </p>
        </div>
        {canManageOrganization ? (
          <TimeZoneControl
            onChange={(zone) =>
              void run(async () => {
                const organization = await updateOrganizationTimeZone(zone);
                setTimeZone(organization.timeZone);
                setDate(todayIn(organization.timeZone));
              }, "No fue posible cambiar la zona horaria.")
            }
            timeZone={timeZone}
          />
        ) : null}
      </header>

      {error ? (
        <Alert className="mb-4" variant="destructive">
          <AlertTitle>No pudimos completar la acción</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs
          onValueChange={(value) => setRange(value as AgendaRange)}
          value={range}
        >
          <TabsList>
            <TabsTrigger value="day">Día</TabsTrigger>
            <TabsTrigger value="week">Semana</TabsTrigger>
          </TabsList>
        </Tabs>
        <div className="flex items-center gap-1">
          <Button
            aria-label="Periodo anterior"
            onClick={() => setDate(shiftCivilDate(date, -step))}
            size="icon-sm"
            variant="outline"
          >
            <ChevronLeft />
          </Button>
          <Button
            onClick={() => setDate(todayIn(timeZone))}
            size="sm"
            variant="outline"
          >
            Hoy
          </Button>
          <Button
            aria-label="Periodo siguiente"
            onClick={() => setDate(shiftCivilDate(date, step))}
            size="icon-sm"
            variant="outline"
          >
            <ChevronRight />
          </Button>
        </div>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button aria-label="Filtrar por responsable" variant="outline">
              {assigneeLabel}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-56">
            <DropdownMenuRadioGroup
              onValueChange={(value) => setAssignee(value)}
              value={assignee}
            >
              <DropdownMenuRadioItem value="me">Mis citas</DropdownMenuRadioItem>
              <DropdownMenuRadioItem value={ANY_ASSIGNEE}>
                Todo el equipo
              </DropdownMenuRadioItem>
              {members.map((member) => (
                <DropdownMenuRadioItem
                  key={member.membershipId}
                  value={member.membershipId}
                >
                  {member.name}
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
      </div>

      {appointments === null && !error ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      ) : null}

      {appointments
        ? days.map((day) => {
            const ofDay = appointments.filter(
              (appointment) =>
                zonedDayOf(appointment.startsAt, timeZone) === day,
            );
            return (
              <section className="mb-6" key={day}>
                <h2 className="mb-2 text-sm font-medium capitalize">
                  {formatDayLabel(day)}
                </h2>
                {ofDay.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin citas este día.
                  </p>
                ) : (
                  <ul
                    aria-label={`Citas del ${formatDayLabel(day)}`}
                    className="flex flex-col"
                  >
                    {ofDay.map((appointment) => (
                      <AppointmentRow
                        appointment={appointment}
                        canManage={canManage}
                        key={appointment.id}
                        onChangeStatus={(item, status) =>
                          void run(
                            () =>
                              updateAppointment(item.id, {
                                expectedVersion: item.version,
                                status,
                              }),
                            "No fue posible actualizar la cita.",
                          )
                        }
                        onReschedule={(item, startsAt) =>
                          void run(
                            () =>
                              updateAppointment(item.id, {
                                expectedVersion: item.version,
                                startsAt,
                              }),
                            "No fue posible reprogramar la cita.",
                          )
                        }
                        timeZone={timeZone}
                      />
                    ))}
                  </ul>
                )}
              </section>
            );
          })
        : null}

      {truncated ? (
        <p className="mt-2 text-sm text-muted-foreground">
          Se muestran las primeras citas del periodo; acota por responsable o
          mira día por día para ver el resto.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Alta de una cita. El contacto lo pone la conversación desde la que se abre,
 * el servicio decide la duración y el responsable puede quedar pendiente.
 */
function AppointmentComposer({
  services,
  members,
  opportunities,
  defaultOpportunityId,
  timeZone,
  creating,
  onCreate,
}: {
  services: Service[];
  members: TeamMember[];
  opportunities: Opportunity[];
  defaultOpportunityId: string | null;
  timeZone: string;
  creating: boolean;
  onCreate: (input: {
    serviceId: string;
    startsAt: string;
    assigneeMembershipId?: string | null;
    opportunityId?: string | null;
    status: "pending" | "confirmed";
  }) => Promise<void>;
}) {
  const [serviceId, setServiceId] = useState("");
  const [startsAt, setStartsAt] = useState("");
  const [assignee, setAssignee] = useState("none");
  const [opportunityId, setOpportunityId] = useState(
    defaultOpportunityId ?? "none",
  );
  const [status, setStatus] = useState<"pending" | "confirmed">("pending");

  // Las oportunidades llegan después de montar el formulario, así que la
  // preselección se sincroniza cuando el hilo resuelve la suya.
  useEffect(() => {
    setOpportunityId(defaultOpportunityId ?? "none");
  }, [defaultOpportunityId]);

  const selectedService = services.find((service) => service.id === serviceId);
  const selectedMember = members.find(
    (member) => member.membershipId === assignee,
  );
  const selectedOpportunity = opportunities.find(
    (opportunity) => opportunity.id === opportunityId,
  );

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const instant = instantFromZonedInput(startsAt, timeZone);
    if (!serviceId || !instant || creating) return;
    await onCreate({
      serviceId,
      startsAt: instant,
      assigneeMembershipId: assignee === "none" ? null : assignee,
      opportunityId: opportunityId === "none" ? null : opportunityId,
      status,
    });
    setStartsAt("");
  }

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-dashed p-4"
      onSubmit={submit}
    >
      <Field>
        <FieldLabel htmlFor="appointment-service">Servicio</FieldLabel>
        <DropdownMenu>
          <DropdownMenuTrigger asChild>
            <Button
              className="w-full justify-between"
              id="appointment-service"
              type="button"
              variant="outline"
            >
              {selectedService?.name ?? "Elige un servicio"}
            </Button>
          </DropdownMenuTrigger>
          <DropdownMenuContent align="start" className="w-64">
            <DropdownMenuRadioGroup
              onValueChange={setServiceId}
              value={serviceId}
            >
              {services.map((service) => (
                <DropdownMenuRadioItem key={service.id} value={service.id}>
                  {service.name} · {service.durationMinutes} min
                </DropdownMenuRadioItem>
              ))}
            </DropdownMenuRadioGroup>
          </DropdownMenuContent>
        </DropdownMenu>
        <FieldDescription>
          Su duración decide cuándo termina la cita.
        </FieldDescription>
      </Field>
      <Field>
        <FieldLabel htmlFor="appointment-start">Inicio</FieldLabel>
        <Input
          id="appointment-start"
          onChange={(event) => setStartsAt(event.target.value)}
          type="datetime-local"
          value={startsAt}
        />
        <FieldDescription>Hora de {timeZone}.</FieldDescription>
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="appointment-assignee">Responsable</FieldLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="w-full justify-between"
                id="appointment-assignee"
                type="button"
                variant="outline"
              >
                {assignee === "none"
                  ? "Sin responsable"
                  : (selectedMember?.name ?? "Sin responsable")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup
                onValueChange={setAssignee}
                value={assignee}
              >
                <DropdownMenuRadioItem value="none">
                  Sin responsable
                </DropdownMenuRadioItem>
                {members.map((member) => (
                  <DropdownMenuRadioItem
                    key={member.membershipId}
                    value={member.membershipId}
                  >
                    {member.name}
                  </DropdownMenuRadioItem>
                ))}
              </DropdownMenuRadioGroup>
            </DropdownMenuContent>
          </DropdownMenu>
        </Field>
        {opportunities.length > 0 ? (
          <Field className="min-w-40 flex-1">
            <FieldLabel htmlFor="appointment-opportunity">Oportunidad</FieldLabel>
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button
                  className="w-full justify-between"
                  id="appointment-opportunity"
                  type="button"
                  variant="outline"
                >
                  {opportunityId === "none"
                    ? "Sin oportunidad"
                    : (selectedOpportunity?.stageName ?? "Sin oportunidad")}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="start" className="w-64">
                <DropdownMenuRadioGroup
                  onValueChange={setOpportunityId}
                  value={opportunityId}
                >
                  <DropdownMenuRadioItem value="none">
                    Sin oportunidad
                  </DropdownMenuRadioItem>
                  {opportunities.map((opportunity) => (
                    <DropdownMenuRadioItem
                      key={opportunity.id}
                      value={opportunity.id}
                    >
                      {opportunity.stageName}
                      {opportunity.serviceName ? ` · ${opportunity.serviceName}` : ""}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
            <FieldDescription>
              Enlazarla es lo que deja medir cuántas terminan en cita.
            </FieldDescription>
          </Field>
        ) : null}
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="appointment-status">Estado inicial</FieldLabel>
          <Tabs
            id="appointment-status"
            onValueChange={(value) => setStatus(value as "pending" | "confirmed")}
            value={status}
          >
            <TabsList>
              <TabsTrigger value="pending">Pendiente</TabsTrigger>
              <TabsTrigger value="confirmed">Confirmada</TabsTrigger>
            </TabsList>
          </Tabs>
        </Field>
      </div>
      <Button
        className="self-start"
        disabled={!serviceId || !startsAt || creating}
        type="submit"
      >
        {creating ? "Agendando…" : "Agendar cita"}
      </Button>
    </form>
  );
}

/**
 * Citas de la conversación. Es donde se acuerdan, así que es donde se agendan:
 * lo que se cree aquí conserva este hilo como origen. Como el resto de paneles,
 * no consulta hasta abrirse.
 *
 * También conserva la oportunidad, cuando el hilo abrió una. Ese enlace no es
 * decorativo: es lo que permite medir cuántas oportunidades terminan en cita
 * sin atribuirle a una venta la cita que salió de otra.
 */
export function AppointmentSheet({
  contactId,
  conversationId,
  timeZone,
  canManage,
  canReadTeam,
  canReadOpportunities,
}: {
  contactId: string;
  conversationId: string;
  timeZone: string;
  canManage: boolean;
  canReadTeam: boolean;
  canReadOpportunities: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [appointments, setAppointments] = useState<Appointment[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const subject = { type: "conversation" as const, id: conversationId };
  // La oportunidad que nació en este hilo es la que se propone; el resto del
  // contacto sigue disponible por si la cita pertenece a otra.
  const suggestedOpportunity =
    opportunities.find(
      (opportunity) => opportunity.conversationId === conversationId,
    )?.id ?? null;

  useEffect(() => {
    if (!open) return;
    setAppointments(null);
    setError(null);
    void (async () => {
      try {
        setAppointments(await listSubjectAppointments(subject));
        if (canManage) {
          setServices(await listServices("active"));
          if (canReadTeam) setMembers(await listTeamMembers());
          if (canReadOpportunities) {
            setOpportunities(await listContactOpportunities(contactId));
          }
        }
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las citas.",
        );
      }
    })();
  }, [
    canManage,
    canReadOpportunities,
    canReadTeam,
    contactId,
    conversationId,
    open,
  ]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
      setAppointments(await listSubjectAppointments(subject));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    }
  }

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <CalendarDays aria-hidden="true" />
          Citas
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Citas de la conversación</SheetTitle>
          <SheetDescription>
            Lo que se agende aquí conserva este hilo como origen y aparece en la
            agenda del salón, en su hora local.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>No pudimos completar la acción</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {appointments === null && !error ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-2/3" />
            </div>
          ) : null}

          {appointments?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta conversación todavía no tiene citas.
            </p>
          ) : null}

          {appointments && appointments.length > 0 ? (
            <ul
              aria-label="Citas de la conversación"
              className="flex flex-col"
            >
              {appointments.map((appointment) => (
                <li className="border-b py-3 last:border-b-0" key={appointment.id}>
                  <p className="font-medium">
                    {formatDayLabel(
                      zonedDayOf(appointment.startsAt, timeZone),
                      { day: "numeric", month: "short" },
                    )}
                    {" · "}
                    {formatTime(appointment.startsAt, timeZone)}
                  </p>
                  <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
                    <span>{appointment.serviceName ?? "Servicio retirado"}</span>
                    <span>· {appointment.assigneeName ?? "Sin responsable"}</span>
                    <Badge variant={statusVariant(appointment.status)}>
                      {statusLabels[appointment.status]}
                    </Badge>
                  </div>
                </li>
              ))}
            </ul>
          ) : null}

          {canManage ? (
            <AppointmentComposer
              creating={creating}
              defaultOpportunityId={suggestedOpportunity}
              members={members}
              opportunities={opportunities}
              onCreate={async (input) => {
                setCreating(true);
                await run(
                  () =>
                    createAppointment({
                      ...input,
                      contactId,
                      conversationId,
                    }),
                  "No fue posible agendar la cita.",
                );
                setCreating(false);
              }}
              services={services}
              timeZone={timeZone}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
