import { Inbox, RefreshCw } from "lucide-react";
import { useEffect, useRef } from "react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/api";

/**
 * Con la lista paginada se alcanzan conversaciones de días anteriores, y una hora
 * suelta no las distingue: se muestra la hora solo si la actividad es de hoy.
 */
function formatActivity(lastMessageAt: string): string {
  const occurred = new Date(lastMessageAt);
  const today = new Date().toLocaleDateString();
  if (occurred.toLocaleDateString() === today) {
    return occurred.toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" });
  }
  return occurred.toLocaleDateString([], { day: "numeric", month: "short" });
}

const attentionModeLabels: Record<ConversationSummary["attentionMode"], string> = {
  automatic: "Automático",
  supervised: "Supervisado",
  human: "Control humano",
  paused: "En pausa",
};

export function ConversationList({
  canLoadMore,
  className,
  conversations,
  loading,
  loadingMore,
  onLoadMore,
  onRefresh,
  onSelect,
  onStatusChange,
  selectedId,
  status,
}: {
  canLoadMore: boolean;
  className?: string;
  conversations: ConversationSummary[];
  loading: boolean;
  loadingMore: boolean;
  onLoadMore: () => void;
  onRefresh: () => void;
  onSelect: (conversation: ConversationSummary) => void;
  onStatusChange: (status: "open" | "resolved") => void;
  selectedId: string | null;
  status: "open" | "resolved";
}) {
  const sentinel = useRef<HTMLDivElement | null>(null);

  // La lista es un contenedor de scroll propio, no un `MessageScroller`, así que
  // el centinela observado es la forma estándar de pedir la página siguiente.
  useEffect(() => {
    const element = sentinel.current;
    if (!element || !canLoadMore) return;
    const observer = new IntersectionObserver((entries) => {
      if (entries.some((entry) => entry.isIntersecting)) onLoadMore();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [canLoadMore, onLoadMore]);

  return (
    <div className={cn("flex min-h-0 flex-col md:border-r", className)}>
      <div className="flex shrink-0 flex-col gap-3 border-b p-4">
        <div className="flex items-center justify-between gap-2">
          <h2 className="text-lg font-semibold">Conversaciones</h2>
          <Button aria-label="Actualizar" onClick={onRefresh} size="icon-sm" variant="outline">
            <RefreshCw />
          </Button>
        </div>
        <Tabs onValueChange={(value) => onStatusChange(value as "open" | "resolved")} value={status}>
          <TabsList className="w-full">
            <TabsTrigger value="open">Abiertas</TabsTrigger>
            <TabsTrigger value="resolved">Resueltas</TabsTrigger>
          </TabsList>
        </Tabs>
        <p className="text-xs text-muted-foreground">
          {conversations.length} {conversations.length === 1 ? "conversación" : "conversaciones"} ·
          WhatsApp atendido desde Agent Cloudflare
        </p>
      </div>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
        {loading ? (
          <div className="flex flex-col gap-3 p-4">
            {[0, 1, 2].map((row) => (
              <div className="flex flex-col gap-2" key={row}>
                <Skeleton className="h-4 w-2/3" />
                <Skeleton className="h-3 w-1/2" />
              </div>
            ))}
          </div>
        ) : null}
        {!loading && conversations.length === 0 ? (
          <Empty>
            <EmptyHeader>
              <EmptyMedia variant="icon">
                <Inbox />
              </EmptyMedia>
              <EmptyTitle>Sin conversaciones {status === "open" ? "abiertas" : "resueltas"}</EmptyTitle>
              <EmptyDescription>
                Aquí aparecerán las conversaciones de WhatsApp de tu organización.
              </EmptyDescription>
            </EmptyHeader>
          </Empty>
        ) : null}
        {conversations.map((conversation) => (
          <button
            className={cn(
              "flex w-full flex-col items-start gap-1 border-b p-4 text-left text-sm leading-tight last:border-b-0",
              "hover:bg-muted/60",
              selectedId === conversation.id && "bg-muted",
            )}
            key={conversation.id}
            onClick={() => onSelect(conversation)}
            type="button"
          >
            <span className="flex w-full items-center gap-2">
              <span className="truncate font-medium">
                {conversation.contactDisplayName ?? conversation.contactExternalId}
              </span>
              <span className="ml-auto shrink-0 text-xs text-muted-foreground">
                {formatActivity(conversation.lastMessageAt)}
              </span>
            </span>
            <span className="line-clamp-2 w-full text-muted-foreground">
              {conversation.lastMessageText ?? "Adjunto"}
            </span>
            <span className="text-xs text-muted-foreground">
              {attentionModeLabels[conversation.attentionMode]}
            </span>
          </button>
        ))}
        {canLoadMore || loadingMore ? (
          <div className="flex shrink-0 items-center justify-center gap-2 p-4 text-xs text-muted-foreground" ref={sentinel}>
            {loadingMore ? (
              <>
                <Spinner />
                Cargando conversaciones…
              </>
            ) : null}
          </div>
        ) : null}
      </div>
    </div>
  );
}
