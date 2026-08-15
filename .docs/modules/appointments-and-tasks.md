# Notas, tareas y citas

> **Estado:** vigente para las notas del contacto y las tareas con responsable
> ([#37](https://github.com/LuisVR391/agent-cloudflare/issues/37)) y para la
> superficie de citas del quinto entregable de Fase 2
> ([#38](https://github.com/LuisVR391/agent-cloudflare/issues/38)). La agenda
> del panel llega en el segundo corte de ese mismo issue; hasta entonces las
> citas se operan por API. Este documento describe lo que existe hoy, no lo
> planificado.

Una conversación registra lo que el contacto dijo. La nota registra lo que el
equipo entendió: la preferencia que mencionó de paso, el motivo por el que
canceló, el nombre con el que prefiere que la llamen. Es dato empresarial
durable y vive en D1, como el resto del registro canónico
([ADR-0002](../decisions/ADR-0002-d1-source-of-truth.md)).

## Qué conserva cada tabla

| Tabla | Contenido | Migración |
| --- | --- | --- |
| `contact_notes` | Cuerpo de la nota, su autor, el contacto al que pertenece y la conversación desde la que se escribió, cuando la hubo | `0015_contact_notes.sql` |
| `tasks` | Título, detalle, responsable, vencimiento, estado y el sujeto del que cuelga | `0016_tasks.sql` |
| `appointments` | Contacto, servicio, responsable, intervalo en UTC, estado y el origen del que nació | `0017_appointments_and_time_zone.sql` |
| `appointment_transitions` | Cada cambio de estado o de horario, con actor y `correlationId` | `0017_appointments_and_time_zone.sql` |

La misma migración añade `organizations.time_zone`.

## La nota pertenece al contacto, no a la conversación

Anclarla a la conversación la haría desaparecer del lugar donde hace falta.
Un hilo se resuelve, y lo que se supo de la persona sigue siendo cierto la
próxima vez que escriba, aunque sea desde otro canal o meses después. Por eso la
clave foránea obligatoria es la del contacto.

La conversación se conserva igualmente cuando existe, porque explica **cuándo**
se supo lo que la nota dice. Es opcional: una nota escrita desde el directorio
de contactos no tiene ninguna, y eso no la hace menos válida.

La conversación referida debe pertenecer al mismo contacto. No basta con que
esté en la organización: una nota anclada al hilo de otra persona contaría la
historia equivocada en las dos fichas, así que la comprobación viaja dentro de
la propia sentencia que inserta.

## El autor es una membresía

Quien escribe lo hace dentro de una organización, y la misma cuenta puede
pertenecer a varias
([ADR-0007](../decisions/ADR-0007-better-auth-and-organization-context.md)). Con
una membresía como autor, «lo escribió alguien activo en esta organización» se
comprueba en la misma consulta que inserta, sin ventana entre verificar y
escribir. Es lo mismo que hace `conversation_assignments` con el responsable de
una conversación.

El autor no viaja en el cuerpo de la petición: lo pone el Worker con la
membresía de la sesión. Un identificador enviado por el frontend no demostraría
quién escribe.

La clave foránea usa `RESTRICT`: una membresía con notas no se borra. Retirar a
alguien del equipo cambia el estado de su membresía y no borra su rastro; la
nota conserva quién la escribió aunque después deje de aparecer resuelto su
nombre.

## Superficie HTTP de notas

| Ruta | Método | Permiso | Respuesta |
| --- | --- | --- | --- |
| `/api/notes?contactId=…` | `GET` | `contacts.read` | `{ notes }` del contacto, de la más reciente a la más antigua |
| `/api/notes?conversationId=…` | `GET` | `contacts.read` | `{ notes }` escritas desde ese hilo |
| `/api/notes` | `POST` | `contacts.manage` | `201` con `{ note }` |

`limit` es opcional y su tope son 50 notas. Cuando llegan los dos filtros manda
el contacto: la ficha muestra todas sus notas, no solo las de un hilo.

Códigos de error: `400 INVALID_QUERY` sin filtro, `400 INVALID_NOTE` con cuerpo
vacío o de más de 4000 caracteres, `403 FORBIDDEN` sin permiso,
`404 NOT_FOUND` cuando el contacto o la conversación no viven en la organización
activa —las dos responden igual, para no revelar qué identificador existe en
otra— y `409 MEMBERSHIP_NOT_ACTIVE` si la membresía de quien escribe dejó de
estar activa.

## Permisos de notas

| Permiso | Roles |
| --- | --- |
| `contacts.read` | `owner`, `manager`, `operator` |
| `contacts.manage` | `owner`, `manager`, `operator` |

Las notas no estrenan permisos: viven en la ficha del contacto y usan los suyos.
Quien puede corregir el nombre de una persona puede anotar sobre ella, y quien
no puede consultarla tampoco ve lo que se anotó. Por eso `0015` no toca el
catálogo de permisos ni necesita migración de propagación.

## Auditoría de notas

Cada creación y cada rechazo por falta de permiso quedan en `audit_logs` con
`resource_type = 'contact_note'`, la acción `contact_note.create`, el resultado
y el `correlationId` de la petición.

El cuerpo nunca entra en la auditoría ni en los logs: una nota es dato personal
por contexto, así que lo que se conserva son identificadores, no lo escrito.

## Panel de notas

En **Contactos**, las notas acompañan a la ficha, debajo de las etiquetas e
identidades. Se escriben mirando a la persona, sin conversación de origen.

En **Conversaciones**, el botón «Notas» abre un panel lateral junto a «Ficha» y
«Oportunidad». Lo que se escribe ahí conserva el hilo como origen. El panel no
consulta nada hasta abrirse: mirar una conversación no debería costar una
consulta por cada cosa que podría consultarse.

Tras guardar se relee la lista completa en vez de insertar la nota devuelta,
porque el orden y el autor los decide el servidor.

## La tarea tiene dueño; la nota, autor

Una nota conserva lo que se entendió y no espera nada de nadie. Una tarea
conserva lo que quedó pendiente, y sin alguien a quien corresponda no se opera:
se acumula. Por eso el responsable es obligatorio, y cuando nadie lo indica la
tarea queda a nombre de quien la creó, no en el aire.

El responsable también es una membresía, con la misma comprobación de actividad
que el autor de una nota, dentro de la sentencia que escribe. Reasignar a
alguien sin membresía activa responde `409` y no cambia nada.

El vencimiento es opcional y viaja en ISO 8601 UTC. Es un dato que la lista
ordena y muestra: una tarea con plazo pasado se marca como vencida, pero nada
se dispara solo. Recordatorios y notificaciones pertenecen a Fase 4. El panel de
tareas sigue convirtiendo la hora local del navegador a ese instante; la zona
horaria de la organización la usa la agenda, que es donde un día mal
interpretado cambia lo que se ve.

## Un solo sujeto, o ninguno

Una tarea puede nacer suelta —«llamar al proveedor»—, colgar de un contacto, de
la conversación que la originó o de la oportunidad que hay que empujar. A lo
sumo uno: dos vínculos la harían ambigua, porque no se sabría en qué ficha
aparece ni qué la explica.

La regla vive en el motor, no solo en la aplicación:

```sql
CHECK ((contact_id IS NOT NULL) + (conversation_id IS NOT NULL)
       + (opportunity_id IS NOT NULL) <= 1)
```

Y el contrato HTTP la refuerza: el sujeto viaja como `{ type, id }`, una sola
forma, en vez de tres campos opcionales que podrían llegar juntos.

Las tres claves foráneas son compuestas por organización y caen con lo que las
explica: sin el contacto, la conversación o la oportunidad, la tarea perdió su
razón de ser. Las de membresía usan `RESTRICT`, para que retirar a alguien del
equipo no borre a quién le tocaba.

## Cerrar y reabrir

`status` admite `open`, `done` y `cancelled`. Cerrar sella `completed_at`;
reabrir lo borra, porque una tarea abierta no tiene fecha de cierre.

Toda modificación exige la versión vigente, como mover una oportunidad. Si otra
persona cambió la tarea antes, la respuesta es `409 TASK_VERSION_CONFLICT` y el
panel muestra ese mensaje en vez de pisar el cambio ajeno.

## Superficie HTTP de tareas

| Ruta | Método | Permiso | Respuesta |
| --- | --- | --- | --- |
| `/api/tasks?assignee=me\|all\|<membershipId>&status=&dueBefore=&limit=` | `GET` | `tasks.read` | `{ tasks, limit, truncated }` |
| `/api/tasks?subjectType=&subjectId=` | `GET` | `tasks.read` | `{ tasks }` del sujeto |
| `/api/tasks` | `POST` | `tasks.manage` | `201` con `{ task }` |
| `/api/tasks/:id` | `GET` | `tasks.read` | `{ task }` |
| `/api/tasks/:id` | `PATCH` | `tasks.manage` | `{ task }` |

`assignee=me` lo resuelve el backend con la membresía de la sesión: el cliente
no envía su identificador ni podría demostrarlo. El orden pone las pendientes
primero, luego el vencimiento más próximo, y deja al final las que no tienen
fecha: no son más urgentes por carecer de plazo.

Códigos de error: `400 INVALID_TASK` e `INVALID_TASK_UPDATE` con entrada
inválida, `400 INVALID_QUERY` con estado o fecha mal formados, `403 FORBIDDEN`
sin permiso, `404 NOT_FOUND` para tarea o sujeto que no viven en la organización
activa, `409 TASK_VERSION_CONFLICT` por versión obsoleta y
`409 MEMBERSHIP_NOT_ACTIVE` si quien recibiría la tarea ya no está activo.

## Permisos de tareas

| Permiso | Roles |
| --- | --- |
| `tasks.read` | `owner`, `manager`, `operator` |
| `tasks.manage` | `owner`, `manager`, `operator` |

Los tres roles gestionan tareas: quien atiende la conversación es quien descubre
el pendiente, y una tarea que solo puede crear su jefe llega tarde.

Los permisos entran por dos caminos que deben coincidir. `0016_tasks.sql` los
inserta y los concede por `role_key` a toda organización ya instalada;
`permissionDefinitions` y `permissionsByRole` cubren las instalaciones nuevas.
Una prueba verifica que ambos catálogos terminan iguales, como exige el
requisito transversal de
[#33](https://github.com/LuisVR391/agent-cloudflare/issues/33).

## Auditoría de tareas

Crear y modificar quedan en `audit_logs` con `resource_type = 'task'`, las
acciones `task.create` y `task.update`, el resultado y el `correlationId`. Los
rechazos por falta de `tasks.manage` se registran antes de responder `403`. El
título y el detalle no entran en la auditoría.

## Panel de tareas

**Tareas** es una sección propia del panel, en `/app/tareas`. Abre en lo
pendiente de quien mira, que es la pregunta que alguien se hace al entrar: qué me
toca. Desde ahí se cambia a todo el equipo o a un responsable concreto, y se
alterna entre pendientes, cerradas y todas.

En **Conversaciones**, el botón «Tareas» abre un panel lateral con lo que cuelga
de ese hilo y crea tareas ancladas a él. Como el resto de paneles, no consulta
hasta abrirse.

## La empresa declara en qué zona vive

`organizations.time_zone` guarda un identificador IANA y las organizaciones que
existían antes de `0017` reciben `America/Mexico_City`, el valor por defecto
explícito que pide
[ADR-0010](../decisions/ADR-0010-crm-commercial-model.md).

Los instantes se siguen guardando en ISO 8601 UTC, sin excepción. La zona solo
decide dónde empieza y dónde termina el día que alguien mira: sin ella, la
agenda de un salón en Ciudad de México cortaría a las 18:00 locales, que es
cuando cambia el día en UTC.

El cálculo vive en el Worker y no en el cliente, porque el rango termina en una
cláusula `WHERE`: si lo resolviera el navegador, dos personas verían agendas
distintas de la misma empresa. `PATCH /api/organization` la cambia con
`organization.manage` y valida el identificador contra `Intl` antes de
persistirlo; una zona inventada responde `400 INVALID_TIME_ZONE`. La zona viaja
después en `/api/context`, para que ninguna pantalla tenga que pedirla aparte.

Cambiarla no reescribe nada: las citas conservan su instante y solo cambia el
día al que se agrupan.

## La cita reserva tiempo para alguien

Contacto y servicio son obligatorios: sin contacto no hay a quién atender y sin
servicio no se sabe cuánto dura ni qué se reservó. El responsable es opcional,
porque una cita puede acordarse antes de decidir quién la atiende, y anotar un
nombre falso sería peor que dejarlo pendiente.

Cuando el fin no se envía, se deriva de `duration_minutes` del servicio dentro
de la misma sentencia que inserta, y se persiste: editar el catálogo después no
debe mover una cita ya acordada. El servicio debe estar activo.

El origen —la conversación y la oportunidad que la generaron— es opcional y **no
es excluyente**, a diferencia del sujeto de una tarea: la misma cita puede nacer
en una conversación y pertenecer a la oportunidad que esa conversación abrió.

## Ciclo de estados

| Estado | Puede pasar a |
| --- | --- |
| `requested` | `pending`, `confirmed`, `cancelled` |
| `pending` | `confirmed`, `rescheduled`, `cancelled`, `no_show` |
| `confirmed` | `rescheduled`, `cancelled`, `completed`, `no_show` |
| `rescheduled` | `confirmed`, `rescheduled`, `cancelled`, `completed`, `no_show` |
| `cancelled`, `completed`, `no_show` | nada: son terminales |

La matriz vive en `src/worker/domain/appointment-status.ts` y se valida en
backend. Lo que el panel ofrezca como acción es una ayuda, no un control: una
transición no declarada responde `409 APPOINTMENT_TRANSITION_NOT_ALLOWED`
aunque llegue por API.

Corregir un desenlace equivocado es agendar de nuevo, no reescribir el pasado:
por eso los tres estados finales no vuelven atrás.

`rescheduled` es un estado y no solo un hecho del historial. Una cita movida y
todavía sin reconfirmar no está en la misma situación que una confirmada, y la
agenda necesita distinguirlas de un vistazo.

## Reprogramar

Cambiar el horario deja la cita en `rescheduled` sin que haga falta pedirlo. La
excepción es `requested`: ahí todavía no había nada acordado que mover, así que
conserva su estado.

Mover el inicio sin decir hasta cuándo conserva la duración vigente. Recortarla
por accidente sería peor que respetarla.

Toda modificación exige la versión vigente, como una tarea o una oportunidad. Si
otra persona reprogramó antes, la respuesta es `409
APPOINTMENT_VERSION_CONFLICT` y quien pide el cambio debe releer.

## Superficie HTTP de citas

| Ruta | Método | Permiso | Respuesta |
| --- | --- | --- | --- |
| `/api/appointments?date=&range=day\|week&assignee=me\|all\|<membershipId>&status=&limit=` | `GET` | `appointments.read` | `{ appointments, timeZone, date, range, window, limit, truncated }` |
| `/api/appointments?subjectType=&subjectId=` | `GET` | `appointments.read` | `{ appointments, timeZone }` del contacto, la conversación o la oportunidad |
| `/api/appointments` | `POST` | `appointments.manage` | `201` con `{ appointment }` y su historial |
| `/api/appointments/:id` | `GET` | `appointments.read` | `{ appointment, timeZone }`, con `transitions` |
| `/api/appointments/:id` | `PATCH` | `appointments.manage` | `{ appointment }` |
| `/api/organization` | `GET` | sesión con organización activa | `{ organization }` |
| `/api/organization` | `PATCH` | `organization.manage` | `{ organization }` |

Sin `date`, la agenda abre en el día que la empresa está viviendo, no en el del
servidor. `window` devuelve el rango UTC que se consultó, para que quien lo lea
pueda comprobar cómo se interpretó la fecha. El rango es semiabierto: una cita a
medianoche pertenece a un solo día.

`assignee=me` lo resuelve el backend con la membresía de la sesión, igual que en
tareas: el cliente no envía su identificador ni podría demostrarlo.

Códigos de error: `400 INVALID_APPOINTMENT` e `INVALID_APPOINTMENT_UPDATE` con
entrada inválida —incluido un fin anterior al inicio—, `400 INVALID_QUERY` con
fecha, rango o estado mal formados, `400 INVALID_TIME_ZONE`, `403 FORBIDDEN` sin
permiso, `404 NOT_FOUND` para la cita o cualquier referencia que no viva en la
organización activa —todas responden igual, para no revelar qué identificador
existe en otra—, `409 APPOINTMENT_VERSION_CONFLICT`,
`409 APPOINTMENT_TRANSITION_NOT_ALLOWED` y `409 MEMBERSHIP_NOT_ACTIVE`.

## Permisos de citas

| Permiso | Roles |
| --- | --- |
| `appointments.read` | `owner`, `manager`, `operator` |
| `appointments.manage` | `owner`, `manager`, `operator` |

Los tres roles gestionan citas: quien atiende la conversación es quien acuerda
el horario, y una cita que solo puede agendar su jefe se pierde mientras tanto.
Configurar la organización sigue siendo distinto y `organization.manage`
permanece en `owner`.

Como en los cortes anteriores, los permisos entran por dos caminos que deben
coincidir: `0017_appointments_and_time_zone.sql` los concede por `role_key` a
toda organización ya instalada y `permissionDefinitions`/`permissionsByRole`
cubren las instalaciones nuevas, con una prueba que verifica que ambos catálogos
terminan iguales.

## Auditoría de citas

Crear y modificar quedan en `audit_logs` con `resource_type = 'appointment'`,
las acciones `appointment.create` y `appointment.update`, el resultado y el
`correlationId`. Los rechazos por falta de `appointments.manage` se registran
antes de responder `403`. Cambiar la zona horaria queda con
`resource_type = 'organization'` y la acción `organization.update`.

El historial de la cita es distinto de la auditoría: `appointment_transitions`
explica cómo llegó la reserva a su desenlace —de qué estado a cuál y de qué
horario a cuál—, mientras que `audit_logs` registra quién ejecutó una operación
autorizada.

## Límites conocidos

- Una nota no se edita ni se borra. El corte entrega lo que el criterio de
  salida exige —registrar y consultar—; corregir una nota es una decisión sobre
  qué hacer con la versión anterior, y esa decisión todavía no está tomada.
- Sin hilo de comentarios, adjuntos ni menciones: quedan fuera del alcance de
  #37.
- Sin recordatorios, vencimientos automáticos ni notificaciones: pertenecen a
  Fase 4. Una tarea vencida se ve vencida, pero no avisa a nadie.
- Sin tareas recurrentes, fuera del alcance de #37.
- Una tarea no se borra. `cancelled` existe en el esquema para cerrarla sin
  fingir que se hizo, pero el panel todavía solo alterna entre pendiente y
  hecha.
- La lista tiene tope de 100 tareas y lo anuncia con `truncated` en vez de
  recortar en silencio; no hay paginación por cursor. La agenda usa el mismo
  tope y lo anuncia igual.
- La agenda del panel todavía no existe: las citas se operan por API hasta el
  segundo corte de #38.
- Nada impide dos citas a la misma hora con el mismo responsable. La
  disponibilidad, la propuesta de horarios y la prevención de traslapes quedan
  fuera de #38: son reglas de negocio con horarios de atención detrás, y esa
  configuración no existe todavía.
- Sin recordatorios ni confirmaciones automáticas: una cita `pending` no avisa a
  nadie. Pertenecen a Fase 4.
- Sin calendarios externos ni sincronización.
- Una cita no se borra ni tiene notas propias: se cancela, y lo que haya que
  contar sobre ella se anota en el contacto o queda como tarea.
- Confirmar una cita no mueve la etapa comercial ni resuelve la conversación:
  los tres estados permanecen separados por
  [ADR-0010](../decisions/ADR-0010-crm-commercial-model.md).
