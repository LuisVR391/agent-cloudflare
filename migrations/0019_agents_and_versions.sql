-- Migración 0019: el agente configurable de la organización, la revisión
-- inmutable que define su comportamiento y el historial de su publicación
-- (ADR-0014).
--
-- Hasta aquí no existía la noción de agente. El runtime durable no tenía
-- configuración que cargar, así que cualquier respuesta automática habría sido
-- comportamiento incrustado en código, igual para todas las empresas e
-- imposible de auditar cuando cambiara.
--
-- El agente es configuración reutilizable; la versión es una revisión inmutable
-- de esa configuración. Publicar una versión nueva no reescribe lo que ya
-- ocurrió, y por eso el contenido de una versión publicada no vuelve a
-- editarse: lo único que cambia es cuál está publicada.
--
-- Este corte no ejecuta nada. Ninguna consulta lee todavía la versión publicada,
-- así que ninguna conversación cambia de comportamiento; llamar a un modelo es
-- el corte 3.2.
--
-- No hay sección de catálogo de permisos, a diferencia de los cortes de Fase 2:
-- `agents.read` y `agents.manage` están en `permissionDefinitions` desde el
-- commit que creó `0002`, y `AuthorizationRepository.seedOwner` es la única ruta
-- de instalación, de modo que ninguna organización instalada carece de ellos.
-- Este corte no introduce ningún permiso.

CREATE TABLE agents (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  -- Nombre plegado a minúsculas y sin espacios en los extremos, como en
  -- `services` y `contact_tags`: la unicidad no debe depender de mayúsculas y
  -- SQLite no aplica `NOCASE` fuera de ASCII, así que se calcula en el
  -- repositorio.
  normalized_name TEXT NOT NULL,
  -- Para qué sirve el agente, en las palabras de la empresa. Es opcional porque
  -- no debe bloquear el alta, y no es una instrucción al modelo: lo que define
  -- el comportamiento vive en la versión, que es lo que se congela al publicar.
  purpose TEXT,
  status TEXT NOT NULL DEFAULT 'active'
    CHECK (status IN ('active', 'archived')),
  created_by_membership_id TEXT NOT NULL,
  -- Concurrencia optimista de la configuración completa: renombrar el agente,
  -- crear o editar un borrador, y publicar, desactivar o revertir exigen la
  -- versión vigente del agente y la incrementan. Un solo punto de versión evita
  -- que dos cambios simultáneos se pisen, igual que en `pipelines` (0013), y da
  -- a las tablas hijas una concurrencia que por sí solas no tendrían.
  --
  -- No confundir con `agent_versions.version_number`, que es el ordinal de una
  -- revisión y no un contador de escrituras.
  version INTEGER NOT NULL DEFAULT 1,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  -- `RESTRICT` sobre la membresía: el agente conserva quién lo creó. Retirar a
  -- alguien del equipo se hace cambiando el estado de su membresía, no borrando
  -- su rastro.
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE RESTRICT
);

-- Un agente no se borra: se archiva, porque sus versiones y su historial deben
-- seguir explicando con qué configuración se respondió. El nombre sigue siendo
-- único dentro de la organización aunque esté archivado, de modo que reactivarlo
-- no compita con un duplicado creado mientras tanto.
CREATE UNIQUE INDEX agents_organization_normalized_name_unique
  ON agents (organization_id, normalized_name);

-- El panel los lista por estado y en orden alfabético dentro de la organización.
CREATE INDEX agents_organization_status_name_idx
  ON agents (organization_id, status, normalized_name);

-- Necesario para las claves foráneas compuestas de las tablas siguientes:
-- SQLite exige un índice único sobre las columnas padre.
CREATE UNIQUE INDEX agents_organization_id_unique
  ON agents (organization_id, id);

-- La revisión inmutable. Es lo que responde «¿con qué configuración se
-- respondió esta conversación?», así que su contenido queda congelado en cuanto
-- se publica por primera vez.
CREATE TABLE agent_versions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  -- Ordinal correlativo dentro del agente. Es el `agentVersion` que los
  -- contratos transversales ya fijan en `AgentExecutionContext`, y por eso es un
  -- entero y no un identificador. Se asigna en la misma sentencia que inserta,
  -- para que dos borradores simultáneos no compitan por el mismo número.
  version_number INTEGER NOT NULL,
  -- `draft` es editable; `published` y `archived` no vuelven a serlo nunca. Una
  -- versión no regresa a borrador, de modo que `status <> 'draft'` significa
  -- exactamente «contenido congelado» y no hace falta una segunda columna que
  -- repita ese hecho.
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN ('draft', 'published', 'archived')),
  instructions TEXT NOT NULL,
  -- Identificador opaco del modelo previsto, sin `CHECK` ni catálogo: qué
  -- contrato aísla el runtime del proveedor de inferencia se decide en el corte
  -- 3.2, y fijar aquí una lista de modelos anticiparía esa decisión. No guarda
  -- credencial alguna; los secretos pertenecen a Cloudflare Secrets.
  model TEXT NOT NULL,
  playbook TEXT,
  -- Por qué el contenido de esta revisión difiere del de la anterior. No es el
  -- motivo de una publicación, que responde otra pregunta y vive en el
  -- historial.
  change_reason TEXT,
  created_by_membership_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agents (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, created_by_membership_id)
    REFERENCES memberships (organization_id, id) ON DELETE RESTRICT
);

