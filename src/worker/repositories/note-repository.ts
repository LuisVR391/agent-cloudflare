import {
  ContactNotInOrganizationError,
  MembershipNotActiveInOrganizationError,
  requireOrganizationScope,
} from "../domain/errors";
import type { ContactNote, CreateContactNoteInput } from "../domain/types";

type ContactNoteRow = {
  id: string;
  organization_id: string;
  contact_id: string;
  conversation_id: string | null;
  author_membership_id: string;
  author_name: string | null;
  body: string;
  created_at: string;
  updated_at: string;
};

/**
 * El nombre del autor se resuelve en la misma consulta que lee la nota. El
 * `LEFT JOIN` conserva la nota aunque la membresía o la cuenta desaparezcan:
 * el rastro de lo que se anotó sobrevive a la baja de quien lo escribió.
 */
const noteSelect = `SELECT n.id, n.organization_id, n.contact_id,
    n.conversation_id, n.author_membership_id, u.name AS author_name, n.body,
    n.created_at, n.updated_at
  FROM contact_notes n
  LEFT JOIN memberships m
    ON m.organization_id = n.organization_id AND m.id = n.author_membership_id
  LEFT JOIN users u ON u.id = m.user_id`;

function toContactNote(row: ContactNoteRow): ContactNote {
  return {
    id: row.id,
    organizationId: row.organization_id,
    contactId: row.contact_id,
    conversationId: row.conversation_id,
    authorMembershipId: row.author_membership_id,
    authorName: row.author_name,
    body: row.body,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
  };
}

/**
 * Notas del contacto. Todo método recibe `organizationId` como primer parámetro
 * y lo incluye en su cláusula `WHERE`: una consulta sin organización falla
 * antes de tocar D1 (ADR-0006).
 *
 * El cuerpo de una nota es dato personal por contexto, así que nunca sale de
 * aquí hacia un log ni hacia `audit_logs`: la auditoría guarda identificadores.
 */
export class NoteRepository {
  readonly #db: D1Database;

  constructor(db: D1Database) {
    this.#db = db;
  }

  /**
   * Crea la nota resolviendo contacto, conversación y autor dentro de la propia
   * sentencia que inserta, así que no queda ventana entre verificar y escribir.
   * La conversación, además de pertenecer a la organización, debe ser del mismo
   * contacto: una nota anclada a la conversación de otro contaría la historia
   * equivocada en las dos fichas.
   */
  async create(
    organizationId: string,
    input: CreateContactNoteInput,
  ): Promise<ContactNote> {
    const scope = requireOrganizationScope(
      organizationId,
      "NoteRepository.create",
    );
    const now = new Date().toISOString();
    const id = crypto.randomUUID();
    const conversationId = input.conversationId ?? null;

    const insert = await this.#db
      .prepare(
        `INSERT INTO contact_notes
           (id, organization_id, contact_id, conversation_id,
            author_membership_id, body, created_at, updated_at)
         SELECT ?, ?, contacts.id, ?, ?, ?, ?, ?
           FROM contacts
          WHERE contacts.organization_id = ? AND contacts.id = ?
            AND EXISTS (SELECT 1 FROM memberships m
                         WHERE m.organization_id = contacts.organization_id
                           AND m.id = ? AND m.status = 'active')
            AND (? IS NULL OR EXISTS (
                  SELECT 1 FROM conversations cv
                   WHERE cv.organization_id = contacts.organization_id
                     AND cv.id = ? AND cv.contact_id = contacts.id))`,
      )
      .bind(
        id,
        scope,
        conversationId,
        input.authorMembershipId,
        input.body,
        now,
        now,
        scope,
        input.contactId,
        input.authorMembershipId,
        conversationId,
        conversationId,
      )
      .run();

    // Sin filas candidatas no hubo inserción: alguna de las referencias no vive
    // en esta organización. Se distingue después para responder con precisión
    // sin revelar a quién pertenece un identificador ajeno.
    if (insert.meta.changes !== 1) {
      if (!(await this.#isActiveMembership(scope, input.authorMembershipId))) {
        throw new MembershipNotActiveInOrganizationError(
          input.authorMembershipId,
        );
      }
      throw new ContactNotInOrganizationError(input.contactId);
    }

    const created = await this.find(scope, id);
    if (created === null) throw new Error("CONTACT_NOTE_CREATION_FAILED");
    return created;
  }

  /** Notas del contacto, de la más reciente a la más antigua. */
  async listByContact(
    organizationId: string,
    contactId: string,
    options: { limit?: number } = {},
  ): Promise<ContactNote[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "NoteRepository.listByContact",
    );
    const { results } = await this.#db
      .prepare(
        `${noteSelect}
          WHERE n.organization_id = ? AND n.contact_id = ?
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT ?`,
      )
      .bind(scope, contactId, options.limit ?? 50)
      .all<ContactNoteRow>();

    return results.map(toContactNote);
  }

  /** Notas escritas desde una conversación concreta. */
  async listByConversation(
    organizationId: string,
    conversationId: string,
    options: { limit?: number } = {},
  ): Promise<ContactNote[]> {
    const scope = requireOrganizationScope(
      organizationId,
      "NoteRepository.listByConversation",
    );
    const { results } = await this.#db
      .prepare(
        `${noteSelect}
          WHERE n.organization_id = ? AND n.conversation_id = ?
          ORDER BY n.created_at DESC, n.id DESC
          LIMIT ?`,
      )
      .bind(scope, conversationId, options.limit ?? 50)
      .all<ContactNoteRow>();

    return results.map(toContactNote);
  }

  /** `null` fuera de la organización activa. */
  async find(
    organizationId: string,
    noteId: string,
  ): Promise<ContactNote | null> {
    const scope = requireOrganizationScope(
      organizationId,
      "NoteRepository.find",
    );
    const row = await this.#db
      .prepare(`${noteSelect} WHERE n.organization_id = ? AND n.id = ?`)
      .bind(scope, noteId)
      .first<ContactNoteRow>();

    return row === null ? null : toContactNote(row);
  }

  /**
   * Deja constancia de quién anotó sobre qué contacto. Guarda identificadores;
   * el cuerpo de la nota nunca entra en la auditoría.
   */
  async recordAudit(input: {
    organizationId: string;
    actorId: string;
    noteId: string | null;
    action: "contact_note.create";
    // `audit_logs` solo admite estos tres valores. Cualquier otro rompe el
    // `CHECK` y convierte un rechazo previsto en un fallo del servidor.
    result: "allowed" | "rejected" | "failed";
    correlationId: string;
  }): Promise<void> {
    const scope = requireOrganizationScope(
      input.organizationId,
      "NoteRepository.recordAudit",
    );
    await this.#db
      .prepare(
        `INSERT INTO audit_logs
           (id, organization_id, actor_type, actor_id, action, resource_type,
            resource_id, result, correlation_id, occurred_at)
         VALUES (?, ?, 'staff', ?, ?, 'contact_note', ?, ?, ?, ?)`,
      )
      .bind(
        crypto.randomUUID(),
        scope,
        input.actorId,
        input.action,
        input.noteId,
        input.result,
        input.correlationId,
        new Date().toISOString(),
      )
      .run();
  }

  #isActiveMembership(
    organizationId: string,
    membershipId: string,
  ): Promise<boolean> {
    return this.#db
      .prepare(
        `SELECT 1 AS present FROM memberships
          WHERE organization_id = ? AND id = ? AND status = 'active'`,
      )
      .bind(organizationId, membershipId)
      .first<{ present: number }>()
      .then((row) => row !== null);
  }
}
