export type OrganizationAccess = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  membershipId: string;
  role: "owner" | "manager" | "operator";
  permissions: string[];
};

export type AppContext = {
  user: { id: string; name: string; email: string };
  organizations: OrganizationAccess[];
  activeOrganization: OrganizationAccess | null;
  requiresOrganizationSelection: boolean;
};

type ErrorEnvelope = {
  error?: { code?: string; message?: string; correlationId?: string };
  message?: string;
};

async function parseError(response: Response, fallback: string) {
  const body = (await response.json().catch(() => ({}))) as ErrorEnvelope;
  return body.error?.message ?? body.message ?? fallback;
}

export async function getSetupStatus(): Promise<boolean> {
  const response = await fetch("/api/setup/status", { credentials: "same-origin" });
  if (!response.ok) throw new Error("No fue posible comprobar la instalación.");
  const body = (await response.json()) as { required: boolean };
  return body.required;
}

export async function completeSetup(input: {
  setupToken: string;
  organizationName: string;
  organizationSlug: string;
  ownerName: string;
  ownerEmail: string;
  ownerPassword: string;
}): Promise<void> {
  const response = await fetch("/api/setup", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  if (!response.ok) {
    throw new Error(
      await parseError(response, "No fue posible completar la configuración."),
    );
  }
}

export async function signIn(email: string, password: string): Promise<void> {
  const response = await fetch("/api/auth/sign-in/email", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email, password }),
  });
  if (!response.ok) {
    throw new Error(
      await parseError(response, "Correo o contraseña incorrectos."),
    );
  }
}

export async function signOut(): Promise<void> {
  await fetch("/api/auth/sign-out", {
    method: "POST",
    credentials: "same-origin",
  });
}

export async function getAppContext(): Promise<AppContext> {
  const response = await fetch("/api/context", { credentials: "same-origin" });
  if (response.status === 401) throw new Error("UNAUTHENTICATED");
  if (!response.ok) {
    throw new Error(
      await parseError(response, "No fue posible cargar tu espacio de trabajo."),
    );
  }
  return response.json() as Promise<AppContext>;
}

export async function selectOrganization(organizationId: string): Promise<void> {
  const response = await fetch("/api/context/organization", {
    method: "POST",
    credentials: "same-origin",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ organizationId }),
  });
  if (!response.ok) {
    throw new Error(
      await parseError(response, "No fue posible cambiar de organización."),
    );
  }
}
