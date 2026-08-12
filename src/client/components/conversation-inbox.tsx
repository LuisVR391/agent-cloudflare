import { useEffect, useRef, useState } from "react";
import { LoaderCircle, MessageCircleMore, Pause, RefreshCw, Send, UserRoundCheck } from "lucide-react";
import { Button } from "./ui/button";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "./ui/card";
import {
  getConversationMessages,
  listConversations,
  markConversationRead,
  sendConversationMessage,
  updateConversation,
  type ConversationMessage,
  type ConversationSummary,
} from "../lib/api";

const messageStatusLabels: Record<ConversationMessage["status"], string> = {
  received: "Recibido",
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No enviado",
  delivery_unknown: "Confirmación pendiente",
};

function statusTone(status: ConversationMessage["status"]): string {
  if (status === "failed") return "font-medium text-red-200";
  if (status === "delivery_unknown") return "font-medium text-amber-200";
  return "";
}

export function ConversationInbox() {
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
      // Acuse de lectura una vez que el hilo está a la vista. No se espera ni se
      // reporta: su fallo no afecta lo que el operador está haciendo y la
      // siguiente apertura vuelve a intentarlo.
      void markConversationRead(conversation.id).catch(() => false);
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
    <section className="mt-8">
      <div className="mb-4 flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold">Conversaciones</h2>
          <p className="text-sm text-muted-foreground">WhatsApp atendido desde Agent Cloudflare.</p>
        </div>
        <div className="flex gap-2">
          <Button onClick={() => setStatus("open")} variant={status === "open" ? "default" : "outline"}>Abiertas</Button>
          <Button onClick={() => setStatus("resolved")} variant={status === "resolved" ? "default" : "outline"}>Resueltas</Button>
          <Button aria-label="Actualizar" onClick={() => void refreshList()} size="icon" variant="outline"><RefreshCw /></Button>
        </div>
      </div>
      {error ? <div className="mb-4 rounded-lg border border-destructive/30 bg-destructive/10 p-3 text-sm text-destructive">{error}</div> : null}
      <div className="grid min-h-[620px] gap-4 lg:grid-cols-[340px_1fr]">
        <Card className="overflow-hidden">
          <CardHeader><CardTitle>Inbox</CardTitle><CardDescription>{conversations.length} conversaciones</CardDescription></CardHeader>
          <CardContent className="space-y-2">
            {loading ? <LoaderCircle className="mx-auto animate-spin" /> : null}
            {!loading && conversations.length === 0 ? <p className="py-12 text-center text-sm text-muted-foreground">Aún no hay conversaciones {status === "open" ? "abiertas" : "resueltas"}.</p> : null}
            {conversations.map((conversation) => (
              <button className={`w-full rounded-xl border p-3 text-left transition ${selected?.id === conversation.id ? "border-primary bg-primary/5" : "hover:bg-muted"}`}
                key={conversation.id} onClick={() => void openConversation(conversation)} type="button">
                <div className="flex items-center justify-between gap-2">
                  <span className="truncate font-medium">{conversation.contactDisplayName ?? conversation.contactExternalId}</span>
                  <span className="text-xs text-muted-foreground">{new Date(conversation.lastMessageAt).toLocaleTimeString([], { hour: "2-digit", minute: "2-digit" })}</span>
                </div>
                <p className="mt-1 truncate text-sm text-muted-foreground">{conversation.lastMessageText ?? "Adjunto"}</p>
                <p className="mt-2 text-xs capitalize text-muted-foreground">{conversation.attentionMode}</p>
              </button>
            ))}
          </CardContent>
        </Card>
        <Card className="flex min-w-0 flex-col">
          {!selected ? <CardContent className="flex flex-1 flex-col items-center justify-center text-center text-muted-foreground"><MessageCircleMore className="mb-3 size-10" /><p>Selecciona una conversación para ver su flujo.</p></CardContent> : (
            <>
              <CardHeader className="border-b">
                <div className="flex flex-wrap items-center justify-between gap-3">
                  <div><CardTitle>{selected.contactDisplayName ?? selected.contactExternalId}</CardTitle><CardDescription>{selected.channelDisplayName ?? "WhatsApp"} · {selected.status}</CardDescription></div>
                  <div className="flex gap-2">
                    <Button onClick={() => void changeState({ attentionMode: selected.attentionMode === "paused" ? "human" : "paused" })} variant="outline">
                      {selected.attentionMode === "paused" ? <UserRoundCheck /> : <Pause />}
                      {selected.attentionMode === "paused" ? "Tomar control" : "Pausar"}
                    </Button>
                    <Button onClick={() => void changeState({ status: selected.status === "open" ? "resolved" : "open" })} variant="outline">
                      {selected.status === "open" ? "Resolver" : "Reabrir"}
                    </Button>
                  </div>
                </div>
              </CardHeader>
              <CardContent className="flex flex-1 flex-col p-0">
                <div aria-live="polite" className="flex-1 space-y-3 overflow-y-auto p-4">
                  {messages.map((message) => (
                    <div className={`flex ${message.direction === "outgoing" ? "justify-end" : "justify-start"}`} key={message.id}>
                      <div className={`max-w-[85%] rounded-2xl px-4 py-2 text-sm ${message.direction === "outgoing" ? "bg-primary text-primary-foreground" : "bg-muted"}`}>
                        <p className="whitespace-pre-wrap break-words">{message.text ?? "Adjunto"}</p>
                        {message.attachments.map((attachment) => (
                          <a className="mt-2 block underline" href={`/api/conversations/${selected.id}/attachments/${encodeURIComponent(attachment.id)}`}
                            key={attachment.id} rel="noreferrer" target="_blank">
                            Abrir {attachment.type} · {Math.ceil(attachment.byteSize / 1024)} KiB
                          </a>
                        ))}
                        <p className={"mt-1 text-[10px] opacity-80 " + statusTone(message.status)}>{messageStatusLabels[message.status]} · {new Date(message.occurredAt).toLocaleString()}</p>
                      </div>
                    </div>
                  ))}
                </div>
                <div className="border-t p-4">
                  <div className="flex gap-2">
                    <textarea
                      aria-label="Mensaje"
                      className="min-h-11 flex-1 resize-none rounded-md border bg-background px-3 py-2 text-sm"
                      disabled={composerDisabled}
                      onChange={(event) => {
                        setText(event.target.value);
                        if (
                          pendingSend.current &&
                          pendingSend.current.text !== event.target.value.trim()
                        ) {
                          pendingSend.current = null;
                        }
                      }}
                      placeholder={composerPlaceholder}
                      value={text}
                    />
                    <Button
                      aria-label="Enviar mensaje"
                      disabled={composerDisabled || !text.trim()}
                      onClick={() => void send()}
                      size="icon"
                    >
                      {sending ? (
                        <LoaderCircle className="animate-spin" />
                      ) : (
                        <Send />
                      )}
                    </Button>
                  </div>
                </div>
              </CardContent>
            </>
          )}
        </Card>
      </div>
    </section>
  );
}
