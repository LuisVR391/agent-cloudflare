import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";

import { ConversationList } from "@/components/conversation-list";
import { ConversationThread } from "@/components/conversation-thread";
import type { PanelContext } from "@/components/panel-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { mergeConversations, mergeMessages } from "@/lib/conversation-pagination";
import { cn } from "@/lib/utils";
import {
  getConversationMessages,
  listConversations,
  listTeamMembers,
  sendConversationMessage,
  updateConversation,
  type AssigneeFilter,
  type ConversationMessage,
  type ConversationSummary,
  type TeamMember,
} from "@/lib/api";

export function ConversationInbox() {
  // La identidad de la sesión llega por el contexto del shell, igual que en el
  // resumen: es lo que permite atribuir una respuesta a quien la escribió.
  const panel = useOutletContext<PanelContext>();
  const canReadTeam = panel.activeOrganization.permissions.includes("users.read");
  const canManage = panel.activeOrganization.permissions.includes(
    "conversations.manage",
  );
  const [status, setStatus] = useState<"open" | "resolved">("open");
  const [assignee, setAssignee] = useState<AssigneeFilter>("all");
  const [members, setMembers] = useState<TeamMember[]>([]);
  const [conversations, setConversations] = useState<ConversationSummary[]>([]);
  const [selected, setSelected] = useState<ConversationSummary | null>(null);
  const [messages, setMessages] = useState<ConversationMessage[]>([]);
  const [text, setText] = useState("");
  const [sending, setSending] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [listCursor, setListCursor] = useState<string | null>(null);
  const [loadingMore, setLoadingMore] = useState(false);
  const [olderCursor, setOlderCursor] = useState<string | null>(null);
  const [loadingOlder, setLoadingOlder] = useState(false);
  const pendingSend = useRef<{ text: string; clientRequestId: string } | null>(null);

  /**
   * Refresca la primera página fusionando, no reemplazando: el polling y el
   * WebSocket corren cada pocos segundos y sustituir el arreglo descartaría las
   * páginas que el usuario acaba de cargar.
   */
  async function refreshList() {
    setError(null);
    try {
      const result = await listConversations(status, undefined, assignee);
      setConversations((previous) => mergeConversations(previous, result.conversations));
      if (listCursor === null) setListCursor(result.nextCursor);
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

  /** Vuelve a la primera página y descarta lo acumulado. */
  async function resetList() {
    setListCursor(null);
    setError(null);
    try {
      const result = await listConversations(status, undefined, assignee);
      setConversations(result.conversations);
      setListCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar el inbox.");
    } finally {
      setLoading(false);
    }
  }

  async function loadMoreConversations() {
    if (!listCursor || loadingMore) return;
    setLoadingMore(true);
    try {
      const result = await listConversations(status, listCursor, assignee);
      setConversations((previous) => mergeConversations(previous, result.conversations));
      setListCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar más conversaciones.");
    } finally {
      setLoadingMore(false);
    }
  }

  async function openConversation(conversation: ConversationSummary) {
    setSelected(conversation);
    setError(null);
    try {
      const result = await getConversationMessages(conversation.id);
      setSelected(result.conversation);
      setMessages(result.messages);
      setOlderCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible abrir la conversación.");
    }
  }

  /** El refresco del hilo conserva el historial ya cargado y su cursor. */
  async function refreshThread(conversation: ConversationSummary) {
    try {
      const result = await getConversationMessages(conversation.id);
      setSelected(result.conversation);
      setMessages((previous) => mergeMessages(previous, result.messages));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar la conversación.");
    }
  }

  async function loadOlderMessages() {
    if (!selected || !olderCursor || loadingOlder) return;
    setLoadingOlder(true);
    try {
      const result = await getConversationMessages(selected.id, olderCursor);
      setMessages((previous) => mergeMessages(previous, result.messages));
      setOlderCursor(result.nextCursor);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible cargar el historial.");
    } finally {
      setLoadingOlder(false);
    }
  }

  useEffect(() => {
    setLoading(true);
    void resetList();
    const interval = window.setInterval(() => void refreshList(), 10_000);
    return () => window.clearInterval(interval);
  }, [status, assignee]);

  // El equipo cambia con mucha menos frecuencia que las conversaciones: se
  // carga una vez y sirve al filtro, al selector de responsable y a la
  // atribución de los mensajes que envió otra persona.
  useEffect(() => {
    if (!canReadTeam) return;
    void listTeamMembers()
      .then(setMembers)
      .catch(() => setMembers([]));
  }, [canReadTeam]);

  useEffect(() => {
    if (!selected) return;
    let socket: WebSocket | null = null;
    try {
      const protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
      socket = new WebSocket(`${protocol}//${window.location.host}/api/conversations/${selected.id}/live`);
      socket.addEventListener("message", () => void refreshThread(selected));
    } catch {
      // El polling conserva la vista usable cuando WebSocket no está disponible.
    }
    return () => socket?.close();
  }, [selected?.id]);

  useEffect(() => {
    if (!selected) return;
    const interval = window.setInterval(
      () => void refreshThread(selected),
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
      await refreshThread(selected);
    } catch (caught) {
      setText(nextText);
      setError(caught instanceof Error ? caught.message : "No fue posible enviar el mensaje.");
    } finally {
      setSending(false);
    }
  }

  async function changeState(input: {
    status?: "open" | "resolved";
    attentionMode?: "human" | "paused";
    assigneeMembershipId?: string | null;
  }) {
    if (!selected) return;
    try {
      await updateConversation(selected.id, { expectedVersion: selected.version, ...input });
      await refreshThread(selected);
      // Resolver o reabrir saca la conversación del filtro activo, y una fusión
      // por identificador la conservaría: aquí sí hay que reiniciar la lista.
      await resetList();
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible actualizar la conversación.");
      // La versión sube también con cada mensaje entrante o saliente, así que un
      // conflicto es corriente en una conversación activa. Recargar deja la
      // vista lista para reintentar en vez de exigir un refresco manual.
      await refreshThread(selected);
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
          assignee={assignee}
          canLoadMore={listCursor !== null}
          className={cn(selected && "hidden md:flex")}
          conversations={conversations}
          loading={loading}
          loadingMore={loadingMore}
          members={canReadTeam ? members : null}
          onAssigneeChange={setAssignee}
          onLoadMore={() => void loadMoreConversations()}
          onRefresh={() => void resetList()}
          onSelect={(conversation) => void openConversation(conversation)}
          onStatusChange={setStatus}
          selectedId={selected?.id ?? null}
          status={status}
        />
        <ConversationThread
          canLoadOlder={olderCursor !== null && !loadingOlder}
          composerDisabled={composerDisabled}
          composerPlaceholder={composerPlaceholder}
          contactAccess={{
            canRead: panel.activeOrganization.permissions.includes("contacts.read"),
            canManage: panel.activeOrganization.permissions.includes("contacts.manage"),
          }}
          opportunityAccess={{
            canRead: panel.activeOrganization.permissions.includes("opportunities.read"),
            canManage: panel.activeOrganization.permissions.includes(
              "opportunities.manage",
            ),
          }}
          currentUser={panel.user}
          loadingOlder={loadingOlder}
          members={canReadTeam ? members : null}
          canAssign={canManage && canReadTeam}
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
          onLoadOlder={() => void loadOlderMessages()}
          onSend={() => void send()}
          onSimulatedInbound={() => {
            if (selected) void refreshThread(selected);
            void refreshList();
          }}
          selected={selected}
          sending={sending}
          text={text}
        />
      </div>
    </div>
  );
}
