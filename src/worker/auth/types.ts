export type AuthBindings = {
  BETTER_AUTH_SECRET: string;
  AUTH_SETUP_TOKEN: string;
  BETTER_AUTH_URL?: string;
};

export type WorkerEnv = Env & AuthBindings;

export type AuthenticatedUser = {
  id: string;
  name: string;
  email: string;
};

export type OrganizationAccess = {
  organizationId: string;
  organizationName: string;
  organizationSlug: string;
  membershipId: string;
  role: "owner" | "manager" | "operator";
  permissions: string[];
};

export type AuthorizationContext = {
  user: AuthenticatedUser;
  organizations: OrganizationAccess[];
  activeOrganization: OrganizationAccess;
};
