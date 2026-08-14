import { CommunicationChannelRepository } from "./communication-channel-repository";
import { ContactRepository } from "./contact-repository";
import { InboundWebhookEventRepository } from "./inbound-webhook-event-repository";
import { NoteRepository } from "./note-repository";
import { OpportunityRepository } from "./opportunity-repository";
import { OrganizationRepository } from "./organization-repository";
import { PipelineRepository } from "./pipeline-repository";
import { ServiceRepository } from "./service-repository";

export { CommunicationChannelRepository } from "./communication-channel-repository";
export { ContactRepository } from "./contact-repository";
export { InboundWebhookEventRepository } from "./inbound-webhook-event-repository";
export { NoteRepository } from "./note-repository";
export { OpportunityRepository } from "./opportunity-repository";
export { OrganizationRepository } from "./organization-repository";
export { PipelineRepository } from "./pipeline-repository";
export { ServiceRepository } from "./service-repository";

export type Repositories = {
  organizations: OrganizationRepository;
  contacts: ContactRepository;
  services: ServiceRepository;
  pipelines: PipelineRepository;
  opportunities: OpportunityRepository;
  notes: NoteRepository;
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
    pipelines: new PipelineRepository(db),
    opportunities: new OpportunityRepository(db),
    notes: new NoteRepository(db),
    communicationChannels: new CommunicationChannelRepository(db),
    inboundWebhookEvents: new InboundWebhookEventRepository(db),
  };
}
