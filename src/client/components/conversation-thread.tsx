import {
  ArrowLeft,
  Bot,
  MessageCircleMore,
  Pause,
  Send,
  UserRound,
  UserRoundCheck,
} from "lucide-react";
import { useEffect, type ChangeEvent } from "react";

import {
  ConversationMessageRow,
  SystemNote,
  type MessageAuthor,
} from "@/components/conversation-message";
import { AppointmentSheet } from "@/components/appointment-agenda";
import { NoteSheet } from "@/components/contact-notes";
import { ContactSheet } from "@/components/contact-sheet";
import { DevInboundButton } from "@/components/dev-inbound-button";
import { OpportunitySheet } from "@/components/opportunity-sheet";
import { TaskSheet } from "@/components/task-list";
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
import { Marker, MarkerContent } from "@/components/ui/marker";
import {
  MessageScroller,
  MessageScrollerButton,
  MessageScrollerContent,
  MessageScrollerItem,
  MessageScrollerProvider,
  MessageScrollerViewport,
  useMessageScrollerVisibility,
} from "@/components/ui/message-scroller";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type {
  AgentSummary,
  ConversationAgent,
  ConversationMessage,
  ConversationSummary,
  TeamMember,
} from "@/lib/api";

const statusLabels: Record<ConversationSummary["status"], string> = {
  open: "Abierta",
  resolved: "Resuelta",
};

/**
 * Una fila por mensaje, con la posición que ocupa dentro de su bloque de autor.
 *
 * El scroller detecta que se prependió historial comparando la identidad del
 * nodo que era el primer hijo. Un item por bloque no sirve: al prepender, el
 * bloque frontera gana mensajes más antiguos, cambia su primer mensaje y con él
 * su clave, React remonta el nodo y la compensación de scroll no se aplica. No
 * existe identidad de bloque estable, porque prepender cambia su primer mensaje
 * y añadir cambia el último; la del mensaje sí lo es.
 */
export type ThreadRow = {
  message: ConversationMessage;
  author: MessageAuthor | null;
  dayLabel: string | null;
  startsGroup: boolean;
  endsGroup: boolean;
};

/**
 * Resuelve quién firma un mensaje. Un saliente propio se atribuye a la persona
 * de la sesión; el de otro colaborador, a su nombre en el directorio del
 * equipo. Sigue anunciándose como equipo cuando ese directorio no está
 * disponible —la sesión no puede leerlo o quien envió ya no aparece—, porque
 * atribuirlo a la cuenta actual sería falso.
 *
 * Un saliente del agente lleva su nombre cuando sigue siendo el que atiende la
 * conversación. Si se cambió de agente, se anuncia genéricamente: nombrar al
 * agente actual atribuiría una respuesta que no escribió.
 */
function messageAuthor(
  message: ConversationMessage,
  contactName: string,
  currentUser: { id: string; name: string },
  members: TeamMember[] | null,
  agent: ConversationAgent | null,
): MessageAuthor {
  if (message.direction === "incoming") {
    return { key: "contact", name: contactName, anonymousTeam: false };
  }
  if (message.senderType === "system") {
    const known = agent && agent.id === message.senderId ? agent.name : "Agente";
    return {
      key: `agent:${message.senderId ?? "desconocido"}`,
      name: known,
      anonymousTeam: false,
    };
  }
  if (message.senderId && message.senderId === currentUser.id) {
    return { key: `user:${currentUser.id}`, name: currentUser.name, anonymousTeam: false };
  }
  const teammate = message.senderId
    ? members?.find((member) => member.userId === message.senderId)
    : undefined;
  if (teammate) {
    return {
      key: `user:${teammate.userId}`,
      name: teammate.name,
      anonymousTeam: false,
    };
  }
  return { key: `team:${message.senderId ?? "desconocido"}`, name: "Equipo", anonymousTeam: true };
}

/**
 * Marca el cambio de día y la pertenencia a un bloque de autor, para que el
 * avatar y el nombre aparezcan una vez por bloque. Un cambio de día rompe el
 * bloque; una nota del sistema nunca pertenece a uno.
 */
