import { CalendarClock, CheckCircle2, ListTodo, RotateCcw } from "lucide-react";
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
  createTask,
  listSubjectTasks,
  listTasks,
  listTeamMembers,
  updateTask,
  type Task,
  type TaskAssigneeFilter,
  type TaskStatus,
  type TaskSubject,
  type TeamMember,
} from "@/lib/api";

const ANY_ASSIGNEE = "all";

const subjectLabels: Record<NonNullable<TaskSubject>["type"], string> = {
  contact: "Contacto",
  conversation: "Conversación",
  opportunity: "Oportunidad",
};

/** El vencimiento se lee como fecha con hora; sin él, la tarea no tiene plazo. */
function formatDue(value: string | null): string {
  if (value === null) return "Sin fecha";
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/** Vencida es solo lo pendiente con fecha pasada; lo cerrado ya no vence. */
function isOverdue(task: Task): boolean {
  return (
    task.status === "open" &&
    task.dueAt !== null &&
    new Date(task.dueAt).getTime() < Date.now()
  );
}

/**
 * `datetime-local` entrega hora local sin zona. Se convierte al instante UTC
 * que el Worker persiste; la zona horaria de la organización llega con las
 * citas (#38).
 */
function toInstant(localValue: string): string | null {
  if (!localValue) return null;
  const parsed = new Date(localValue);
  return Number.isNaN(parsed.getTime()) ? null : parsed.toISOString();
}

function TaskRow({
  task,
  canManage,
  onToggle,
}: {
  task: Task;
  canManage: boolean;
  onToggle: (task: Task) => void;
}) {
  const closed = task.status !== "open";

  return (
    <li className="flex flex-wrap items-start justify-between gap-3 border-b py-3 last:border-b-0">
      <div className="min-w-0 flex-1">
        <p className={closed ? "font-medium line-through" : "font-medium"}>
          {task.title}
        </p>
        {task.details ? (
          <p className="mt-1 text-sm whitespace-pre-wrap text-muted-foreground">
            {task.details}
          </p>
        ) : null}
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs text-muted-foreground">
          <span className="flex items-center gap-1">
            <CalendarClock className="size-3" aria-hidden="true" />
            {formatDue(task.dueAt)}
          </span>
          <span>· {task.assigneeName ?? "Sin responsable resuelto"}</span>
          {task.subject ? (
            <Badge variant="outline">
              {subjectLabels[task.subject.type]}
              {task.subjectLabel ? `: ${task.subjectLabel}` : null}
            </Badge>
          ) : null}
          {isOverdue(task) ? <Badge variant="destructive">Vencida</Badge> : null}
        </div>
      </div>
      {canManage ? (
        <Button
          aria-label={closed ? `Reabrir ${task.title}` : `Cerrar ${task.title}`}
          onClick={() => onToggle(task)}
          size="sm"
          variant={closed ? "ghost" : "outline"}
        >
          {closed ? (
            <>
              <RotateCcw aria-hidden="true" /> Reabrir
            </>
          ) : (
            <>
              <CheckCircle2 aria-hidden="true" /> Cerrar
            </>
          )}
        </Button>
      ) : null}
    </li>
  );
}

/**
 * Formulario de alta. El responsable se elige entre el equipo; dejarlo en
 * «Yo» hace que el Worker use la membresía de la sesión.
 */
function TaskComposer({
  members,
  onCreate,
  creating,
}: {
  members: TeamMember[];
  onCreate: (input: {
    title: string;
    details?: string | null;
    assigneeMembershipId?: string;
    dueAt?: string | null;
  }) => Promise<void>;
  creating: boolean;
}) {
  const [title, setTitle] = useState("");
  const [details, setDetails] = useState("");
  const [assignee, setAssignee] = useState("me");
  const [dueAt, setDueAt] = useState("");

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const trimmed = title.trim();
    if (!trimmed || creating) return;
    await onCreate({
      title: trimmed,
      details: details.trim() || null,
      assigneeMembershipId: assignee === "me" ? undefined : assignee,
      dueAt: toInstant(dueAt),
    });
    setTitle("");
    setDetails("");
    setDueAt("");
  }

  const selectedMember = members.find(
    (member) => member.membershipId === assignee,
  );

  return (
    <form
      className="flex flex-col gap-3 rounded-xl border border-dashed p-4"
      onSubmit={submit}
    >
      <Field>
        <FieldLabel htmlFor="task-title">Tarea</FieldLabel>
        <Input
          id="task-title"
          maxLength={200}
          onChange={(event) => setTitle(event.target.value)}
          placeholder="Qué hay que hacer"
          value={title}
        />
      </Field>
      <Field>
        <FieldLabel htmlFor="task-details">Detalle</FieldLabel>
        <textarea
          className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-16 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px]"
          id="task-details"
          maxLength={2000}
          onChange={(event) => setDetails(event.target.value)}
          placeholder="Lo que conviene saber para hacerla"
          value={details}
        />
      </Field>
      <div className="flex flex-wrap gap-3">
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="task-assignee">Responsable</FieldLabel>
          <DropdownMenu>
            <DropdownMenuTrigger asChild>
              <Button
                className="w-full justify-between"
                id="task-assignee"
                type="button"
                variant="outline"
              >
                {assignee === "me" ? "Yo" : (selectedMember?.name ?? "Yo")}
              </Button>
            </DropdownMenuTrigger>
            <DropdownMenuContent align="start" className="w-56">
              <DropdownMenuRadioGroup
                onValueChange={setAssignee}
                value={assignee}
              >
                <DropdownMenuRadioItem value="me">Yo</DropdownMenuRadioItem>
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
        <Field className="min-w-40 flex-1">
          <FieldLabel htmlFor="task-due">Vencimiento</FieldLabel>
          <Input
            id="task-due"
            onChange={(event) => setDueAt(event.target.value)}
            type="datetime-local"
            value={dueAt}
          />
          <FieldDescription>Opcional.</FieldDescription>
        </Field>
      </div>
      <Button className="self-start" disabled={!title.trim() || creating} type="submit">
        {creating ? "Creando…" : "Crear tarea"}
      </Button>
    </form>
  );
}

