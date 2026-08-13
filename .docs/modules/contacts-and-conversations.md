# Contactos y su relación con la conversación

> **Estado:** vigente para el primer corte de Fase 2
> ([Issue #34](https://github.com/LuisVR391/agent-cloudflare/issues/34)).
> Describe lo que existe en el código, no el alcance completo del CRM.

El [modelo de dominio](../architecture/domain-model.md) define el contacto como
la persona atendida por una organización, y la identidad de contacto como su
representación dentro de un canal. Este documento describe cómo se resuelven,
consultan y editan hoy.

## Qué conserva cada tabla

| Tabla | Contenido |
| --- | --- |
| `contacts` | Ficha empresarial: nombre, teléfono, correo, estado y versión |
| `contact_identities` | Identidad externa por proveedor, única dentro de la organización |
| `contact_tags` | Etiquetas de la organización, con nombre normalizado y color semántico |
| `contact_tag_assignments` | Qué etiqueta lleva cada contacto, quién la puso y cuándo |

Las claves foráneas de las etiquetas incluyen `organization_id` en ambos lados.
Dos claves independientes serían válidas por separado mientras la combinación
cruza el límite de aislamiento, que es justo lo que
[ADR-0006](../decisions/ADR-0006-d1-schema-conventions.md) prohíbe.

## Cómo aparece un contacto

Un contacto no se crea a mano: lo crea el primer mensaje entrante. El
[ciclo de vida de mensajes](./message-lifecycle.md) resuelve la identidad
externa y, si no existe, inserta contacto e identidad en la misma operación.

El webhook de Zernio entrega `sender.phoneNumber` junto al identificador
externo. Ese número se conserva en la ficha, con una regla explícita:

- Si la ficha no tiene teléfono, el canal lo completa.
- Si ya tiene uno, el canal **no lo toca**. Una corrección manual vale más que
  lo que reporta el proveedor, y sobrescribirla la perdería en el siguiente
  mensaje.

El nombre es distinto: el webhook no lo entrega, así que un contacto nace sin
nombre y el inbox muestra su identificador externo hasta que alguien escribe
uno en la ficha. Zernio conserva el nombre del participante en su propia API,
pero traerlo exigiría una llamada externa en el flujo entrante y queda fuera de
este corte.

El teléfono es dato personal: no se escribe en logs ni en trazas, y la
auditoría guarda el identificador del contacto, nunca su contenido.

## Superficie HTTP

Todas las rutas exigen sesión, resuelven la organización activa desde el
contexto autenticado y fallan cerradas sin ella. Un contacto de otra
organización responde `404`, nunca `403`: la respuesta no revela que existe.

| Ruta | Método | Permiso |
| --- | --- | --- |
| `/api/contacts` | `GET` | `contacts.read` |
| `/api/contacts/:id` | `GET` | `contacts.read` |
| `/api/contacts/:id` | `PATCH` | `contacts.manage` |
| `/api/contacts/:id/tags` | `POST` | `contacts.manage` |
| `/api/contacts/:id/tags/:tagId` | `DELETE` | `contacts.manage` |
| `/api/contact-tags` | `GET` | `contacts.read` |

El listado acepta `query`, `limit` y `cursor`, y reutiliza el cursor opaco de
`/api/conversations`: transporta la tupla que ordena la consulta y se valida
antes de tocar SQL. La búsqueda es un `LIKE` sobre nombre, teléfono y correo
con los comodines del texto escrito escapados, de modo que buscar `%` no
devuelva la organización entera.

La edición usa concurrencia optimista: `expectedVersion` debe coincidir con la
versión vigente o la respuesta es `409`. Un campo ausente conserva su valor y
`null` lo borra, así que editar el correo no vacía el teléfono.

## Etiquetas

Una etiqueta se crea al asignarla. El nombre se pliega a minúsculas y se
recorta para decidir la unicidad dentro de la organización, de modo que «VIP» y
«vip» son la misma etiqueta. El color es un token semántico —`neutral`, `info`,
`success`, `warning`, `danger`—, no una clase de estilo: la interfaz lo traduce
a una variante de componente, según
[ADR-0009](../decisions/ADR-0009-client-ui-composition.md).

## En el panel

La sección `Contactos` recorre el directorio con búsqueda y muestra la ficha
junto a la lista. Desde la conversación, la cabecera del hilo abre la misma
ficha en un panel lateral, sin sacar a la persona del hilo que atiende. El
botón solo aparece con `contacts.read` y los campos solo se editan con
`contacts.manage`; el backend vuelve a comprobar ambas cosas en cada petición,
porque ocultar un control no es un control de seguridad.

## Fuera de alcance

Fusionar contactos duplicados, deduplicar por teléfono entre canales, importar
o exportar, y las notas y tareas del contacto, que pertenecen a su propio corte
de Fase 2.
