import { hmacHex } from "./hmac";

/**
 * Custodia del token de invitación (ADR-0011). El valor en claro solo existe
 * en la respuesta que lo crea y en el enlace que una persona comparte; D1
 * conserva únicamente su HMAC, de modo que un volcado de la base no permite
 * reconstruirlo ni verificar candidatos sin el secreto de sesión.
 *
 * Rotar `BETTER_AUTH_SECRET` invalida las invitaciones vigentes, igual que ya
 * invalida sesiones y cookies de organización. Es una operación planificada y
 * el efecto es el correcto: un secreto rotado no debe seguir autorizando altas
 * emitidas antes.
 */

/** 32 bytes en base64url: 256 bits de entropía en 43 caracteres. */
export function createInvitationToken(): string {
  const bytes = crypto.getRandomValues(new Uint8Array(32));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

export function hashInvitationToken(
  secret: string,
  token: string,
): Promise<string> {
  return hmacHex(secret, `invitation:${token}`);
}

/**
 * El token viaja en el fragmento y no en la query: el fragmento no se envía al
 * servidor, así que no aparece en registros de acceso ni en la cabecera
 * `Referer` de una navegación posterior. El panel lo lee en el navegador y lo
 * reenvía en el cuerpo de una petición al mismo origen.
 */
export function buildInvitationLink(authOrigin: string, token: string): string {
  return `${authOrigin}/invitacion#${token}`;
}
