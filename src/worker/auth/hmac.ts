/**
 * HMAC-SHA256 en hexadecimal, la construcción con la que este repositorio
 * deriva valores que se guardan en D1 sin conservar su original: la clave del
 * rate limit y el token de invitación. Vive aquí, y no dentro de quien la usa,
 * para que exista una sola construcción canónica: dos implementaciones podrían
 * divergir en la codificación y producir hashes que no se encuentran entre sí.
 */
export async function hmacHex(secret: string, value: string): Promise<string> {
  const encoder = new TextEncoder();
  const cryptoKey = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const digest = await crypto.subtle.sign("HMAC", cryptoKey, encoder.encode(value));

  return Array.from(new Uint8Array(digest), (byte) =>
    byte.toString(16).padStart(2, "0"),
  ).join("");
}
