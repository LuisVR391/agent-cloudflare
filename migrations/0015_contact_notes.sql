-- Migración 0015: la nota del contacto, que conserva lo que se supo de él
-- fuera del mensaje.
--
-- Una conversación registra lo que el contacto dijo; la nota registra lo que el
-- equipo entendió. Por eso pertenece al contacto y no a la conversación: sigue
-- siendo cierta cuando ese hilo se resuelve y aparece en la ficha aunque se
-- haya escrito desde otro canal.
--
-- La conversación de origen se conserva cuando existe, porque explica en qué
-- momento se supo lo que la nota dice. Es opcional: una nota escrita desde el
-- directorio de contactos no tiene ninguna.
--
-- El autor es una membresía, no un usuario: quien escribe lo hace dentro de una
-- organización, y la misma cuenta puede pertenecer a varias. Así «autor con
-- membresía activa» se comprueba dentro de la propia sentencia que inserta.

CREATE TABLE contact_notes (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  contact_id TEXT NOT NULL,
  -- La conversación desde la que se escribió, cuando existe.
  conversation_id TEXT,
  author_membership_id TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- Cada clave foránea incluye `organization_id` en ambos lados: dos claves
  -- independientes serían válidas por separado mientras la combinación cruza el
  -- límite de aislamiento (ADR-0006).
  FOREIGN KEY (organization_id, contact_id)
    REFERENCES contacts (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE CASCADE,
  -- `RESTRICT` sobre la membresía: la nota conserva quién la escribió, así que
  -- una membresía con notas no se borra. Retirar a alguien del equipo se hace
  -- cambiando su estado, no borrando su rastro.
  FOREIGN KEY (organization_id, author_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE RESTRICT
);

-- La ficha del contacto lee por esta ruta y ordena de la más reciente a la más
-- antigua. El identificador desempata para que dos notas del mismo instante no
-- alternen su orden entre lecturas.
CREATE INDEX contact_notes_organization_contact_idx
  ON contact_notes (organization_id, contact_id, created_at DESC, id DESC);

-- El hilo muestra lo que se anotó desde esa conversación.
CREATE INDEX contact_notes_organization_conversation_idx
  ON contact_notes (organization_id, conversation_id, created_at DESC, id DESC);
