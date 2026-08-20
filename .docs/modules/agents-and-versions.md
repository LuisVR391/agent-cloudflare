# Agentes y sus versiones

> **Estado:** vigente para la configuración y la publicación del primer
> entregable de Fase 3
> ([#54](https://github.com/LuisVR391/agent-cloudflare/issues/54)). Su
> ejecución la describe el
> [runtime de conversación](./conversation-runtime.md), desde el corte
> [#55](https://github.com/LuisVR391/agent-cloudflare/issues/55). Este documento
> describe lo que existe hoy, no lo planificado.

Un agente es **configuración de la empresa**, no comportamiento escrito en el
código. Una versión es una **revisión inmutable** de esa configuración. Juntos
responden la pregunta que la Fase 3 entera necesita: *¿con qué configuración se
respondió esta conversación?*

Publicar una versión **no pone a responder a nadie**: deja lista la
configuración. Quién responde una conversación lo decide su modo de atención y
el agente que se le asigna, como describe el
[runtime de conversación](./conversation-runtime.md). Las decisiones que
gobiernan este módulo están en
[ADR-0014](../decisions/ADR-0014-configurable-agents-and-published-versions.md).

## Qué conserva cada tabla

| Tabla | Contenido |
| --- | --- |
| `agents` | Nombre único en la organización, propósito y estado (`active`, `archived`) |
| `agent_versions` | Ordinal, estado, instrucciones, modelo previsto, playbook y motivo del cambio |
| `agent_version_tools` | Claves de herramienta que la revisión declara |
| `agent_version_knowledge_scopes` | Etiquetas de alcance de conocimiento que la revisión declara |
| `agent_publication_transitions` | Qué versión quedó publicada, quién lo decidió, cuándo y por qué |

## Qué congela una publicación y qué no

Queda congelado lo que define el comportamiento: **instrucciones, modelo
previsto, herramientas declaradas, alcance de conocimiento y playbook**. Una vez
publicada, esa revisión no vuelve a editarse nunca; cambiar el comportamiento
exige una revisión nueva.

**No** se congelan el nombre, el propósito ni el estado del agente. No describen
comportamiento, así que corregir un nombre no obliga a publicar nada.

## El ciclo de vida, y por qué nunca vuelve a borrador

```text
draft ──publicar──► published ──se publica otra──► archived
                        ▲                              │
                        └──────────revertir────────────┘
```

Una versión **nunca regresa a `draft`**. Eso es lo que hace que `status` sea
suficiente para saber si el contenido está congelado, sin una segunda columna
que guarde el instante de la primera publicación: ese dato ya tiene dueño en el
historial.

De ahí se sigue una invariante que hay que sostener: **`archived` significa
siempre «fue publicada y ya no lo está»**. Por eso un borrador no se archiva. La
prueba `un borrador nunca queda archivado` la vigila.

## A lo sumo una publicada, garantizado por el motor

```sql
CREATE UNIQUE INDEX agent_versions_published_unique
  ON agent_versions (organization_id, agent_id)
  WHERE status = 'published';
```

La invariante vive en el índice y no en el repositorio, porque una segunda ruta
de escritura no puede saltarse un índice.

> **Orden obligatorio del lote.** SQLite valida la unicidad **sentencia a
> sentencia**, no al cerrar la transacción. El lote que publica **archiva
> primero** la versión vigente y **publica después** la destino. Invertir ese
> orden hace fallar el lote entero con `UNIQUE constraint failed`. Es el mismo
> cuidado que documenta `pipeline_stages` al intercambiar posiciones.

## Revertir es reactivar, no copiar

Revertir apunta la publicación a una revisión que ya existe. No se crea una
versión nueva ni se duplica contenido, de modo que el ordinal sigue
identificando una configuración única.

La etiqueta de la transición la **deriva el servidor** comparando ordinales:

| Versión vigente | Versión destino | Acción |
| --- | --- | --- |
| ninguna | alguna | `published` |
| alguna | ninguna | `unpublished` |
| alguna | ordinal mayor | `published` |
| alguna | ordinal menor | `rolled_back` |
| alguna | la misma | rechazo `409` |

Que la derive el servidor no es un detalle de comodidad: con tres endpoints
separados, quien llama podría registrar un descenso de versión como una
publicación.

## Dos motivos distintos

- **`agent_versions.change_reason`** explica por qué el contenido de esta
  revisión difiere del de la anterior. Es opcional.
- **`agent_publication_transitions.reason`** explica por qué cambió la
  publicación. Es **obligatorio**, porque el criterio de salida del corte exige
  que el historial conserve el porqué de cada cambio.

## Un solo punto de concurrencia

`agents.version` cubre el agente, sus versiones y sus declaraciones, igual que
`pipelines.version` cubre el pipeline y sus etapas. Toda mutación envía el
`expectedVersion` del **agente** y lo incrementa.

La consecuencia aceptada es que dos personas editando dos borradores distintos
del mismo agente entran en conflicto. En la práctica un agente tiene un borrador
a la vez, y a cambio las tablas hijas heredan una concurrencia que por sí solas
no tendrían.

No confundir `agents.version` —contador de escrituras— con
`agent_versions.version_number` —ordinal de la revisión—.

## Herramientas: declaración validada contra el catálogo

Una revisión declara qué herramientas usará, y desde el corte de herramientas
([#56](https://github.com/LuisVR391/agent-cloudflare/issues/56)) esa declaración
**se valida contra el catálogo cerrado del producto**: una clave que el producto
no implementa responde `400 AGENT_TOOL_UNKNOWN` y no escribe ninguna fila. El
panel ofrece el catálogo para marcarlo en lugar de escribirlo.

La declaración sigue **sin autorizar por sí sola**: es una de las cuatro
condiciones que la corrida comprueba antes de anunciar nada al modelo, junto con
la pertenencia al catálogo vigente, la audiencia y el acotamiento a la
organización y al contacto. Una versión ya publicada que declare una clave
desconocida no se rompe: en ejecución no se anuncia y queda registro. El detalle
está en el [módulo de herramientas y su autorización](./tools-and-permissions.md)
y en [ADR-0017](../decisions/ADR-0017-agent-tool-contract.md).

## Conocimiento: declaración sin catálogo

El alcance de conocimiento sigue siendo una etiqueta sin catálogo ni índice, y
nada lo consume. El backend valida su forma, la normaliza y la deduplica;
validar que exista y filtrarla por permisos corresponde al corte que introduzca
esa capacidad ([#57](https://github.com/LuisVR391/agent-cloudflare/issues/57)).

Ambas van en tablas hijas y no en una columna JSON: el esquema no tiene ninguna,
un arreglo JSON no impide un elemento repetido, y «qué versiones declaran esta
herramienta» —la consulta que necesita quien las autoriza— sería un recorrido de
tabla.

## El modelo previsto

`agent_versions.model` es un **identificador opaco**, sin `CHECK` ni catálogo. Lo
consume la capa común de
[proveedores de modelo](./model-providers.md), que es donde se decidió qué
contrato aísla el runtime del proveedor de inferencia
([ADR-0015](../decisions/ADR-0015-model-provider-and-agent-runs.md)). Un modelo
que el proveedor no reconoce no rompe la conversación: la corrida queda
registrada como proveedor no disponible. La columna **no guarda ninguna
credencial**: los secretos pertenecen a Cloudflare Secrets.

## Superficie HTTP

Todas las rutas exigen sesión y organización activa. Un agente de otra
organización responde `404` en todas las ramas, nunca `403`.

| Ruta | Método | Permiso | Qué hace |
| --- | --- | --- | --- |
| `/api/agents` | `GET` | `agents.read` | Lista; `?status=active\|archived\|all` |
| `/api/agents` | `POST` | `agents.manage` | Crea el agente |
| `/api/agents/:id` | `GET` | `agents.read` | Detalle con versiones e historial |
| `/api/agents/:id` | `PATCH` | `agents.manage` | Nombre, propósito y estado |
| `/api/agents/:id/versions` | `POST` | `agents.manage` | Borrador escrito o derivado con `fromVersionId` |
| `/api/agents/:id/versions/:versionId` | `PUT` | `agents.manage` | Reemplaza el contenido del borrador |
| `/api/agents/:id/publication` | `PUT` | `agents.manage` | Publica, revierte o desactiva |

El contenido del borrador se reemplaza con `PUT` y no se parchea con `PATCH`
porque las herramientas y el alcance son conjuntos: omitirlos en un cambio
parcial no diría si hay que conservarlos o vaciarlos.

`PUT /api/agents/:id/publication` recibe `{ versionId, reason, expectedVersion }`.
Un `versionId` nulo desactiva la publicación sin borrar ninguna versión.

Códigos propios del módulo:

| Código | Situación |
| --- | --- |
| `AGENT_NAME_TAKEN` | El nombre ya existe en la organización, incluso archivado |
| `AGENT_VERSION_CONFLICT` | El `expectedVersion` no es el vigente |
| `AGENT_VERSION_NOT_EDITABLE` | La revisión ya se publicó y su contenido está congelado |
| `AGENT_PUBLICATION_UNCHANGED` | La publicación pedida deja al agente como estaba |
| `AGENT_TOOL_UNKNOWN` | La revisión declara una herramienta que no existe en el catálogo |

`GET /api/agent-tools` sirve el catálogo de herramientas con `agents.read`. No
cuelga de un agente concreto porque es del producto y no de la organización,
pero se lee con el mismo permiso y se declara desde la misma pantalla; lo
describe el [módulo de herramientas y su autorización](./tools-and-permissions.md).

El prefijo `/api/agents` no colisiona con `/agents/`, que sirve el SDK para el
runtime durable: `src/worker/index.ts` resuelve `/api/` antes.

## Permisos

`agents.read` consulta; `agents.manage` crea, edita, publica, desactiva y
revierte. **El corte no introduce ningún permiso**: ambos existen en el catálogo
de instalación desde el commit que creó `0002`, y `seedOwner` es la única ruta de
instalación, así que ninguna organización instalada carece de ellos. Por eso
`0019` no lleva sección de catálogo, a diferencia de los cortes de Fase 2.

Los tiene `owner` y `manager`. **`operator` no**: atender una conversación no es
configurar quién la atiende.

Publicar no exige un permiso propio porque `agents.manage` ya es el privilegio
que decide qué comportamiento tiene la empresa.

## En el panel

`/app/agentes` es la superficie de configuración. La entrada del sidebar deja de
estar deshabilitada con este corte.

La lista muestra cada agente con su propósito y con **qué versión está
publicada**, o que no hay ninguna. Quien gestiona ve también los archivados,
para poder reactivarlos.

El detalle de un agente se abre en un panel lateral con dos pestañas:

- **Versiones**, de la más reciente a la más antigua, con su estado, su modelo
  previsto, su motivo y su autor. Un borrador se edita; una versión publicada
  alguna vez, no —el botón de editar sencillamente no está—. Cualquiera se
  duplica en un borrador nuevo.
- **Historial**, con quién cambió la publicación, por qué y cuándo.

El **motivo del cambio de publicación es un campo obligatorio**: mientras esté
vacío, publicar, revertir y desactivar están deshabilitados. Es la misma regla
que aplica el backend, adelantada para que nadie escriba un cambio que va a ser
rechazado.

El botón de publicar dice **«Revertir a esta»** cuando la versión es anterior a
la vigente. Es una ayuda de lectura, no un control: la acción que se registra la
deriva el servidor.

La pantalla dice explícitamente que **publicar deja la configuración lista, no la
pone a responder**: quien decide que un agente atienda una conversación es el
inbox, eligiéndolo en el hilo. Sin esa frase, una superficie que habla de agentes
y de publicación sugeriría que basta con publicar.

## Publicar sigue sin mover ninguna conversación

La prueba `publicar una versión no cambia ninguna conversación` lo verifica
comparando el modo de atención antes y después, y sigue siendo cierta después del
corte de ejecución: lo que cambia el comportamiento de una conversación es
asignarle un agente y ponerla en modo `automatic`, no publicar una versión.

Quien sí lee la versión publicada es la corrida, en el instante de responder. Una
publicación nueva cambia con qué configuración se responde el mensaje siguiente,
sin tocar las conversaciones.

El mapeo al `AgentExecutionContext` de los
[contratos transversales](../architecture/contracts.md) es directo:

```text
agentId      ← agents.id
agentVersion ← agent_versions.version_number
```

## Fuera de alcance

Recuperar conocimiento, enrutar entre agentes y recordar al contacto son cortes
posteriores de la fase. Ejecutar herramientas ya existe, pero fuera de este
módulo: aquí solo se declara cuáles usa una revisión, y quién autoriza cada
intento lo describe el
[módulo de herramientas y su autorización](./tools-and-permissions.md). Comparar
dos versiones con evidencia, evaluarlas antes de publicar y proponer cambios son
Fase 5.

Tampoco entra borrar un borrador: el ciclo del corte es crear, publicar,
desactivar y volver atrás, y un borrador equivocado se corrige editándolo.

El agente predeterminado de un canal (`channels.default_agent_id`) se decide en
el corte de routing. Qué agente atiende una conversación ya vive en
`conversations.agent_id` desde el corte de ejecución, que fue su primer
consumidor.
