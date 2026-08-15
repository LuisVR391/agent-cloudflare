export type AuthBindings = {
  BETTER_AUTH_SECRET: string;
  AUTH_SETUP_TOKEN: string;
  BETTER_AUTH_URL: string;
};

export type WorkerEnv = Omit<Env, keyof AuthBindings> & AuthBindings;

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
};

export type OrganizationAccess = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  /**
   * Zona horaria IANA de la organización (ADR-0010). Viaja con el contexto
   * porque toda pantalla que muestre un día —la agenda, hoy— la necesita, y
   * pedirla aparte añadiría una consulta a cada carga del panel.
   */
  organizationTimeZone: string;
  membershipId: string;
  role: "owner" | "manager" | "operator";
  permissions: string[];
};

export type AuthorizationContext = {
  user: AuthenticatedUser;
  organizations: OrganizationAccess[];
  activeOrganization: OrganizationAccess;
};

export type AuthorizationFailure = {
  authorized: false;
  status: 401 | 403 | 409 | 503;
  code:
    | "AUTH_NOT_CONFIGURED"
    | "AUTH_ORIGIN_MISMATCH"
    | "UNAUTHENTICATED"
    | "NO_ORGANIZATION_ACCESS"
    | "ORGANIZATION_SELECTION_REQUIRED";
  message: string;
};

export type AuthorizationResolution =
  | { authorized: true; context: AuthorizationContext }
  | AuthorizationFailure;
