import { CommunicationChannelRepository } from "./communication-channel-repository";
import { ContactRepository } from "./contact-repository";
import { InboundWebhookEventRepository } from "./inbound-webhook-event-repository";
import { OrganizationRepository } from "./organization-repository";
import { ServiceRepository } from "./service-repository";

export { CommunicationChannelRepository } from "./communication-channel-repository";
export { ContactRepository } from "./contact-repository";
export { InboundWebhookEventRepository } from "./inbound-webhook-event-repository";
export { OrganizationRepository } from "./organization-repository";
export { ServiceRepository } from "./service-repository";

export type Repositories = {
  organizations: OrganizationRepository;
  contacts: ContactRepository;
  services: ServiceRepository;
  communicationChannels: CommunicationChannelRepository;
  inboundWebhookEvents: InboundWebhookEventRepository;
};

/**
 * Construye los repositorios a partir del binding tipado. Recibe la base y no
 * el `Env` completo, para que la capa de datos no alcance otros bindings.
 */
export function createRepositories(db: D1Database): Repositories {
  return {
    organizations: new OrganizationRepository(db),
    contacts: new ContactRepository(db),
    services: new ServiceRepository(db),
    communicationChannels: new CommunicationChannelRepository(db),
    inboundWebhookEvents: new InboundWebhookEventRepository(db),
  };
}