/**
 * Pantalla de tareas. El filtro por responsable manda `me` al backend, que lo
 * resuelve con la membresía de la sesión: el cliente no envía su identificador
 * ni podría demostrarlo.
 */
export function TaskList() {
  const panel = useOutletContext<PanelContext>();
  const canRead = panel.activeOrganization.permissions.includes("tasks.read");
  const canManage = panel.activeOrganization.permissions.includes("tasks.manage");
  const canReadTeam = panel.activeOrganization.permissions.includes("users.read");

  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [assignee, setAssignee] = useState<TaskAssigneeFilter>("me");
  const [status, setStatus] = useState<TaskStatus | "all">("open");
  const [creating, setCreating] = useState(false);
  const [truncated, setTruncated] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function reload() {
    const result = await listTasks({
      assignee,
      status: status === "all" ? undefined : status,
    });
    setTasks(result.tasks);
    setTruncated(result.truncated);
  }

  useEffect(() => {
    if (!canRead) return;
    setTasks(null);
    setError(null);
    void (async () => {
      try {
        const result = await listTasks({
          assignee,
          status: status === "all" ? undefined : status,
        });
        setTasks(result.tasks);
        setTruncated(result.truncated);
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las tareas.",
        );
      }
    })();
  }, [assignee, canRead, status]);

  useEffect(() => {
    if (!canRead || !canReadTeam) return;
    void listTeamMembers()
      .then(setMembers)
      .catch(() => {
        // El equipo solo alimenta los selectores: sin él se puede seguir
        // trabajando con «Yo» y «Todas».
      });
  }, [canRead, canReadTeam]);

  async function create(input: {
    title: string;
    details?: string | null;
    assigneeMembershipId?: string;
    dueAt?: string | null;
  }) {
    setCreating(true);
    setError(null);
    try {
      await createTask(input);
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible crear la tarea.",
      );
    } finally {
      setCreating(false);
    }
  }

  async function toggle(task: Task) {
    setError(null);
    try {
      await updateTask(task.id, {
        expectedVersion: task.version,
        status: task.status === "open" ? "done" : "open",
      });
      await reload();
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible actualizar la tarea.",
      );
    }
  }

  if (!canRead) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <ListTodo />
          </EmptyMedia>
          <EmptyTitle>Sin acceso a las tareas</EmptyTitle>
          <EmptyDescription>
            Pide a quien administra la organización el permiso para consultarlas.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const selectedMember = members.find(
    (member) => member.membershipId === assignee,
  );
  const assigneeLabel =
    assignee === ANY_ASSIGNEE
      ? "Todo el equipo"
      : assignee === "me"
        ? "Mis tareas"
        : (selectedMember?.name ?? "Responsable");

  return (
    <div className="flex min-h-0 flex-1 flex-col overflow-y-auto p-4 sm:p-6">
      <header className="mb-6">
        <h1 className="text-2xl font-semibold tracking-tight">Tareas</h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Lo que quedó pendiente, con responsable y vencimiento.
        </p>
      </header>

      {error ? (
        <Alert className="mb-4" variant="destructive">
          <AlertTitle>No pudimos completar la acción</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      <div className="mb-4 flex flex-wrap items-center gap-3">
        <Tabs onValueChange={(value) => setStatus(value as TaskStatus | "all")} value={status}>
          <TabsList>
            <TabsTrigger value="open">Pendientes</TabsTrigger>
            <TabsTrigger value="done">Cerradas</TabsTrigger>
            <TabsTrigger value="all">Todas</TabsTrigger>
          </TabsList>
        </Tabs>
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
              <DropdownMenuRadioItem value="me">Mis tareas</DropdownMenuRadioItem>
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

      {canManage ? (
        <div className="mb-6">
          <TaskComposer creating={creating} members={members} onCreate={create} />
        </div>
      ) : null}

      {tasks === null && !error ? (
        <div className="flex flex-col gap-3">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      ) : null}

      {tasks?.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <ListTodo />
            </EmptyMedia>
            <EmptyTitle>Nada pendiente aquí</EmptyTitle>
            <EmptyDescription>
              Cambia el filtro o crea la primera tarea de este responsable.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : null}

      {tasks && tasks.length > 0 ? (
        <ul aria-label="Tareas" className="flex flex-col">
          {tasks.map((task) => (
            <TaskRow
              canManage={canManage}
              key={task.id}
              onToggle={(item) => void toggle(item)}
              task={task}
            />
          ))}
        </ul>
      ) : null}

      {truncated ? (
        <p className="mt-4 text-sm text-muted-foreground">
          Se muestran las primeras tareas del filtro; acota por responsable o
          estado para ver el resto.
        </p>
      ) : null}
    </div>
  );
}

/**
 * Tareas de un sujeto, abiertas desde la conversación. Lo que se cree aquí
 * cuelga de ese hilo, así que la tarea explica de dónde salió.
 */
export function TaskSheet({
  subject,
  canManage,
  canReadTeam,
}: {
  subject: NonNullable<TaskSubject>;
  canManage: boolean;
  canReadTeam: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [tasks, setTasks] = useState<Task[] | null>(null);
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setTasks(null);
    setError(null);
    void (async () => {
      try {
        setTasks(await listSubjectTasks(subject));
        if (canManage && canReadTeam) setMembers(await listTeamMembers());
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las tareas.",
        );
      }
    })();
  }, [canManage, canReadTeam, open, subject.id, subject.type]);

  async function run(action: () => Promise<unknown>, fallback: string) {
    setError(null);
    try {
      await action();
      setTasks(await listSubjectTasks(subject));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    }
  }

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <ListTodo aria-hidden="true" />
          Tareas
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Tareas de la conversación</SheetTitle>
          <SheetDescription>
            Lo que quede pendiente aquí conserva este hilo como origen y aparece
            en la lista de su responsable.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>No pudimos completar la acción</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {tasks === null && !error ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-12 w-full" />
              <Skeleton className="h-12 w-2/3" />
            </div>
          ) : null}

          {tasks?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Esta conversación todavía no tiene tareas.
            </p>
          ) : null}

          {tasks && tasks.length > 0 ? (
            <ul aria-label="Tareas de la conversación" className="flex flex-col">
              {tasks.map((task) => (
                <TaskRow
                  canManage={canManage}
                  key={task.id}
                  onToggle={(item) =>
                    void run(
                      () =>
                        updateTask(item.id, {
                          expectedVersion: item.version,
                          status: item.status === "open" ? "done" : "open",
                        }),
                      "No fue posible actualizar la tarea.",
                    )
                  }
                  task={task}
                />
              ))}
            </ul>
          ) : null}

          {canManage ? (
            <TaskComposer
              creating={creating}
              members={members}
              onCreate={async (input) => {
                setCreating(true);
                await run(
                  () => createTask({ ...input, subject }),
                  "No fue posible crear la tarea.",
                );
                setCreating(false);
              }}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
