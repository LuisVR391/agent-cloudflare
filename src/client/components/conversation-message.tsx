import {
  Download,
  FileAudio,
  FileText,
  FileVideo,
  Image as ImageIcon,
  Info,
  Paperclip,
  Share2,
  Smile,
  Users,
} from "lucide-react";
import type { ComponentType } from "react";

import {
  Attachment,
  AttachmentAction,
  AttachmentActions,
  AttachmentContent,
  AttachmentDescription,
  AttachmentGroup,
  AttachmentMedia,
  AttachmentTitle,
} from "@/components/ui/attachment";
import { Avatar, AvatarFallback } from "@/components/ui/avatar";
import { Badge } from "@/components/ui/badge";
import { Bubble, BubbleContent } from "@/components/ui/bubble";
import { Marker, MarkerContent, MarkerIcon } from "@/components/ui/marker";
import {
  Message,
  MessageAvatar,
  MessageContent,
  MessageFooter,
  MessageHeader,
} from "@/components/ui/message";
import { cn, initials } from "@/lib/utils";
import type { ConversationMessage } from "@/lib/api";

type MessageAttachment = ConversationMessage["attachments"][number];

/** Quién firma un bloque. `null` en el autor propio significa el contacto. */
export type MessageAuthor = {
  key: string;
  name: string;
  /** Un saliente de otro colaborador no se atribuye a una persona. */
  anonymousTeam: boolean;
};

const messageStatusLabels: Record<ConversationMessage["status"], string> = {
  received: "Recibido",
  queued: "En cola",
  sent: "Enviado",
  delivered: "Entregado",
  read: "Leído",
  failed: "No enviado",
  delivery_unknown: "Confirmación pendiente",
};

const attachmentTypeLabels: Record<MessageAttachment["type"], string> = {
  image: "Imagen",
  video: "Video",
  audio: "Audio",
  file: "Archivo",
  sticker: "Sticker",
  share: "Contenido compartido",
  unsupported: "Adjunto",
};

const attachmentIcons: Record<MessageAttachment["type"], ComponentType<{ className?: string }>> = {
  image: ImageIcon,
  video: FileVideo,
  audio: FileAudio,
  file: FileText,
  sticker: Smile,
  share: Share2,
  unsupported: Paperclip,
};

/** Estados que piden atención y no pueden quedar tapados por el pie del bloque. */
function attentionStatus(status: ConversationMessage["status"]): "destructive" | "secondary" | null {
  if (status === "failed") return "destructive";
  if (status === "delivery_unknown") return "secondary";
  return null;
}

function formatBytes(byteSize: number | null): string {
  if (byteSize === null) return "tamaño desconocido";
  if (byteSize < 1024) return `${byteSize} B`;
  const kib = byteSize / 1024;
  if (kib < 1024) return `${Math.round(kib)} KiB`;
  return `${(kib / 1024).toFixed(1)} MiB`;
}

function attachmentHref(conversationId: string, attachmentId: string): string {
  return `/api/conversations/${encodeURIComponent(conversationId)}/attachments/${encodeURIComponent(attachmentId)}`;
}

