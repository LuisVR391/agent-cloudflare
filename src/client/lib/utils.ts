import { type ClassValue, clsx } from "clsx";
import { twMerge } from "tailwind-merge";

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Iniciales para un avatar. Un contacto de WhatsApp sin nombre declarado llega
 * como identificador sin espacios (`MX.2120917455352302`), así que tomar solo la
 * inicial de cada palabra dejaría una única letra: en ese caso se usan los dos
 * primeros caracteres alfanuméricos.
 */
export function initials(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  const fromWords = words
    .slice(0, 2)
    .map((word) => word.replace(/[^\p{L}\p{N}]/gu, "").charAt(0))
    .join("");
  if (fromWords.length > 1) return fromWords.toUpperCase();
  const alphanumeric = name.replace(/[^\p{L}\p{N}]/gu, "");
  return (alphanumeric.slice(0, 2) || "?").toUpperCase();
}
