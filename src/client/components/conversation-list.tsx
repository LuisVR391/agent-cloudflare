import { Inbox, RefreshCw } from "lucide-react";

import { Button } from "@/components/ui/button";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { cn } from "@/lib/utils";
import type { ConversationSummary } from "@/lib/api";

const attentionModeLabels: Record<ConversationSummary["attentionMode"], string> = {
  automatic: "Automático",
  supervised: "Supervisado",
  human: "Control humano",
  paused: "En pausa",
};

export function ConversationList({
  className,
  conversations,
  loading,
  onRefresh,
  onSelect,
  onStatusChange,
  selectedId,
  status,
}: {
  className?: string;
  conversations: ConversationSummary[];
  loading: boolean;
  onRefresh: () => void;
  onSelect: (conversation: ConversationSummary) => void;
  onStatusChange: (status: "open" | "resolved") => void;
  selectedId: string | null;
  status: "open" | "resolved";
}) {
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
                {new Date(conversation.lastMessageAt).toLocaleTimeString([], {
                  hour: "2-digit",
                  minute: "2-digit",
                })}
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
      </div>
    </div>
  );
}
