-- Migración 0020: qué agente atiende una conversación y la traza de cada corrida
-- del modelo (ADR-0015).
--
-- Hasta aquí la configuración de agentes existía pero nadie la leía: el runtime
-- durable agrupaba los mensajes del buffer y los dejaba esperando a que una
-- persona escribiera. Este corte ejecuta esa configuración, así que necesita dos
-- hechos nuevos: con qué agente responde una conversación, y qué ocurrió cada vez
-- que el modelo fue invocado.
--
-- No introduce ningún permiso. Activar el agente en una conversación es una
-- forma de gestionarla, y `conversations.manage` ya es el privilegio que decide
-- quién responde; separar un permiso propio no protegería nada que ese ya
-- conceda. Por eso, como en `0019`, no hay sección de catálogo que propagar.

-- Qué agente atiende esta conversación. Nullable: una conversación sin agente es
-- exactamente el estado de todas las existentes, y el modo de atención sigue
-- siendo lo que decide si responde.
--
-- Sin clave foránea compuesta, igual que `assigned_membership_id` (0011):
-- `ALTER TABLE ... ADD COLUMN` no admite una referencia de dos columnas en
-- SQLite. La pertenencia se garantiza en la misma sentencia que escribe, que
-- exige un agente activo de la organización con versión publicada, y de forma
-- transitiva en `agent_runs`, cuyas claves foráneas sí son compuestas: una
-- corrida no puede existir contra un agente ajeno.
ALTER TABLE conversations ADD COLUMN agent_id TEXT;

-- La traza de una corrida: qué agente, qué versión, qué la originó, qué produjo
-- y cómo terminó. Es la evidencia sobre la que se colgarán las herramientas, el
-- conocimiento y el costo de los cortes siguientes.
--
-- El modelo no se copia aquí. `agent_versions` es inmutable, de modo que
-- `agent_version_id` ya identifica sin ambigüedad con qué modelo previsto se
-- respondió, y una segunda copia sería un segundo dueño del mismo hecho. La
-- columna del modelo que efectivamente respondió nace con el failover, que es
-- cuando puede diferir del previsto.
--
-- Tampoco conserva el prompt, el texto del mensaje ni la respuesta: el contenido
-- ya tiene dueño en `messages`, y la traza no es un lugar donde duplicar datos
-- personales.
CREATE TABLE agent_runs (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  conversation_id TEXT NOT NULL,
  agent_id TEXT NOT NULL,
  agent_version_id TEXT NOT NULL,
  -- El mensaje entrante que venció el buffer y disparó la corrida.
  trigger_message_id TEXT NOT NULL,
  -- El mensaje saliente que produjo, cuando lo hubo.
  response_message_id TEXT,
  -- `running` se escribe antes de llamar al modelo, para que el índice único de
  -- abajo rechace una segunda corrida del mismo disparador mientras la primera
  -- sigue viva. Una corrida abandonada se queda en `running`: es evidencia
  -- honesta de que empezó y no cerró, y desaparecer sería peor.
  --
  -- `skipped` es la corrida que no llegó a invocar el modelo porque no había
  -- nada que responder —un mensaje sin texto, o un agente sin versión publicada—.
  status TEXT NOT NULL
    CHECK (status IN ('running', 'succeeded', 'failed', 'skipped')),
  -- Código estable y redactado del motivo. Nunca el cuerpo del proveedor.
  failure_code TEXT,
  correlation_id TEXT NOT NULL,
  started_at TEXT NOT NULL,
  finished_at TEXT,
  -- Una corrida terminada declara su desenlace; una viva no puede declararlo.
  CHECK ((status = 'running') = (finished_at IS NULL)),
  CHECK (status <> 'succeeded' OR response_message_id IS NOT NULL),
  CHECK (status NOT IN ('failed', 'skipped') OR failure_code IS NOT NULL),
  FOREIGN KEY (organization_id, conversation_id)
    REFERENCES conversations (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, agent_id)
    REFERENCES agents (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, agent_version_id)
    REFERENCES agent_versions (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, trigger_message_id)
    REFERENCES messages (organization_id, id) ON DELETE CASCADE,
  FOREIGN KEY (organization_id, response_message_id)
    REFERENCES messages (organization_id, id) ON DELETE CASCADE
);

-- Un mensaje entrante produce a lo sumo una corrida. Es la garantía dura de que
-- un reintento, un segundo vencimiento del buffer o dos invocaciones
-- concurrentes no producen dos respuestas al contacto: la bandera del runtime
-- durable reduce la ventana, pero solo el motor la cierra.
CREATE UNIQUE INDEX agent_runs_trigger_unique
  ON agent_runs (organization_id, trigger_message_id);

-- El historial de corridas de una conversación, de la más reciente a la más
-- antigua; el identificador desempata dos registradas en el mismo instante.
CREATE INDEX agent_runs_organization_conversation_idx
  ON agent_runs (organization_id, conversation_id, started_at DESC, id DESC);
