import {
  ContactNotInOrganizationError,
  requireOrganizationScope,
} from "../domain/errors";
import type {
  Contact,
  ContactIdentity,
  ContactProfile,
  ContactTag,
  CreateContactInput,
  IdentityProvider,
  LinkContactIdentityInput,
  PageCursor,
  UpdateContactInput,
} from "../domain/types";
import { escapeLikePattern } from "../http/api-helpers";
import {
  type ContactIdentityRow,
  type ContactRow,
  type ContactTagRow,
  toContact,
  toContactIdentity,
  toContactTag,
} from "./row-mapping";

const defaultListLimit = 50;

const contactColumns = `id, organization_id, display_name, phone_number, email,
  status, version, created_at, updated_at`;

/**
 * Pliega el nombre de la etiqueta para que la unicidad no dependa de
 * mayúsculas ni de espacios en los extremos. SQLite solo aplica `NOCASE` a
 * ASCII, así que la normalización se calcula aquí y se persiste.
 */
function normalizeTagName(name: string): string {
  return name.trim().toLocaleLowerCase("es");
}

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
        `INSERT INTO contacts
           (id, organization_id, display_name, phone_number, email, status,
            created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?, ?)
         RETURNING ${contactColumns}`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.displayName ?? null,
        input.phoneNumber ?? null,
        input.email ?? null,
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
      .prepare(
        `SELECT ${contactColumns} FROM contacts
         WHERE organization_id = ? AND id = ?`,
      )
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
        `SELECT ${contactColumns} FROM contacts
         WHERE organization_id = ?
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(scope, options.limit ?? defaultListLimit)
      .all<ContactRow>();

    return results.map(toContact);
  }

  /**
   * Directorio paginado por la misma tupla que lo ordena. La búsqueda es un
   * `LIKE` acotado sobre nombre, teléfono y correo: los comodines del texto
   * escrito se escapan, de modo que un `%` buscado sea un `%` literal y no
   * devuelva la organización entera.
   */
  async search(
    organizationId: string,
    options: { query?: string; limit: number; cursor?: PageCursor },
  ): Promise<{ contacts: ContactProfile[]; nextCursor: PageCursor | null }> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.search",
    );
    const clauses = ["organization_id = ?"];
    const bindings: unknown[] = [scope];
    const query = options.query?.trim();
    if (query) {
      const pattern = `%${escapeLikePattern(query)}%`;
      clauses.push(
        `(display_name LIKE ? ESCAPE '\\' OR phone_number LIKE ? ESCAPE '\\'
          OR email LIKE ? ESCAPE '\\')`,
      );
      bindings.push(pattern, pattern, pattern);
    }
    if (options.cursor) {
      clauses.push("(created_at < ? OR (created_at = ? AND id < ?))");
      bindings.push(
        options.cursor.timestamp,
        options.cursor.timestamp,
        options.cursor.id,
      );
    }
    // Una fila extra revela si queda página siguiente sin una consulta de conteo.
    bindings.push(options.limit + 1);
    const { results } = await this.#db
      .prepare(
        `SELECT ${contactColumns} FROM contacts
         WHERE ${clauses.join(" AND ")}
         ORDER BY created_at DESC, id DESC
         LIMIT ?`,
      )
      .bind(...bindings)
      .all<ContactRow>();

    const page = results.slice(0, options.limit).map(toContact);
    const tags = await this.#tagsFor(
      scope,
      page.map((contact) => contact.id),
    );
    const last = results.length > options.limit ? page.at(-1) : undefined;
    return {
      contacts: page.map((contact) => ({
        ...contact,
        identities: [],
        tags: tags.get(contact.id) ?? [],
      })),
      nextCursor: last ? { timestamp: last.createdAt, id: last.id } : null,
    };
  }

  /** Ficha completa. Devuelve `null` fuera de la organización activa. */
  async findProfile(
    organizationId: string,
    contactId: string,
  ): Promise<ContactProfile | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.findProfile",
    );
    const contact = await this.findById(scope, contactId);
    if (contact === null) return null;

    const { results: identities } = await this.#db
      .prepare(
        `SELECT * FROM contact_identities
         WHERE organization_id = ? AND contact_id = ?
         ORDER BY created_at, id`,
      )
      .bind(scope, contactId)
      .all<ContactIdentityRow>();
    const tags = await this.#tagsFor(scope, [contactId]);

    return {
      ...contact,
      identities: identities.map(toContactIdentity),
      tags: tags.get(contactId) ?? [],
    };
  }

  /**
   * Concurrencia optimista como en las conversaciones: sin la versión vigente
   * la edición se rechaza en vez de sobrescribir en silencio lo que otra
   * persona acaba de escribir. Un campo ausente se conserva; `null` lo borra.
   */
  async updateProfile(
    organizationId: string,
    contactId: string,
    input: UpdateContactInput,
  ): Promise<ContactProfile | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.updateProfile",
    );
    const current = await this.findById(scope, contactId);
    if (current === null || current.version !== input.expectedVersion) {
      return null;
    }
    const result = await this.#db
      .prepare(
        `UPDATE contacts
            SET display_name = ?, phone_number = ?, email = ?, status = ?,
                version = version + 1, updated_at = ?
          WHERE organization_id = ? AND id = ? AND version = ?`,
      )
      .bind(
        input.displayName === undefined ? current.displayName : input.displayName,
        input.phoneNumber === undefined ? current.phoneNumber : input.phoneNumber,
        input.email === undefined ? current.email : input.email,
        input.status ?? current.status,
        new Date().toISOString(),
        scope,
        contactId,
        input.expectedVersion,
      )
      .run();
    if (result.meta.changes !== 1) return null;

    return this.findProfile(scope, contactId);
  }

  /** Catálogo de etiquetas de la organización, para autocompletar. */
  async listTags(organizationId: string): Promise<ContactTag[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.listTags",
    );
    const { results } = await this.#db
      .prepare(
        `SELECT id, organization_id, name, color, created_at, updated_at
           FROM contact_tags
          WHERE organization_id = ?
          ORDER BY normalized_name`,
      )
      .bind(scope)
      .all<ContactTagRow>();

    return results.map(toContactTag);
  }

  /**
   * Etiqueta al contacto creando la etiqueta si aún no existe. El nombre
   * normalizado la reutiliza dentro de la organización, de modo que escribir
   * «VIP» dos veces no produce dos etiquetas.
   *
   * La asignación toma el contacto de una consulta ya filtrada por
   * organización, así la pertenencia se comprueba dentro de la misma sentencia
   * que escribe y no queda ventana entre verificar e insertar.
   */
  async assignTag(
    organizationId: string,
    input: {
      contactId: string;
      name: string;
      color?: ContactTag["color"];
      assignedBy: string;
    },
  ): Promise<ContactTag> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.assignTag",
    );
    const now = new Date().toISOString();
    const name = input.name.trim();
    const normalized = normalizeTagName(name);

    await this.#db
      .prepare(
        `INSERT INTO contact_tags
           (id, organization_id, name, normalized_name, color, created_at, updated_at)
         VALUES (?, ?, ?, ?, ?, ?, ?)
         ON CONFLICT (organization_id, normalized_name) DO NOTHING`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        name,
        normalized,
        input.color ?? "neutral",
        now,
        now,
      )
      .run();

    const tag = await this.#db
      .prepare(
        `SELECT id, organization_id, name, color, created_at, updated_at
           FROM contact_tags
          WHERE organization_id = ? AND normalized_name = ?`,
      )
      .bind(scope, normalized)
      .first<ContactTagRow>();
    if (tag === null) throw new Error("CONTACT_TAG_RESOLUTION_FAILED");

    const assignment = await this.#db
      .prepare(
        `INSERT INTO contact_tag_assignments
           (organization_id, contact_id, tag_id, assigned_by, assigned_at)
         SELECT ?, contacts.id, ?, ?, ?
           FROM contacts
          WHERE contacts.organization_id = ? AND contacts.id = ?
         ON CONFLICT (organization_id, contact_id, tag_id) DO NOTHING
         RETURNING contact_id`,
      )
      .bind(scope, tag.id, input.assignedBy, now, scope, input.contactId)
      .first<{ contact_id: string }>();

    // Sin filas candidatas no hubo inserción ni conflicto que resolver: el
    // contacto no existe dentro de esta organización. Repetir una asignación
    // ya existente sí produce conflicto, y esa sí es una llamada válida.
    if (assignment === null) {
      const exists = await this.#db
        .prepare(
          `SELECT 1 AS assigned FROM contact_tag_assignments
            WHERE organization_id = ? AND contact_id = ? AND tag_id = ?`,
        )
        .bind(scope, input.contactId, tag.id)
        .first<{ assigned: number }>();
      if (exists === null) {
        throw new ContactNotInOrganizationError(input.contactId);
      }
    }

    return toContactTag(tag);
  }

  /** Quita la etiqueta del contacto. `false` si no la tenía. */
  async removeTag(
    organizationId: string,
    contactId: string,
    tagId: string,
  ): Promise<boolean> {
    const scope = requireOrganizationScope(
      organizationId,
      "ContactRepository.removeTag",
    );
    const result = await this.#db
      .prepare(
        `DELETE FROM contact_tag_assignments
          WHERE organization_id = ? AND contact_id = ? AND tag_id = ?`,
      )
      .bind(scope, contactId, tagId)
      .run();

    return (result.meta.changes ?? 0) === 1;
  }

  /**
   * Deja constancia de quién tocó la ficha. Guarda el identificador del
   * contacto, nunca su teléfono, correo ni nombre: la auditoría no es un
   * segundo lugar donde acaben los datos personales.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    contactId: string;
    action: "contact.profile.update" | "contact.tag.assign" | "contact.tag.remove";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "ContactRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'contact', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.contactId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  async #tagsFor(
    organizationId: string,
    contactIds: string[],
  ): Promise<Map<string, ContactTag[]>> {
    const grouped = new Map<string, ContactTag[]>();
    if (contactIds.length === 0) return grouped;

    const placeholders = contactIds.map(() => "?").join(",");
    const { results } = await this.#db
      .prepare(
        `SELECT a.contact_id, t.id, t.organization_id, t.name, t.color,
                t.created_at, t.updated_at
           FROM contact_tag_assignments a
           JOIN contact_tags t ON t.organization_id = a.organization_id
            AND t.id = a.tag_id
          WHERE a.organization_id = ? AND a.contact_id IN (${placeholders})
          ORDER BY t.normalized_name`,
      )
      .bind(organizationId, ...contactIds)
      .all<ContactTagRow & { contact_id: string }>();

    for (const row of results) {
      const tags = grouped.get(row.contact_id) ?? [];
      tags.push(toContactTag(row));
      grouped.set(row.contact_id, tags);
    }
    return grouped;
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
