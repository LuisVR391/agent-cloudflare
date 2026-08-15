-- Migración 0018: acceso de lectura a las métricas del proceso y los índices
-- por fecha que su cálculo exige (ADR-0012).
--
-- Las métricas no crean tablas. Se derivan por consulta sobre el historial que
-- ya existe, así que esta migración no añade una segunda representación
-- autoritativa de ningún dato: añade el permiso que autoriza leerlas y los
-- índices sin los cuales cada consulta recorrería la tabla completa.

-- ────────────────────── Índices por organización y fecha ──────────────────────

-- ADR-0012 los declara obligatorios: el rango acotado es el control de costo, y
-- sin un índice que empiece por la organización y siga por la fecha, acotar el
-- periodo no evita el escaneo.

-- Mensajes recibidos, conversaciones activas e intervenciones humanas parten de
-- la misma exploración: los mensajes de la organización dentro del periodo. La
-- dirección entra en el índice porque separa las tres preguntas sin volver a la
-- fila.
CREATE INDEX messages_organization_occurred_idx
  ON messages (organization_id, occurred_at, direction);

-- Las oportunidades ya se indexan por etapa y por actividad reciente, pero
-- «cuántas se abrieron en este periodo» ordena por creación, que es otra
-- columna.
CREATE INDEX opportunities_organization_created_idx
  ON opportunities (organization_id, created_at);

-- Los contactos nuevos usan `contacts_organization_created_idx` (`0001`) y las
-- citas del periodo `appointments_organization_starts_idx` (`0017`). No se
-- duplican.

-- ────────────────────── Catálogo de permisos ────────────────────────

-- `permissions` es global y su clave es única, así que una instalación nueva
-- que ya lo sembró no produce duplicados.
INSERT INTO permissions (id, permission_key, description, created_at, updated_at)
VALUES
  (lower(hex(randomblob(16))), 'metrics.read', 'Consultar las métricas del proceso',
   strftime('%Y-%m-%dT%H:%M:%fZ', 'now'), strftime('%Y-%m-%dT%H:%M:%fZ', 'now'))
  ON CONFLICT (permission_key) DO NOTHING;

-- Los tres roles las consultan. Son agregados del proceso, no datos personales
-- del contacto ni contenido de mensajes, y quien atiende la conversación es
-- quien produce la mayoría de esas cifras: ocultarle el efecto de su trabajo no
-- protege nada.
INSERT INTO role_permissions (organization_id, role_id, permission_id, granted_at)
SELECT r.organization_id, r.id, p.id, strftime('%Y-%m-%dT%H:%M:%fZ', 'now')
  FROM roles r
  JOIN permissions p ON p.permission_key = 'metrics.read'
 WHERE r.role_key IN ('owner', 'manager', 'operator')
  ON CONFLICT (organization_id, role_id, permission_id) DO NOTHING;
