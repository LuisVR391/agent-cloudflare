# Servicios, pipeline y oportunidades

> **Estado:** vigente para el catálogo de servicios, primer corte del tercer
> entregable de Fase 2
> ([Issue #36](https://github.com/LuisVR391/agent-cloudflare/issues/36)).
> El pipeline, sus etapas y las oportunidades **todavía no existen en el
> código**: llegan en los cortes siguientes del mismo issue.

[ADR-0010](../decisions/ADR-0010-crm-commercial-model.md) decide que el
catálogo de servicios es dato relacional con dueño en D1, no conocimiento
recuperable: un servicio se agenda, se cobra y se cuenta, así que necesita
autoridad relacional y consultas exactas. Este documento describe lo que existe
hoy.

## Qué conserva cada tabla

| Tabla | Contenido |
| --- | --- |
| `services` | Nombre, nombre normalizado, duración, precio opcional con su moneda, estado y versión |

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

## Superficie HTTP

Todas las rutas exigen sesión, resuelven la organización activa desde el
contexto autenticado y fallan cerradas sin ella. Un servicio de otra
organización responde `404`, nunca `403`: la respuesta no revela que existe.

| Ruta | Método | Permiso |
| --- | --- | --- |
| `/api/services` | `GET` | `services.read` |
| `/api/services` | `POST` | `services.manage` |
| `/api/services/:id` | `GET` | `services.read` |
| `/api/services/:id` | `PATCH` | `services.manage` |

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

Los tres roles leen el catálogo porque quien atiende una conversación necesita
saber qué ofrece la empresa. Editarlo es decisión de negocio y queda fuera de
`operator`.

El catálogo de permisos se siembra durante la instalación
(`AuthorizationRepository.seedOwner`), de modo que una organización ya instalada
no recibiría los permisos de este corte. La migración `0012` los concede a los
roles existentes por `role_key` y es idempotente;
`test/services.test.ts` comprueba que una instalación nueva y una migrada
producen el mismo catálogo.

## Auditoría

Crear o editar un servicio queda en `audit_logs` con actor, recurso, resultado
y `correlationId`. Un intento sin `services.manage` se audita como `rejected`
antes de responder `403`. La auditoría guarda el identificador del servicio,
nunca su precio.

## Panel

`/app/servicios` lista el catálogo, permite darlo de alta, editarlo y
archivarlo. Quien solo tiene `services.read` ve la lista de servicios activos
sin acciones de gestión; el backend vuelve a comprobar el permiso en cada
petición, así que ocultarlas es cortesía, no control.

## Qué falta de este entregable

- Pipelines y etapas configurables con orden y color, y la siembra idempotente
  del pipeline inicial de salón de belleza.
- Oportunidades vinculadas a un contacto y, opcionalmente, a la conversación
  que las originó, con historial de etapa y concurrencia optimista.
- Tablero de pipeline y creación de oportunidad desde la conversación.

Hasta que existan, `services` es un catálogo consultable que ninguna otra
entidad referencia todavía.