function formatTime(occurredAt: string): string {
  return new Date(occurredAt).toLocaleTimeString([], {
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Un medio recibido antes de que el canal conservara sus adjuntos no deja fila
 * en `message_attachments`, así que el mensaje llega sin texto y sin adjuntos.
 * `messageType` es lo único que dice qué era, y sin él la fila quedaría reducida
 * a su hora, como si el mensaje no existiera.
 */
function MissingContent({
  className,
  messageType,
}: {
  className?: string;
  messageType: ConversationMessage["messageType"];
}) {
  if (messageType === "text") {
    return (
      <Bubble className={className} variant="outline">
        <BubbleContent>Mensaje sin contenido</BubbleContent>
      </Bubble>
    );
  }
  const Icon = attachmentIcons[messageType];
  return (
    <Attachment className={className} state="error">
      <AttachmentMedia>
        <Icon />
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{attachmentTypeLabels[messageType]}</AttachmentTitle>
        <AttachmentDescription>No se conservó desde el canal</AttachmentDescription>
      </AttachmentContent>
    </Attachment>
  );
}

function ConversationAttachment({
  attachment,
  conversationId,
}: {
  attachment: MessageAttachment;
  conversationId: string;
}) {
  const label = attachmentTypeLabels[attachment.type];
  const title = attachment.filename ?? label;
  const Icon = attachmentIcons[attachment.type];

  // Un adjunto que el canal no pudo entregar no recibe enlace: la descarga
  // responde 409 y un enlace roto haría creer que el archivo existe.
  if (attachment.status !== "stored") {
    return (
      <Attachment state="error">
        <AttachmentMedia>
          <Icon />
        </AttachmentMedia>
        <AttachmentContent>
          <AttachmentTitle>{title}</AttachmentTitle>
          <AttachmentDescription>{label} no disponible</AttachmentDescription>
        </AttachmentContent>
      </Attachment>
    );
  }

  const href = attachmentHref(conversationId, attachment.id);
  const isImage = attachment.type === "image" || attachment.type === "sticker";

  return (
    <Attachment state="done">
      <AttachmentMedia variant={isImage ? "image" : "icon"}>
        {isImage ? <img alt={title} src={href} /> : <Icon />}
      </AttachmentMedia>
      <AttachmentContent>
        <AttachmentTitle>{title}</AttachmentTitle>
        <AttachmentDescription>
          {label} · {formatBytes(attachment.byteSize)}
        </AttachmentDescription>
        {/* El reproductor vive dentro de la tarjeta para que cada hijo del
            grupo siga siendo un adjunto y conserve su ancho al desplazarse. */}
        {attachment.type === "audio" ? (
          // El ancho es explícito porque la tarjeta se dimensiona a su
          // contenido: con `w-full` el reproductor colapsa y queda inservible.
          <audio className="mt-1.5 w-64 max-w-full" controls src={href}>
            {label}
          </audio>
        ) : null}
      </AttachmentContent>
      <AttachmentActions>
        <AttachmentAction aria-label={`Abrir ${title}`} asChild>
          <a href={href} rel="noreferrer" target="_blank">
            <Download />
          </a>
        </AttachmentAction>
      </AttachmentActions>
    </Attachment>
  );
}

export function SystemNote({ message }: { message: ConversationMessage }) {
  return (
    <Marker>
      <MarkerIcon>
        <Info />
      </MarkerIcon>
      <MarkerContent>
        {message.text ?? messageStatusLabels[message.status]} ·{" "}
        {formatTime(message.occurredAt)}
      </MarkerContent>
    </Marker>
  );
}

/**
 * Un mensaje, con el avatar y el nombre solo si abre su bloque de autor y el pie
 * de estado solo si lo cierra. Un mensaje intermedio que pide atención conserva
 * su propia etiqueta, para que el estado del bloque no tape un fallo.
 *
 * Es una fila por mensaje y no por bloque porque el scroller detecta el prepend
 * de historial comparando la identidad del nodo que era el primer hijo, y solo
 * el identificador del mensaje es estable ante prepend y append.
 */
export function ConversationMessageRow({
  author,
  conversationId,
  endsGroup,
  message,
  startsGroup,
}: {
  author: MessageAuthor;
  conversationId: string;
  endsGroup: boolean;
  message: ConversationMessage;
  startsGroup: boolean;
}) {
  const outgoing = message.direction === "outgoing";
  const align = outgoing ? "end" : "start";
  // `MessageContent` declara la alineación de sus hijos genéricos con una
  // variante que Tailwind no compila, así que los que no son burbujas la
  // reciben aquí.
  const alignChild = outgoing ? "self-end" : undefined;
  const attention = attentionStatus(message.status);

  return (
    <Message align={align}>
      <MessageAvatar>
        {startsGroup ? (
          <Avatar>
            <AvatarFallback>
              {author.anonymousTeam ? <Users className="size-4" /> : initials(author.name)}
            </AvatarFallback>
          </Avatar>
        ) : null}
      </MessageAvatar>
      <MessageContent>
        {startsGroup ? (
          <MessageHeader className="max-w-full">
            <span className="truncate">{author.name}</span>
          </MessageHeader>
        ) : null}
        {message.text ? (
          <Bubble align={align} variant={outgoing ? "default" : "muted"}>
            <BubbleContent className="whitespace-pre-wrap">{message.text}</BubbleContent>
          </Bubble>
        ) : null}
        {message.attachments.length > 0 ? (
          <AttachmentGroup className={cn(alignChild)}>
            {message.attachments.map((attachment) => (
              <ConversationAttachment
                attachment={attachment}
                conversationId={conversationId}
                key={attachment.id}
              />
            ))}
          </AttachmentGroup>
        ) : null}
        {!message.text && message.attachments.length === 0 ? (
          <MissingContent className={cn(alignChild)} messageType={message.messageType} />
        ) : null}
        {attention && !endsGroup ? (
          <Badge className={cn(alignChild)} variant={attention}>
            {messageStatusLabels[message.status]} · {formatTime(message.occurredAt)}
          </Badge>
        ) : null}
        {endsGroup ? (
          <MessageFooter className="gap-2">
            {attention ? (
              <Badge variant={attention}>{messageStatusLabels[message.status]}</Badge>
            ) : (
              <span>{messageStatusLabels[message.status]}</span>
            )}
            <span>{formatTime(message.occurredAt)}</span>
          </MessageFooter>
        ) : null}
      </MessageContent>
    </Message>
  );
}
