-- Migración 0007: marca de lectura humana por conversación.
-- `last_read_at` registra cuándo una persona autorizada leyó la conversación en
-- Agent Cloudflare y permite emitir el acuse hacia el canal sin repetirlo en
-- cada apertura. Nulo significa que nunca se marcó como leída.
-- Es aditiva y no requiere índice: siempre se consulta junto a la fila de la
-- conversación, ya cubierta por `conversations_organization_id_unique`.

ALTER TABLE conversations ADD COLUMN last_read_at TEXT;
