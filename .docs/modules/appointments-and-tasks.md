# Notas, tareas y citas

> **Estado:** vigente para las notas del contacto, el primer corte del cuarto
> entregable de Fase 2
> ([#37](https://github.com/LuisVR391/agent-cloudflare/issues/37)). Las tareas
> con responsable y vencimiento llegan en el segundo corte del mismo issue, y
> las citas en [#38](https://github.com/LuisVR391/agent-cloudflare/issues/38).
> Este documento describe lo que existe hoy, no lo planificado.

Una conversación registra lo que el contacto dijo. La nota registra lo que el
equipo entendió: la preferencia que mencionó de paso, el motivo por el que
canceló, el nombre con el que prefiere que la llamen. Es dato empresarial
durable y vive en D1, como el resto del registro canónico
([ADR-0002](../decisions/ADR-0002-d1-source-of-truth.md)).

## Qué conserva cada tabla

| Tabla | Contenido |
| --- | --- |
| `contact_notes` | Cuerpo de la nota, su autor, el contacto al que pertenece y la conversación desde la que se escribió, cuando la hubo |

La migración es `0015_contact_notes.sql`.

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

## Superficie HTTP

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

## Permisos

| Permiso | Roles |
| --- | --- |
| `contacts.read` | `owner`, `manager`, `operator` |
| `contacts.manage` | `owner`, `manager`, `operator` |

Las notas no estrenan permisos: viven en la ficha del contacto y usan los suyos.
Quien puede corregir el nombre de una persona puede anotar sobre ella, y quien
no puede consultarla tampoco ve lo que se anotó. Por eso `0015` no toca el
catálogo de permisos ni necesita migración de propagación.

## Auditoría

Cada creación y cada rechazo por falta de permiso quedan en `audit_logs` con
`resource_type = 'contact_note'`, la acción `contact_note.create`, el resultado
y el `correlationId` de la petición.

El cuerpo nunca entra en la auditoría ni en los logs: una nota es dato personal
por contexto, así que lo que se conserva son identificadores, no lo escrito.

## Panel

En **Contactos**, las notas acompañan a la ficha, debajo de las etiquetas e
identidades. Se escriben mirando a la persona, sin conversación de origen.

En **Conversaciones**, el botón «Notas» abre un panel lateral junto a «Ficha» y
«Oportunidad». Lo que se escribe ahí conserva el hilo como origen. El panel no
consulta nada hasta abrirse: mirar una conversación no debería costar una
consulta por cada cosa que podría consultarse.

Tras guardar se relee la lista completa en vez de insertar la nota devuelta,
porque el orden y el autor los decide el servidor.

## Límites conocidos

- Una nota no se edita ni se borra. El corte entrega lo que el criterio de
  salida exige —registrar y consultar—; corregir una nota es una decisión sobre
  qué hacer con la versión anterior, y esa decisión todavía no está tomada.
- Sin hilo de comentarios, adjuntos ni menciones: quedan fuera del alcance de
  #37.
- Sin recordatorios ni notificaciones. Pertenecen a Fase 4.
- Las tareas con responsable y vencimiento, y las citas, todavía no existen.
