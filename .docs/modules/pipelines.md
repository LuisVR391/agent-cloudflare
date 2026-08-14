# Servicios, pipeline y oportunidades

> **Estado:** vigente para el tercer entregable de Fase 2 completo
> ([Issue #36](https://github.com/LuisVR391/agent-cloudflare/issues/36)):
> servicios, pipeline con sus etapas y oportunidades que las recorren.

[ADR-0010](../decisions/ADR-0010-crm-commercial-model.md) decide lo que este
módulo implementa: el catálogo de servicios es dato relacional con dueño en D1
—un servicio se agenda, se cobra y se cuenta—, el pipeline es configuración de
cada organización, y la **oportunidad** es lo que avanza por él. Este documento
describe lo que existe hoy.

## Qué conserva cada tabla

| Tabla | Contenido |
| --- | --- |
| `services` | Nombre, nombre normalizado, duración, precio opcional con su moneda, estado y versión |
| `pipelines` | Nombre, clave de plantilla y versión de la configuración |
| `pipeline_stages` | Nombre, posición y color de cada etapa dentro de su pipeline |
| `opportunities` | Contacto, conversación de origen, pipeline, etapa, servicio y versión |
| `opportunity_stage_transitions` | Quién movió la oportunidad, entre qué etapas, cuándo y con qué `correlationId` |

Las claves foráneas de las etapas incluyen `organization_id` en ambos lados: dos
claves independientes serían válidas por separado mientras la combinación cruza
el límite de aislamiento, que es lo que
[ADR-0006](../decisions/ADR-0006-d1-schema-conventions.md) prohíbe.

El nombre normalizado se pliega a minúsculas y se recorta, igual que en
`contact_tags`: la unicidad dentro de la organización no debe depender de
mayúsculas, y SQLite solo aplica `NOCASE` a ASCII. «Corte» y «  CORTE  » son el
mismo servicio.

## Precio, moneda y duración

El precio es opcional, porque no todo servicio se publica con tarifa. Cuando
existe, viaja con su moneda: un importe sin moneda no significa nada. Un `CHECK`
impide que aparezca uno de los dos valores sin el otro.

La moneda se declara **por servicio**, no por organización. `organizations`
todavía no tiene configuración regional —ADR-0010 solo compromete la zona
horaria, y llega con las citas de
[#38](https://github.com/LuisVR391/agent-cloudflare/issues/38)—, así que
inventarla aquí anticiparía una decisión que no está tomada.

El importe se guarda como entero en la unidad menor de la moneda. Un flotante
acumularía error de representación sobre un dato que se cobra. La interfaz
convierte al presentar y redondea al capturar.

La duración se expresa en minutos, con un máximo de un día: es el tiempo que la
agenda reservará para la cita.

## Un servicio se archiva, no se borra

`status` distingue `active` de `archived`. Las oportunidades y las citas que
referencien un servicio deben seguir explicando qué se vendió, así que la API no
expone borrado. El nombre sigue reservado dentro de la organización aunque el
servicio esté archivado, para que reactivarlo no compita con un duplicado
creado mientras tanto.

## El pipeline es configuración de la organización

Las etapas viven en datos propios de cada organización, con orden explícito. El
pipeline inicial de salón de belleza de la guía §16.3 —doce etapas, de «Nuevo
contacto» a «Oportunidad perdida»— se siembra al instalar y desde ahí es
editable: cambiar de giro se resuelve reconfigurando, no bifurcando el producto.

La siembra tiene **dos caminos que deben coincidir**. Una organización nueva la
recibe de `initialPipelineTemplate`, la plantilla canónica en TypeScript que
`/api/setup` aplica dentro de su propia compensación; una organización ya
instalada la recibe de la migración `0013`, que reproduce el mismo contenido en
SQL. `test/pipelines.test.ts` compara ambos resultados, porque una divergencia
dejaría organizaciones con pipelines distintos según cuándo se crearon.

Es idempotente por construcción: el índice único parcial
`(organization_id, template_key)` impide un segundo pipeline sembrado, y cada
etapa comprueba su propio nombre antes de insertarse. Un pipeline al que alguien
borró etapas **no las recupera**: reconstruirlas revertiría una edición
deliberada.

Dos detalles del esquema que conviene conocer antes de tocarlo:

- `position` no tiene índice único. Reordenar reasigna todas las posiciones en
  un lote, y SQLite valida la unicidad sentencia a sentencia, así que un índice
  único haría fallar el intercambio de dos etapas contiguas.
- Las doce etapas de la migración van en sentencias separadas, no en un
  `UNION ALL`: SQLite limita los términos de un compound select y doce ya lo
  exceden en el runtime de Workers.

## Una sola versión para toda la configuración

`pipelines.version` cubre el pipeline y sus etapas. Crear, renombrar,
recolorear, reordenar o borrar una etapa exige la versión vigente y la
incrementa. Un solo punto de versión evita que dos reordenamientos simultáneos
se intercalen y dejen posiciones incoherentes sin que nada lo detecte.

El reorden debe enumerar **exactamente** las etapas vigentes: una lista parcial
dejaría posiciones huérfanas y una con etapas ajenas cruzaría el aislamiento.
La última etapa no se borra, porque un pipeline sin etapas no puede recibir
oportunidades y la siembra no lo repuebla.

## La oportunidad es lo que avanza

Una **conversación no cambia de etapa**. Puede producir una oportunidad, ninguna
o varias a lo largo del tiempo, y sigue siendo el hilo de atención. La
oportunidad pertenece a un contacto y conserva la conversación que la originó
cuando nació desde una.

Los tres estados del modelo de dominio permanecen separados: resolver una
conversación no cierra su oportunidad, y confirmar una cita no moverá su etapa.
Ninguna transición arrastra a otra; las reglas que las relacionen serán
automatizaciones explícitas de Fase 4.

Cada movimiento queda en `opportunity_stage_transitions` con actor, etapa
previa, etapa siguiente, momento y `correlationId`. La creación registra su
propia fila con `previous_stage_id` nulo, así el historial explica también de
dónde partió. Cambiar solo el servicio **no** registra transición: el historial
cuenta el recorrido comercial, no cada edición.

La validación de la etapa destino ocurre dentro del mismo `UPDATE` que escribe:

```sql
AND EXISTS (SELECT 1 FROM pipeline_stages stage
             WHERE stage.organization_id = opportunities.organization_id
               AND stage.id = ?
               AND stage.pipeline_id = opportunities.pipeline_id)
```

Una clave foránea compuesta demuestra que la etapa es de la organización, pero
no que pertenezca **al pipeline de esta oportunidad**. Sin esa condición, una
etapa de otro pipeline propio sería aceptada por el motor.

## Superficie HTTP

Todas las rutas exigen sesión, resuelven la organización activa desde el
contexto autenticado y fallan cerradas sin ella. Un recurso de otra
organización responde `404`, nunca `403`: la respuesta no revela que existe.

| Ruta | Método | Permiso |
| --- | --- | --- |
| `/api/services` | `GET` | `services.read` |
| `/api/services` | `POST` | `services.manage` |
| `/api/services/:id` | `GET` | `services.read` |
| `/api/services/:id` | `PATCH` | `services.manage` |
| `/api/pipelines` | `GET` | `pipelines.read` |
| `/api/pipelines/:id` | `GET` | `pipelines.read` |
| `/api/pipelines/:id` | `PATCH` | `pipelines.manage` |
| `/api/pipelines/:id/stages` | `POST` | `pipelines.manage` |
| `/api/pipelines/:id/stages/order` | `PATCH` | `pipelines.manage` |
| `/api/pipelines/:id/stages/:stageId` | `PATCH` y `DELETE` | `pipelines.manage` |
| `/api/opportunities` | `GET` | `opportunities.read` |
| `/api/opportunities` | `POST` | `opportunities.manage` |
| `/api/opportunities/:id` | `GET` | `opportunities.read` |
| `/api/opportunities/:id` | `PATCH` | `opportunities.manage` |

Toda mutación del pipeline viaja con `expectedVersion`; si no es la vigente, la
respuesta es `409 PIPELINE_VERSION_CONFLICT`. Un orden que no enumera las etapas
del pipeline responde `400 INVALID_STAGE_ORDER`, y borrar la única etapa
responde `409 LAST_PIPELINE_STAGE`.

El listado de oportunidades acepta `pipelineId` —para el tablero— o `contactId`
—para la ficha y el hilo—, y devuelve `truncated` cuando alcanza el límite
pedido: el tablero anuncia el recorte en vez de aparentar que muestra todo.
Mover exige `expectedVersion` y responde `409 OPPORTUNITY_VERSION_CONFLICT` si
otra persona movió la misma oportunidad antes. Un contacto, servicio o etapa que
no vive en la organización responde `404` sin distinguir cuál de los tres era:
distinguirlos revelaría qué identificador ajeno existe.

El listado acepta `status` con `active` —el valor por defecto—, `archived` o
`all`. Cualquier otro valor responde `400`.

La edición usa concurrencia optimista: `expectedVersion` debe coincidir con la
versión vigente o la respuesta es `409 SERVICE_VERSION_CONFLICT`. Un campo
ausente conserva su valor. El precio es la excepción a esa regla: `price: null`
borra importe y moneda a la vez, porque uno sin el otro no es representable.

Un nombre ya usado responde `409 SERVICE_NAME_TAKEN`, tanto al crear como al
renombrar. La comprobación forma parte de la misma sentencia que escribe, así
que no existe ventana entre verificar e insertar.

## Permisos

| Permiso | Roles |
| --- | --- |
| `services.read` | `owner`, `manager`, `operator` |
| `services.manage` | `owner`, `manager` |
| `pipelines.read` | `owner`, `manager`, `operator` |
| `pipelines.manage` | `owner`, `manager` |
| `opportunities.read` | `owner`, `manager`, `operator` |
| `opportunities.manage` | `owner`, `manager`, `operator` |

Los tres roles leen el catálogo y el pipeline, porque quien atiende una
conversación necesita saber qué ofrece la empresa y en qué etapa está lo que
gestiona. Reconfigurarlos es decisión de negocio y queda fuera de `operator`.

Las oportunidades son la excepción: los tres roles también las **crean y
mueven**, porque quien atiende la conversación es quien descubre que hay una
venta posible. Configurar el pipeline y avanzar por él son cosas distintas.

El catálogo de permisos se siembra durante la instalación
(`AuthorizationRepository.seedOwner`), de modo que una organización ya instalada
no recibiría los permisos de estos cortes. Las migraciones `0012` y `0013` los
conceden a los roles existentes por `role_key` y son idempotentes;
`test/services.test.ts` y `test/pipelines.test.ts` comprueban que una
instalación nueva y una migrada producen el mismo resultado.

## Auditoría

Crear o editar un servicio, reconfigurar el pipeline o sus etapas, y crear o
mover una oportunidad quedan en `audit_logs` con actor, recurso, resultado y
`correlationId`. Un intento sin el permiso de gestión se audita como `rejected`
antes de responder `403`. La auditoría guarda identificadores, nunca el precio
del servicio ni el contenido comercial.

El historial de etapa es distinto de la auditoría y ambos se conservan:
`audit_logs` responde «quién hizo qué» para seguridad, y
`opportunity_stage_transitions` responde «cómo avanzó esta venta» para el
negocio.

## Panel

`/app/servicios` lista el catálogo, permite darlo de alta, editarlo y
archivarlo. `/app/pipeline` muestra una columna por etapa, con una tarjeta por
oportunidad y su servicio; mover usa un menú en vez de arrastre, para que la
acción sea alcanzable con teclado y verificable en pruebas. Desde el hilo de
conversación, el botón **Oportunidad** abre las del contacto y permite crear una
nueva, que conserva la conversación de origen.

Quien solo tiene permiso de lectura ve las pantallas sin acciones de gestión; el
backend vuelve a comprobar el permiso en cada petición, así que ocultarlas es
cortesía, no control.

## Límites conocidos

- El tablero carga hasta cien oportunidades por pipeline y lo **anuncia** cuando
  llega al límite. La paginación por columna llega con las métricas
  ([#39](https://github.com/LuisVR391/agent-cloudflare/issues/39)).
- Renombrar, recolorear, reordenar y borrar etapas existe en `/api/pipelines` y
  todavía no tiene interfaz: el pipeline sembrado sirve como está para el MVP.
- La zona horaria de la organización que decide ADR-0010 llega con las citas
  ([#38](https://github.com/LuisVR391/agent-cloudflare/issues/38)), su primer
  consumidor real.
- Campos obligatorios por etapa, acciones de entrada y salida, tiempos máximos y
  automatizaciones pertenecen a Fase 4, y los playbooks de agente por etapa a
  Fase 3.

Hasta que existan, `services` es un catálogo consultable que ninguna otra
entidad referencia todavía.
