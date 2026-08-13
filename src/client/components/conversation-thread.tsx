import { ArrowLeft, MessageCircleMore, Pause, Send, UserRoundCheck } from "lucide-react";
import type { ChangeEvent } from "react";

import {
  ConversationMessageGroup,
  SystemNote,
  type MessageAuthor,
} from "@/components/conversation-message";
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
} from "@/components/ui/message-scroller";
import { Separator } from "@/components/ui/separator";
import { Spinner } from "@/components/ui/spinner";
import type { ConversationMessage, ConversationSummary } from "@/lib/api";

const statusLabels: Record<ConversationSummary["status"], string> = {
  open: "Abierta",
  resolved: "Resuelta",
};

type ThreadRow =
  | { kind: "day"; key: string; label: string }
  | { kind: "system"; key: string; message: ConversationMessage }
  | {
      kind: "group";
      key: string;
      author: MessageAuthor;
      messages: ConversationMessage[];
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
 * Intercala una marca por cada cambio de día y agrupa los mensajes consecutivos
 * del mismo autor, para que el avatar y el nombre no se repitan en cada mensaje.
 * Un cambio de día rompe el bloque; una nota del sistema nunca se agrupa.
 */
export function threadRows(
  messages: ConversationMessage[],
  contactName: string,
  currentUser: { id: string; name: string },
): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let currentDay: string | null = null;
  let open: Extract<ThreadRow, { kind: "group" }> | null = null;

  for (const message of messages) {
    const occurred = new Date(message.occurredAt);
    const day = occurred.toLocaleDateString();
    if (day !== currentDay) {
      currentDay = day;
      open = null;
      rows.push({
        kind: "day",
        key: `day-${day}`,
        label: occurred.toLocaleDateString([], {
          day: "numeric",
          month: "long",
          year: "numeric",
        }),
      });
    }

    if (message.senderType === "system") {
      open = null;
      rows.push({ kind: "system", key: message.id, message });
      continue;
    }

    const author = messageAuthor(message, contactName, currentUser);
    if (open && open.author.key === author.key) {
      open.messages.push(message);
      continue;
    }
    open = { kind: "group", key: message.id, author, messages: [message] };
    rows.push(open);
  }
  return rows;
}

export function ConversationThread({
  composerDisabled,
  composerPlaceholder,
  currentUser,
  messages,
  onBack,
  onChangeState,
  onComposerChange,
  onSend,
  selected,
  sending,
  text,
}: {
  composerDisabled: boolean;
  composerPlaceholder: string;
  currentUser: { id: string; name: string };
  messages: ConversationMessage[];
  onBack: () => void;
  onChangeState: (input: {
    status?: "open" | "resolved";
    attentionMode?: "human" | "paused";
  }) => void;
  onComposerChange: (event: ChangeEvent<HTMLTextAreaElement>) => void;
  onSend: () => void;
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
            <MessageScrollerContent className="gap-6 p-4">
              {threadRows(messages, contactName, currentUser).map((row) => {
                if (row.kind === "day") {
                  return (
                    <Marker key={row.key} variant="separator">
                      <MarkerContent>{row.label}</MarkerContent>
                    </Marker>
                  );
                }
                if (row.kind === "system") {
                  return (
                    <MessageScrollerItem key={row.key} messageId={row.message.id}>
                      <SystemNote message={row.message} />
                    </MessageScrollerItem>
                  );
                }
                return (
                  <MessageScrollerItem key={row.key} messageId={row.messages[0].id}>
                    <ConversationMessageGroup
                      author={row.author}
                      conversationId={selected.id}
                      messages={row.messages}
                    />
                  </MessageScrollerItem>
                );
              })}
            </MessageScrollerContent>
          </MessageScrollerViewport>
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
