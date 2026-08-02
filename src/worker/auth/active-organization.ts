import type { OrganizationAccess } from "./types";

const cookieName = "agent_cloudflare_active_organization";

function parseCookies(header: string | null): Map<string, string> {
  return new Map(
    (header ?? "")
      .split(";")
      .map((part) => part.trim().split("="))
      .filter(([key, value]) => Boolean(key && value))
      .map(([key, value]) => [key, decodeURIComponent(value)]),
  );
}

async function signature(secret: string, organizationId: string) {
  const encoder = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    encoder.encode(secret),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"],
  );
  const bytes = await crypto.subtle.sign(
    "HMAC",
    key,
    encoder.encode(organizationId),
  );

  return btoa(String.fromCharCode(...new Uint8Array(bytes)))
    .replaceAll("+", "-")
    .replaceAll("/", "_")
    .replaceAll("=", "");
}

function signaturesMatch(left: string, right: string): boolean {
  let difference = left.length ^ right.length;
  const length = Math.max(left.length, right.length);
  for (let index = 0; index < length; index += 1) {
    difference |=
      (left.charCodeAt(index) || 0) ^ (right.charCodeAt(index) || 0);
  }
  return difference === 0;
}

export async function readActiveOrganization(
  request: Request,
  secret: string,
  organizations: OrganizationAccess[],
): Promise<OrganizationAccess | null> {
  const raw = parseCookies(request.headers.get("cookie")).get(cookieName);
  if (!raw) return organizations.length === 1 ? organizations[0] : null;

  const separator = raw.lastIndexOf(".");
  if (separator < 1) return null;

  const organizationId = raw.slice(0, separator);
  const providedSignature = raw.slice(separator + 1);
  const expectedSignature = await signature(secret, organizationId);
  if (!signaturesMatch(providedSignature, expectedSignature)) return null;

  return (
    organizations.find(
      (organization) => organization.organizationId === organizationId,
    ) ?? null
  );
}

export async function createActiveOrganizationCookie(
  organizationId: string,
  secret: string,
  authOrigin: string,
): Promise<string> {
  const value = `${organizationId}.${await signature(secret, organizationId)}`;
  const secure = new URL(authOrigin).protocol === "https:" ? "; Secure" : "";

  return `${cookieName}=${encodeURIComponent(value)}; Path=/; HttpOnly; SameSite=Lax; Max-Age=2592000${secure}`;
}