export function threadRows(
  messages: ConversationMessage[],
  contactName: string,
  currentUser: { id: string; name: string },
  members: TeamMember[] | null = null,
  agent: ConversationAgent | null = null,
): ThreadRow[] {
  let currentDay: string | null = null;
  const rows: ThreadRow[] = messages.map((message) => {
    const occurred = new Date(message.occurredAt);
    const day = occurred.toLocaleDateString();
    const startsDay = day !== currentDay;
    currentDay = day;
    return {
      message,
      // Una nota del sistema no tiene autor; la respuesta del agente sí, y se
      // dibuja como cualquier otro saliente del negocio.
      author: message.senderType === "system" && message.direction !== "outgoing"
        ? null
        : messageAuthor(message, contactName, currentUser, members, agent),
      dayLabel: startsDay
        ? occurred.toLocaleDateString([], { day: "numeric", month: "long", year: "numeric" })
        : null,
      startsGroup: true,
      endsGroup: true,
    };
  });

  // Un bloque continúa mientras el autor no cambie y no se abra un día nuevo.
  rows.forEach((row, index) => {
    const previous = rows[index - 1];
    const next = rows[index + 1];
    row.startsGroup =
      row.author === null ||
      previous === undefined ||
      row.dayLabel !== null ||
      previous.author?.key !== row.author.key;
    row.endsGroup =
      row.author === null ||
      next === undefined ||
      next.dayLabel !== null ||
      next.author?.key !== row.author.key;
  });
  return rows;
}

/**
 * El primitivo no expone ningún callback de borde, así que la señal sale de su
 * hook de visibilidad: cuando el mensaje más antiguo cargado entra en pantalla,
 * hay que pedir la página anterior. Debe ser hijo del Provider para leer el hook.
 */
function LoadOlderOnReveal({
  enabled,
  oldestId,
  onReveal,
}: {
  enabled: boolean;
  oldestId: string | null;
  onReveal: () => void;
}) {
  const { visibleMessageIds } = useMessageScrollerVisibility();
  useEffect(() => {
    if (enabled && oldestId !== null && visibleMessageIds.includes(oldestId)) onReveal();
  }, [enabled, oldestId, onReveal, visibleMessageIds]);
  return null;
}

