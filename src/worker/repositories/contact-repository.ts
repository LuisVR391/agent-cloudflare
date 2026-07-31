import {
  ContactNotInOrganizationError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  Contact,
  ContactIdentity,
  CreateContactInput,
  IdentityProvider,
  LinkContactIdentityInput,
} from "../domain/types";
import {
  type ContactIdentityRow,
  type ContactRow,
  toContact,
  toContactIdentity,
} from "./row-mapping";

const defaultListLimit = 50;

/**
 * Acceso a contactos e identidades externas. Todo método recibe
 * `organizationId` como primer parámetro y lo incluye en su cláusula `WHERE`:
 * una consulta sin organización falla antes de tocar D1 (ADR-0006).
 */
export class ContactRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  async create(
    organizationId: string,
    input: CreateContactInput = {},
  ): Promise<Contact> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.create",
    );
    const now = new Date().toISOString();

    const row = await this.#db
      .prepare(
        `INSERT INTO contacts (id, organization_id, display_name, status, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?)
         RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.displayName ?? null,
        input.status ?? "active",
        now,
        now,
      )
      .first<ContactRow>();

    if (row === null) {
      throw new Error("No se pudo crear el contacto.");
    }

    return toContact(row);
  }

  async findById(
    organizationId: string,
    contactId: string,
  ): Promise<Contact | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.findById",
    );

    const row = await this.#db
      .prepare(`SELECT * FROM contacts WHERE organization_id = ? AND id = ?`)
      .bind(scope, contactId)
      .first<ContactRow>();

    return row === null ? null : toContact(row);
  }

  async listByOrganization(
    organizationId: string,
    options: { limit?: number } = {},
  ): Promise<Contact[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.listByOrganization",
    );

    const { results } = await this.#db
      .prepare(
        `SELECT * FROM contacts
         WHERE organization_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(scope, options.limit ?? defaultListLimit)
      .all<ContactRow>();

    return results.map(toContact);
  }

  /**
   * Vincula una identidad externa al contacto. Es idempotente dentro de la
   * organización: repetir la llamada con el mismo proveedor e identificador
   * externo devuelve la identidad existente sin reasignarla a otro contacto.
   *
   * Las claves foráneas de `contact_identities` validan `organization_id` y
   * `contact_id` por separado, pero no que el contacto pertenezca a esa
   * organización. El `INSERT ... SELECT` toma el contacto de una consulta ya
   * filtrada por organización, de modo que la comprobación es parte de la
   * misma sentencia y no deja ventana entre verificar e insertar.
   */
  async linkIdentity(
    organizationId: string,
    input: LinkContactIdentityInput,
  ): Promise<ContactIdentity> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.linkIdentity",
    );
    const now = new Date().toISOString();

    const row = await this.#db
      .prepare(
        `INSERT INTO contact_identities
           (id, organization_id, contact_id, provider, external_id, created_at, updated_at)
         SELECT ?, ?, contacts.id, ?, ?, ?, ?
           FROM contacts
          WHERE contacts.organization_id = ? AND contacts.id = ?
         ON CONFLICT (organization_id, provider, external_id)
         DO UPDATE SET updated_at = excluded.updated_at
         RETURNING *`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.provider,
        input.externalId,
        now,
        now,
        scope,
        input.contactId,
      )
      .first<ContactIdentityRow>();

    // Sin filas candidatas: el contacto no existe dentro de la organización,
    // así que no hubo inserción ni conflicto que resolver.
    if (row === null) {
      throw new ContactNotInOrganizationError(input.contactId);
    }

    return toContactIdentity(row);
  }

  async findByExternalIdentity(
    organizationId: string,
    provider: IdentityProvider,
    externalId: string,
  ): Promise<Contact | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.findByExternalIdentity",
    );

    const row = await this.#db
      .prepare(
        `SELECT contacts.* FROM contacts
         JOIN contact_identities
           ON contact_identities.contact_id = contacts.id
          AND contact_identities.organization_id = contacts.organization_id
         WHERE contacts.organization_id = ?
           AND contact_identities.provider = ?
           AND contact_identities.external_id = ?`,
      )
      .bind(scope, provider, externalId)
      .first<ContactRow>();

    return row === null ? null : toContact(row);
  }
}
