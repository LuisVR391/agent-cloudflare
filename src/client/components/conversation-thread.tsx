import { ArrowLeft, MessageCircleMore, Pause, Send, UserRoundCheck } from "lucide-react";
import { useEffect, type ChangeEvent } from "react";

import {
  ConversationMessageRow,
  SystemNote,
  type MessageAuthor,
} from "@/components/conversation-message";
import { ContactSheet } from "@/components/contact-sheet";
import { DevInboundButton } from "@/components/dev-inbound-button";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
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
import type { ConversationMessage, ConversationSummary } from "@/lib/api";

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
 * de la sesión; el de otro colaborador se anuncia como equipo, porque sin el
 * directorio de miembros no hay forma de resolver `senderId` a un nombre y
 * atribuirlo a la cuenta actual sería falso.
 */
function messageAuthor(
  message: ConversationMessage,
  contactName: string,
  currentUser: { id: string; name: string },
): MessageAuthor {
  if (message.direction === "incoming") {
    return { key: "contact", name: contactName, anonymousTeam: false };
  }
  if (message.senderId && message.senderId === currentUser.id) {
    return { key: `user:${currentUser.id}`, name: currentUser.name, anonymousTeam: false };
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
): ThreadRow[] {
  let currentDay: string | null = null;
  const rows: ThreadRow[] = messages.map((message) => {
    const occurred = new Date(message.occurredAt);
    const day = occurred.toLocaleDateString();
    const startsDay = day !== currentDay;
    currentDay = day;
    return {
      message,
      author: message.senderType === "system"
        ? null
        : messageAuthor(message, contactName, currentUser),
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
  canLoadOlder,
  composerDisabled,
  composerPlaceholder,
  contactAccess,
  currentUser,
  loadingOlder,
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
  canLoadOlder: boolean;
  composerDisabled: boolean;
  composerPlaceholder: string;
  // La ficha se anuncia solo a quien puede consultarla, y se edita solo con
  // permiso de gestión. El backend vuelve a comprobar ambas cosas.
  contactAccess: { canRead: boolean; canManage: boolean };
  currentUser: { id: string; name: string };
  loadingOlder: boolean;
  messages: ConversationMessage[];
  onBack: () => void;
  onChangeState: (input: {
    status?: "open" | "resolved";
    attentionMode?: "human" | "paused";
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
  const resolved = selected.status === "resolved";
  const contactName = selected.contactDisplayName ?? selected.contactExternalId;
  const rows = threadRows(messages, contactName, currentUser);

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
