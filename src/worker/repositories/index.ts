import { ContactRepository } from "./contact-repository";
import { OrganizationRepository } from "./organization-repository";

export { ContactRepository } from "./contact-repository";
export { OrganizationRepository } from "./organization-repository";

export type Repositories = {
  organizations: OrganizationRepository;
  contacts: ContactRepository;
};

/**
 * Construye los repositorios a partir del binding tipado. Recibe la base y no
 * el `Env` completo, para que la capa de datos no alcance otros bindings.
 */
export function createRepositories(db: D1Database): Repositories {
  return {
    organizations: new OrganizationRepository(db),
    contacts: new ContactRepository(db),
  };
}