export function ConversationThread({
  agentAccess,
  canAssign,
  canLoadOlder,
  composerDisabled,
  composerPlaceholder,
  contactAccess,
  opportunityAccess,
  taskAccess,
  appointmentAccess,
  currentUser,
  loadingOlder,
  members,
  messages,
  onBack,
  onChangeState,
  onComposerChange,
  onLoadOlder,
  onSend,
  onSimulatedInbound,
  selected,
  sending,
  text,
}: {
  /**
   * Agentes publicados que pueden atender la conversación. Es `null` cuando la
   * sesión no puede leerlos: sin esa lectura no se ofrece el control, y el
   * backend vuelve a comprobar el permiso de gestión al activarlo.
   */
  agentAccess: { canManage: boolean; agents: AgentSummary[] | null };
  // Elegir responsable exige gestionar conversaciones y leer el equipo; el
  // backend vuelve a comprobar ambas cosas.
  canAssign: boolean;
  canLoadOlder: boolean;
  composerDisabled: boolean;
  composerPlaceholder: string;
  // La ficha se anuncia solo a quien puede consultarla, y se edita solo con
  // permiso de gestión. El backend vuelve a comprobar ambas cosas.
  contactAccess: { canRead: boolean; canManage: boolean };
  // Las oportunidades del contacto se anuncian a quien puede consultarlas y se
  // crean con permiso de gestión. El backend vuelve a comprobar ambas cosas.
  opportunityAccess: { canRead: boolean; canManage: boolean };
  // Las tareas del hilo se anuncian a quien puede consultarlas y se crean con
  // permiso de gestión. El backend vuelve a comprobar ambas cosas.
  taskAccess: { canRead: boolean; canManage: boolean; canReadTeam: boolean };
  /**
   * La agenda se lee en la zona horaria de la organización, así que el panel
   * lateral la necesita: mostrar la hora del navegador daría una cita distinta
   * de la que el salón tiene apuntada.
   */
  appointmentAccess: {
    canRead: boolean;
    canManage: boolean;
    canReadTeam: boolean;
    timeZone: string;
  };
  currentUser: { id: string; name: string };
  loadingOlder: boolean;
  members: TeamMember[] | null;
  messages: ConversationMessage[];
  onBack: () => void;
  onChangeState: (input: {
    status?: "open" | "resolved";
    attentionMode?: "automatic" | "human" | "paused";
    assigneeMembershipId?: string | null;
    agentId?: string | null;
  }) => void;
  onComposerChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onLoadOlder: () => void;
  onSend: () => void;
  // Solo la aporta el desarrollo local, para refrescar tras simular un mensaje.
  onSimulatedInbound?: () => void;
  selected: ConversationSummary | null;
  sending: boolean;
  text: string;
}) {
  if (!selected) {
    return (
      <div className="hidden min-h-0 flex-col md:flex">
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <MessageCircleMore />
            </EmptyMedia>
            <EmptyTitle>Selecciona una conversación</EmptyTitle>
            <EmptyDescription>
              El hilo, los adjuntos y los controles de atención aparecen aquí.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      </div>
    );
  }

  const paused = selected.attentionMode === "paused";
  const automatic = selected.attentionMode === "automatic";
  const resolved = selected.status === "resolved";
  // El control aparece con permiso de gestión y agentes legibles. Una lista
  // vacía solo se ofrece si la conversación ya responde sola, para poder
  // devolverla al equipo.
  const canChooseAgent = agentAccess.canManage
    && agentAccess.agents !== null
    && (agentAccess.agents.length > 0 || automatic);
  const contactName = selected.contactDisplayName ?? selected.contactExternalId;
  const rows = threadRows(messages, contactName, currentUser, members, selected.agent);

  return (
    <div className="flex min-h-0 flex-col">
      <div className="flex shrink-0 flex-wrap items-center gap-3 border-b p-4">
        <Button
          aria-label="Volver al inbox"
          className="md:hidden"
          onClick={onBack}
          size="icon-sm"
          variant="ghost"
        >
          <ArrowLeft />
        </Button>
        <div className="min-w-0 flex-1">
          <p className="truncate font-semibold">
            {selected.contactDisplayName ?? selected.contactExternalId}
          </p>
          <p className="truncate text-xs text-muted-foreground">
            {selected.channelDisplayName ?? "WhatsApp"}
          </p>
        </div>
        <Badge variant={resolved ? "secondary" : "outline"}>{statusLabels[selected.status]}</Badge>
        <div className="flex gap-2">
          {import.meta.env.DEV && onSimulatedInbound ? (
            <DevInboundButton
              conversationId={selected.id}
              onSimulated={onSimulatedInbound}
            />
          ) : null}
          {contactAccess.canRead ? (
            <ContactSheet
              canManage={contactAccess.canManage}
              contactId={selected.contactId}
            />
          ) : null}
          {/* La nota pertenece al contacto y usa sus mismos permisos; lo que se
              escriba aquí conserva esta conversación como origen. */}
          {contactAccess.canRead ? (
            <NoteSheet
              canManage={contactAccess.canManage}
              contactId={selected.contactId}
              conversationId={selected.id}
            />
          ) : null}
          {opportunityAccess.canRead ? (
            <OpportunitySheet
              canManage={opportunityAccess.canManage}
              contactId={selected.contactId}
              conversationId={selected.id}
            />
          ) : null}
          {taskAccess.canRead ? (
            <TaskSheet
              canManage={taskAccess.canManage}
              canReadTeam={taskAccess.canReadTeam}
              subject={{ type: "conversation", id: selected.id }}
            />
          ) : null}
          {appointmentAccess.canRead ? (
            <AppointmentSheet
              canManage={appointmentAccess.canManage}
              // Sin permiso de oportunidades no se ofrece el enlace; la cita se
              // agenda igual, solo que sin decir de qué venta salió.
              canReadOpportunities={opportunityAccess.canRead}
              canReadTeam={appointmentAccess.canReadTeam}
              contactId={selected.contactId}
              conversationId={selected.id}
              timeZone={appointmentAccess.timeZone}
            />
          ) : null}
          {canChooseAgent ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <Bot />
                  {automatic
                    ? selected.agent?.name ?? "Responde el agente"
                    : "Atiende el equipo"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuRadioGroup
                  onValueChange={(value) =>
                    onChangeState(
                      value === "team"
                        ? { attentionMode: "human" }
                        : { attentionMode: "automatic", agentId: value },
                    )
                  }
                  value={automatic && selected.agent ? selected.agent.id : "team"}
                >
                  <DropdownMenuRadioItem value="team">
                    Atiende el equipo
                  </DropdownMenuRadioItem>
                  {(agentAccess.agents ?? []).map((agent) => (
                    <DropdownMenuRadioItem key={agent.id} value={agent.id}>
                      Responde {agent.name}
                    </DropdownMenuRadioItem>
                  ))}
                </DropdownMenuRadioGroup>
              </DropdownMenuContent>
            </DropdownMenu>
          ) : null}
          {canAssign && members ? (
            <DropdownMenu>
              <DropdownMenuTrigger asChild>
                <Button variant="outline">
                  <UserRound />
                  {selected.assignee?.name ?? "Sin responsable"}
                </Button>
              </DropdownMenuTrigger>
              <DropdownMenuContent align="end" className="w-56">
                <DropdownMenuRadioGroup
                  onValueChange={(value) =>
                    onChangeState({
                      assigneeMembershipId: value === "none" ? null : value,
                    })
                  }
                  value={selected.assignee?.membershipId ?? "none"}
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
          ) : null}
          <Button
            onClick={() => onChangeState({ attentionMode: paused ? "human" : "paused" })}
            variant="outline"
          >
            {paused ? <UserRoundCheck /> : <Pause />}
            {paused ? "Tomar control" : "Pausar"}
          </Button>
          <Button
            onClick={() => onChangeState({ status: resolved ? "open" : "resolved" })}
            variant="outline"
          >
            {resolved ? "Reabrir" : "Resolver"}
          </Button>
        </div>
      </div>
      <MessageScrollerProvider autoScroll defaultScrollPosition="end">
        <MessageScroller className="min-h-0 flex-1">
          <MessageScrollerViewport aria-label="Mensajes de la conversación">
            <MessageScrollerContent className="gap-4 p-4">
              {rows.map((row) => (
                <MessageScrollerItem key={row.message.id} messageId={row.message.id}>
                  {row.dayLabel ? (
                    <Marker className="mb-4" variant="separator">
                      <MarkerContent>{row.dayLabel}</MarkerContent>
                    </Marker>
                  ) : null}
                  {row.author === null ? (
                    <SystemNote message={row.message} />
                  ) : (
                    <ConversationMessageRow
                      author={row.author}
                      conversationId={selected.id}
                      endsGroup={row.endsGroup}
                      message={row.message}
                      startsGroup={row.startsGroup}
                    />
                  )}
                </MessageScrollerItem>
              ))}
            </MessageScrollerContent>
          </MessageScrollerViewport>
          {/* El aviso vive fuera del contenido: un primer hijo fijo, o que se
              monta y desmonta, rompe la detección de prepend del scroller. */}
          {loadingOlder ? (
            <div className="absolute inset-x-0 top-2 flex justify-center" role="status">
              <span className="flex items-center gap-2 rounded-full border bg-background px-3 py-1 text-xs text-muted-foreground shadow-sm">
                <Spinner />
                Cargando historial…
              </span>
            </div>
          ) : null}
          <LoadOlderOnReveal
            enabled={canLoadOlder}
            oldestId={rows.at(0)?.message.id ?? null}
            onReveal={onLoadOlder}
          />
          <MessageScrollerButton />
        </MessageScroller>
      </MessageScrollerProvider>
      <Separator />
      <div className="flex shrink-0 items-end gap-2 p-4">
        <textarea
          aria-label="Mensaje"
          className="min-h-11 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus-visible:border-ring focus-visible:ring-[3px] focus-visible:ring-ring/50"
          disabled={composerDisabled}
          onChange={onComposerChange}
          placeholder={composerPlaceholder}
          value={text}
        />
        <Button
          aria-label="Enviar mensaje"
          disabled={composerDisabled || !text.trim()}
          onClick={onSend}
          size="icon"
        >
          {sending ? <Spinner /> : <Send />}
        </Button>
      </div>
    </div>
  );
}
