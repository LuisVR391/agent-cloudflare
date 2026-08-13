import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";

import { ConversationList } from "@/components/conversation-list";
import { ConversationThread } from "@/components/conversation-thread";
import type { PanelContext } from "@/components/panel-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { cn } from "@/lib/utils";
import {
  getConversationMessages,
  listConversations,
  sendConversationMessage,
  updateConversation,
  type ConversationMessage,
  type ConversationSummary,
} from "@/lib/api";

export function ConversationInbox() {
  // La identidad de la sesión llega por el contexto del shell, igual que en el
  // resumen: es lo que permite atribuir una respuesta a quien la escribió.
  const panel = useOutletContext<PanelContext>();
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const pendingSend = useRef<{ text: string; clientRequestId: string } | null>(null);

  async function refreshList() {
    setError(null);
    try {
      const result = await listConversations(status);
      setConversations(result.conversations);
      if (selected) {
        const next = result.conversations.find((item) => item.id === selected.id);
        if (next) setSelected(next);
      }
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar el inbox.");
    } finally {
      setLoading(false);
    }
  }

  async function openConversation(conversation: ConversationSummary) {
    setSelected(conversation);
    setError(null);
    try {
      const result = await getConversationMessages(conversation.id);
      setSelected(result.conversation);
      setMessages(result.messages);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible abrir la conversación.");
    }
  }

  useEffect(() => {
    setLoading(true);
    void refreshList();
    const interval = window.setInterval(() => void refreshList(), 10_000);
    return () => window.clearInterval(interval);
  }, [status]);

  useEffect(() => {
    if (!selected) return;
    let socket: WebSocket | null = null;
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/conversations/${selected.id}/live`);
      socket.addEventListener("message", () => void openConversation(selected));
    } catch {
      // El polling conserva la vista usable cuando WebSocket no está disponible.
    }
    return () => socket?.close();
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    const interval = window.setInterval(
      () => void openConversation(selected),
      10_000,
    );
    return () => window.clearInterval(interval);
  }, [selected?.id]);

  async function send() {
    if (
      !selected ||
      !text.trim() ||
      selected.status !== "open" ||
      selected.attentionMode !== "human"
    ) return;
    const nextText = text.trim();
    const request = pendingSend.current?.text === nextText
      ? pendingSend.current
      : { text: nextText, clientRequestId: crypto.randomUUID() };
    pendingSend.current = request;
    setSending(true);
    setText("");
    setError(null);
    try {
      await sendConversationMessage(
        selected.id,
        nextText,
        request.clientRequestId,
      );
      pendingSend.current = null;
      await openConversation(selected);
    } catch (caught) {
      setText(nextText);
      setError(caught instanceof Error ? caught.message : "No fue posible enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }

  async function changeState(input: { status?: "open" | "resolved"; attentionMode?: "human" | "paused" }) {
    if (!selected) return;
    try {
      await updateConversation(selected.id, { expectedVersion: selected.version, ...input });
      await openConversation(selected);
      await refreshList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar la conversación.");
    }
  }

  const composerDisabled =
    !selected ||
    selected.status !== "open" ||
    selected.attentionMode !== "human" ||
    sending;
  const composerPlaceholder =
    selected?.status === "resolved"
      ? "Reabre la conversación para responder"
      : selected?.attentionMode !== "human"
        ? "Toma control para responder"
        : "Escribe una respuesta…";

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <div className="shrink-0 p-4 pb-0">
          <Alert variant="destructive">
            <AlertTitle>No pudimos completar la acción</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      {/* En pantallas estrechas solo cabe un panel: la lista cede el espacio al
          hilo cuando hay una conversación abierta. */}
      <div className="grid min-h-0 flex-1 md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr]">
        <ConversationList
          className={cn(selected && "hidden md:flex")}
          conversations={conversations}
          loading={loading}
          onRefresh={() => void refreshList()}
          onSelect={(conversation) => void openConversation(conversation)}
          onStatusChange={setStatus}
          selectedId={selected?.id ?? null}
          status={status}
        />
        <ConversationThread
          composerDisabled={composerDisabled}
          composerPlaceholder={composerPlaceholder}
          currentUser={panel.user}
          messages={messages}
          onBack={() => setSelected(null)}
          onChangeState={(input) => void changeState(input)}
          onComposerChange={(event) => {
            setText(event.target.value);
            if (
              pendingSend.current &&
              pendingSend.current.text !== event.target.value.trim()
            ) {
              pendingSend.current = null;
            }
          }}
          onSend={() => void send()}
          selected={selected}
          sending={sending}
          text={text}
        />
      </div>
    </div>
  );
}
