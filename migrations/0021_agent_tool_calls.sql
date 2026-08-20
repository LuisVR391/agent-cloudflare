-- Migración 0021: la traza de cada herramienta que una corrida intentó ejecutar
-- (ADR-0017), sobre la regla 7 de ADR-0015: la traza es evidencia y no una copia
-- del contenido.
--
-- Hasta aquí una corrida era un solo hecho: qué agente respondió, con qué
-- versión y cómo terminó. Cuando el modelo puede pedir datos del CRM, entre el
-- mensaje y la respuesta ocurren intentos que se ejecutan, se rechazan o
-- fallan, y cada uno es una decisión de autorización que hay que poder revisar
-- por separado. Una fila por corrida no puede responder cuál de esos intentos
-- se rechazó ni en qué orden ocurrieron.
--
-- La tabla no guarda los argumentos ni el resultado de la herramienta. Es la
-- misma regla que dejó a `agent_runs` sin el prompt ni el texto del mensaje
-- (ADR-0015, regla 7): los argumentos que propone el modelo pueden arrastrar lo
-- que la clienta escribió, y el resultado ya tiene dueño en `services` y en
-- `appointments`. Copiar ambos crearía un segundo almacén de datos personales
-- cuya única razón de ser sería el diagnóstico, y una traza es evidencia de lo
-- que ocurrió, no una copia del contenido.
--
-- Vive en tabla propia además de `audit_logs` porque responden preguntas
-- distintas: la auditoría conserva quién intentó qué y con qué resultado, y esta
-- conserva qué ocurrió dentro de una corrida y en qué orden, que la forma de
-- `audit_logs` no admite sin desnaturalizar `resource_id`. Es el mismo reparto
-- que ya existe entre `agent_runs` y `audit_logs`.
--
-- Este corte no introduce ningún permiso. Declarar qué herramientas usa un
-- agente ya exige `agents.manage` y consultarlas exige `agents.read`; ambos
-- están en `permissionDefinitions` desde el commit que creó `0002`, y
-- `AuthorizationRepository.seedOwner` es la única ruta de instalación, de modo
-- que ninguna organización instalada carece de ellos. Por eso, como en `0019` y
-- `0020`, no hay sección de catálogo que propagar.

-- Lo que SQLite exige para referenciar una corrida por organización e
-- identificador: una clave foránea compuesta necesita un índice único sobre
-- exactamente esas columnas del padre. `0020` no lo creó porque ninguna tabla
-- apuntaba todavía a `agent_runs`, y no se corrige allí: una migración que pudo
-- aplicarse no se edita. Añadirlo aquí es aditivo, aplica igual desde una base
-- vacía y no cambia ninguna fila existente, porque `id` ya es clave primaria y
-- la pareja no puede repetirse. Es el mismo índice que `0019` creó sobre
-- `agent_versions`.
CREATE UNIQUE INDEX agent_runs_organization_id_unique
  ON agent_runs (organization_id, id);

CREATE TABLE agent_tool_calls (
  id TEXT PRIMARY KEY,
  organization_id TEXT NOT NULL REFERENCES organizations (id) ON DELETE CASCADE,
  run_id TEXT NOT NULL,
  -- El ordinal del intento dentro de su corrida. Es lo que permite leer qué
  -- pasó y en qué orden sin depender del instante, que dos intentos de la misma
  -- ronda pueden compartir.
  sequence INTEGER NOT NULL,
  -- La clave del catálogo cerrado que vive en código, no en D1: el handler es
  -- código, y una fila que nombrara uno inexistente sería un segundo dueño del
  -- mismo hecho. Sin clave foránea, por lo tanto, y a propósito: una clave que
  -- deje de existir en el catálogo se conserva aquí como evidencia de lo que
  -- ocurrió, igual que `agent_version_tools` conserva lo que una versión
  -- publicada declaró.
  tool_key TEXT NOT NULL,
  -- `rejected` es la decisión de autorización que impidió ejecutar —no estaba
  -- anunciada, los argumentos no validan—; `failed` es la ejecución autorizada
  -- que no terminó. Distinguirlos importa: lo primero es contención funcionando
  -- y lo segundo es una avería.
  result TEXT NOT NULL CHECK (result IN ('succeeded', 'rejected', 'failed')),
  -- Código estable y redactado del motivo. Nunca el detalle interno, el
  -- identificador del recurso ni el cuerpo del proveedor.
  failure_code TEXT,
  -- Heredado del mensaje disparador, como en `agent_runs`: es el eslabón que
  -- une el webhook, la corrida, el intento y la respuesta.
  correlation_id TEXT NOT NULL,
  occurred_at TEXT NOT NULL,
  -- Un intento que no salió bien declara por qué.
  CHECK (result = 'succeeded' OR failure_code IS NOT NULL),
  FOREIGN KEY (organization_id, run_id)
    REFERENCES agent_runs (organization_id, id) ON DELETE CASCADE
);

-- Ninguna herramienta de este corte produce un efecto, así que no hay clave de
-- idempotencia que inventar: la garantía dura es esta. Un reintento de la misma
-- corrida no puede escribir dos veces el mismo ordinal, y la traza no se
-- duplica aunque la corrida se reintente. Cuando llegue la primera herramienta
-- de escritura, su clave derivará de esta misma pareja.
CREATE UNIQUE INDEX agent_tool_calls_run_sequence_unique
  ON agent_tool_calls (organization_id, run_id, sequence);

-- «Qué se ha hecho con esta herramienta, de lo más reciente a lo más antiguo»:
-- la consulta de quien audita el comportamiento de una herramienta antes de
-- ampliar el catálogo o de retirarla.
CREATE INDEX agent_tool_calls_organization_tool_idx
  ON agent_tool_calls (organization_id, tool_key, occurred_at DESC);
