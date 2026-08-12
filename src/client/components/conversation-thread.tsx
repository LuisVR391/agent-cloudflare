import { ArrowLeft, MessageCircleMore, Pause, Send, UserRoundCheck } from "lucide-react";
import type { ChangeEvent } from "react";

import { ConversationMessageRow } from "@/components/conversation-message";
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
  | { kind: "message"; key: string; message: ConversationMessage };

/**
 * Intercala una marca por cada cambio de día para que el hilo se lea sin
 * repetir la fecha completa en cada mensaje.
 */
function threadRows(messages: ConversationMessage[]): ThreadRow[] {
  const rows: ThreadRow[] = [];
  let currentDay: string | null = null;
  for (const message of messages) {
    const occurred = new Date(message.occurredAt);
    const day = occurred.toLocaleDateString();
    if (day !== currentDay) {
      currentDay = day;
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
    rows.push({ kind: "message", key: message.id, message });
  }
  return rows;
}

export function ConversationThread({
  composerDisabled,
  composerPlaceholder,
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
              {threadRows(messages).map((row) =>
                row.kind === "day" ? (
                  <Marker key={row.key} variant="separator">
                    <MarkerContent>{row.label}</MarkerContent>
                  </Marker>
                ) : (
                  <MessageScrollerItem key={row.key} messageId={row.message.id}>
                    <ConversationMessageRow
                      conversationId={selected.id}
                      message={row.message}
                    />
                  </MessageScrollerItem>
                ),
              )}
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