-- El ordinal identifica la revisión dentro del agente. El índice sirve además
-- para listar las versiones de la más reciente a la más antigua, porque SQLite
-- recorre un índice en orden inverso.
CREATE UNIQUE INDEX agent_versions_organization_agent_number_unique
  ON agent_versions (organization_id, agent_id, version_number);

-- A lo sumo una versión publicada por agente, garantizado por el motor y no por
-- el repositorio: una segunda ruta de escritura no puede saltarse un índice. El
-- precedente es `organization_invitations_pending_unique` (0011).
--
-- SQLite valida la unicidad sentencia a sentencia y no al cerrar la
-- transacción, así que el lote que publica debe archivar primero la versión
-- vigente y publicar después la destino. Invertir ese orden hace fallar el lote
-- entero, igual que advierte `pipeline_stages` sobre el intercambio de
-- posiciones (0013).
CREATE UNIQUE INDEX agent_versions_published_unique
  ON agent_versions (organization_id, agent_id)
  WHERE status = 'published';

-- Necesario para las claves foráneas compuestas de las tablas siguientes.
CREATE UNIQUE INDEX agent_versions_organization_id_unique
  ON agent_versions (organization_id, id);

-- Lo que una versión declara que usará. Todavía no autoriza nada: no existe
-- catálogo de herramientas ni índice de conocimiento, y este corte no ejecuta.
-- El catálogo y la validación referencial llegan con las herramientas
-- autorizadas y con el conocimiento aislado; hasta entonces son etiquetas
-- opacas cuya forma valida el backend, no su pertenencia a un conjunto cerrado,
-- porque ese conjunto no existe.
--
-- Van en tablas hijas y no en una columna JSON: el esquema no tiene ninguna, un
-- arreglo JSON no impide un elemento repetido y no permite preguntar qué
-- versiones declaran una herramienta sin recorrer la tabla entera, que es
-- justamente la consulta que la autorización de herramientas necesitará para
-- auditar antes de habilitar nada. La forma es la de `contact_tag_assignments`
-- (0010): clave primaria compuesta, sin identificador sustituto.
CREATE TABLE agent_version_tools (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_version_id TEXT NOT NULL,
  tool_key TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, agent_version_id, tool_key),
  FOREIGN KEY (organization_id, agent_version_id)
    REFERENCES agent_versions (organization_id, id) ON DELETE CASCADE
);

-- «Qué versiones declaran esta herramienta» es la consulta inversa que el corte
-- de herramientas autorizadas necesitará.
CREATE INDEX agent_version_tools_organization_tool_idx
  ON agent_version_tools (organization_id, tool_key);

CREATE TABLE agent_version_knowledge_scopes (
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_version_id TEXT NOT NULL,
  label TEXT NOT NULL,
  -- La unicidad se aplica sobre la etiqueta normalizada, como el nombre de un
  -- servicio: dos alcances que solo difieren en mayúsculas son el mismo alcance.
  normalized_label TEXT NOT NULL,
  declared_at TEXT NOT NULL,
  PRIMARY KEY (organization_id, agent_version_id, normalized_label),
  FOREIGN KEY (organization_id, agent_version_id)
    REFERENCES agent_versions (organization_id, id) ON DELETE CASCADE
);

CREATE INDEX agent_version_knowledge_scopes_organization_label_idx
  ON agent_version_knowledge_scopes (organization_id, normalized_label);

-- Historial de publicación: qué versión quedó publicada, quién lo decidió,
-- cuándo y por qué. Es append-only y es el único dueño de «cuándo se publicó
-- esta versión»; por eso `agent_versions` no guarda ese instante.
--
-- `reason` es obligatorio, a diferencia del motivo de una revisión: el criterio
-- de salida del corte exige que el historial conserve el porqué de cada cambio,
-- y una columna nullable no lo garantizaría.
--
-- A diferencia de `conversation_assignments` o `appointment_transitions`, esta
-- tabla sí persiste la acción. Su significado no se lee de las dos columnas:
-- depende de comparar los ordinales de dos versiones, y guardar la conclusión
-- mantiene el historial legible aunque un corte posterior cambie cómo se
-- asignan esos ordinales.
CREATE TABLE agent_publication_transitions (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  agent_id TEXT NOT NULL,
  -- Nulo en la primera publicación y en la que sigue a una desactivación.
  previous_version_id TEXT,
  -- Nulo al desactivar: el agente se queda sin versión publicada, pero ninguna
  -- versión desaparece.
  next_version_id TEXT,
  action TEXT NOT NULL
    CHECK (action IN ('published', 'unpublished', 'rolled_back')),
  reason TEXT NOT NULL,
  actor_type TEXT NOT NULL CHECK (actor_type IN ('staff', 'system')),
  -- Identificador del actor, sin clave foránea, como `audit_logs.actor_id`: el
  -- historial conserva quién publicó aunque esa cuenta desaparezca.
  actor_id TEXT,
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  -- Una transición sin extremos no describe ningún cambio, y una que sale y
  -- llega a la misma versión tampoco.
  CHECK (previous_version_id IS NOT NULL OR next_version_id IS NOT NULL),
  CHECK (previous_version_id IS NULL OR previous_version_id <> next_version_id),
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agents (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, previous_version_id)
    REFERENCES agent_versions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, next_version_id)
    REFERENCES agent_versions (organization_id, id) ON DELETE CASCADE
);

-- El detalle del agente lee su historial de lo más reciente a lo más antiguo; el
-- identificador desempata dos cambios registrados en el mismo instante.
CREATE INDEX agent_publication_transitions_organization_agent_idx
  ON agent_publication_transitions (organization_id, agent_id, occurred_at DESC, id DESC);
