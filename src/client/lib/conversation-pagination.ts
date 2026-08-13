import type { ConversationMessage, ConversationSummary } from "@/lib/api";

/**
 * Fusiona páginas del historial conservando lo ya cargado.
 *
 * El hilo se refresca por WebSocket y por polling con la primera página, así que
 * reemplazar el arreglo descartaría las páginas antiguas que el usuario acaba de
 * cargar al desplazarse hacia arriba. La copia entrante gana para que un cambio
 * de estado de entrega se aplique, y el orden reproduce el del servidor.
 */
export function mergeMessages(
  previous: ConversationMessage[],
  incoming: ConversationMessage[],
): ConversationMessage[] {
  const byId = new Map(previous.map((message) => [message.id, message]));
  for (const message of incoming) byId.set(message.id, message);
  return [...byId.values()].sort(compareByOccurrence);
}

function compareByOccurrence(a: ConversationMessage, b: ConversationMessage): number {
  if (a.occurredAt !== b.occurredAt) return a.occurredAt < b.occurredAt ? -1 : 1;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

/**
 * Fusiona páginas de la lista. Una conversación que recibe un mensaje cambia su
 * `lastMessageAt` y sube, así que reordenar tras fusionar mantiene la lista
 * coherente con el orden del servidor.
 */
export function mergeConversations(
  previous: ConversationSummary[],
  incoming: ConversationSummary[],
): ConversationSummary[] {
  const byId = new Map(previous.map((conversation) => [conversation.id, conversation]));
  for (const conversation of incoming) byId.set(conversation.id, conversation);
  return [...byId.values()].sort(compareByActivity);
}

function compareByActivity(a: ConversationSummary, b: ConversationSummary): number {
  if (a.lastMessageAt !== b.lastMessageAt) return a.lastMessageAt > b.lastMessageAt ? -1 : 1;
  return a.id > b.id ? -1 : a.id < b.id ? 1 : 0;
}
