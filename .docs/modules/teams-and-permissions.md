# Equipo, invitaciones y asignación

> **Estado:** vigente para el segundo corte de Fase 2
> ([Issue #35](https://github.com/LuisVR391/agent-cloudflare/issues/35)).
> Describe lo que existe en el código, no el alcance completo del CRM.

[ADR-0007](../decisions/ADR-0007-better-auth-and-organization-context.md) cerró
el registro público y dejó una sola cuenta por instalación.
[ADR-0011](../decisions/ADR-0011-collaborator-invitations.md) abre la
incorporación de colaboradores sin reabrirlo: se entra **solo por invitación**.
Este documento describe cómo funciona hoy y qué garantiza.

## Qué conserva cada tabla

| Tabla | Contenido |
| --- | --- |
| `organization_invitations` | Correo, rol, vencimiento, estado y el HMAC del token |
| `conversations.assigned_membership_id` | Responsable vigente de la conversación |
| `conversation_assignments` | Historial: quién asignó, a quién y cuándo |

`memberships`, `roles`, `permissions`, `membership_roles` y `role_permissions`
siguen siendo la autorización canónica del producto, sin cambios de forma.

## Ciclo de la invitación

```text
users.manage crea  -> pending
persona acepta     -> accepting (lease) -> accepted
quien administra   -> revoked
intento tardío     -> expired
```

`expired` no lo escribe ningún proceso que recorra la tabla: se marca cuando un
intento llega tarde, y el panel lo deriva de `expires_at` para no anunciar como
vigente algo que ya venció. Reenviar no reutiliza el enlace anterior: crea una
invitación nueva y revoca la previa del mismo correo en la misma operación,
porque un enlace olvidado es una credencial olvidada.

### Custodia del token

El token son 32 bytes aleatorios en base64url y solo existe en la respuesta que
crea la invitación. D1 conserva su HMAC-SHA256 con el secreto de sesión, así que
un volcado de la base no basta para reconstruirlo ni para verificar candidatos.
No aparece en `audit_logs`, en los logs operativos ni en ninguna otra respuesta;
si se pierde, se crea una invitación nueva.

Rotar `BETTER_AUTH_SECRET` invalida las invitaciones vigentes, igual que ya
invalida sesiones y cookies de organización. Es una operación planificada y el
efecto es el correcto.

El enlace lleva el token en el **fragmento** —`/invitacion#<token>`—, que el
navegador no envía al servidor: no llega a registros de acceso ni viaja en un
`Referer`. El panel lo lee, lo borra de la barra de direcciones y lo reenvía en
el cuerpo de una petición al mismo origen.

### Aceptar

La aceptación es el segundo y último camino que levanta `disableSignUp`, y vive
junto a la instalación en `src/worker/auth/http.ts` para que ambas llamadas
queden auditables en un solo archivo. En orden:

1. Consume el límite de `auth_rate_limits` antes de tocar el token, para que la
   ruta no sirva como oráculo de fuerza bruta.
2. Busca por hash y comprueba vigencia, estado y coincidencia exacta del correo.
3. Reclama la invitación con un lease de cinco minutos. Dos intentos simultáneos
   compiten en esa sentencia y solo uno cambia la fila, así que solo uno crea
   identidad y membresía.
4. Crea la identidad con el correo **de la invitación**, no con el del cuerpo, y
   la membresía activa con el rol declarado al invitar.
5. Si algo falla después de reclamar, compensa lo creado y devuelve la
   invitación a `pending`: un fallo transitorio no quema el enlace.

Cualquier invitación inutilizable —inexistente, vencida, revocada, ya consumida
o dirigida a otro correo— responde lo mismo. La previsualización tampoco revela
el correo invitado: escribirlo es lo que demuestra saber a quién se invitó.

Un correo que ya tiene cuenta sí recibe una respuesta distinta, porque a esas
alturas el token ya demostró conocer la invitación. Vincular una cuenta
existente a una segunda organización queda fuera de este corte.

## Superficie HTTP

Todas las rutas de equipo exigen sesión y resuelven la organización activa desde
el contexto autenticado. Una invitación de otra organización responde `404`,
nunca `403`: la respuesta no revela que existe.

| Ruta | Método | Permiso |
| --- | --- | --- |
| `/api/team/members` | `GET` | `users.read` |
| `/api/team/invitations` | `GET` | `users.manage` |
| `/api/team/invitations` | `POST` | `users.manage` |
| `/api/team/invitations/:id/revoke` | `POST` | `users.manage` |
| `/api/invitations/preview` | `POST` | Público, con límite de intentos |
| `/api/invitations/accept` | `POST` | Público, con límite de intentos |

`POST /api/team/invitations` responde con la invitación y el enlace. El enlace
se construye con el origen configurado del entorno, nunca con el `Host` de la
petición, que lo fija quien llama.

Los tres roles reciben `users.read`, porque los tres gestionan conversaciones y
no se puede asignar una sin ver a quién. `users.manage` —invitar y revocar—
sigue siendo exclusivo de `owner`.

## Responsable de conversación

El responsable es una **membresía**, no un usuario suelto: `memberships` ya
pertenece a una organización, de modo que `conversation_assignments` puede
declarar por clave foránea compuesta que responsable y conversación viven en el
mismo aislamiento.

`PATCH /api/conversations/:id` acepta `assigneeMembershipId` además de estado y
modo de atención, conservando `expectedVersion`. Un campo ausente conserva su
valor y `null` retira el responsable. Asignar exige `conversations.manage`.

La actualización y su historial viajan en un solo lote, que D1 ejecuta como
transacción. El `UPDATE` solo escribe el responsable si existe una membresía
activa de la organización, comprobado en la misma sentencia para no dejar
ventana entre verificar y escribir, y cada inserción de historial comprueba que
la conversación quedó en la versión y el instante que esa operación escribió.
Así el historial no puede sobrevivir a un cambio que no ocurrió.

`conversations.assigned_membership_id` no lleva clave foránea porque SQLite no
admite declarar una compuesta en `ALTER TABLE ADD COLUMN`, y recrear
`conversations` arrastraría `messages`, `conversation_status_history` y
`outbound_message_deliveries`. La integridad la sostienen la comprobación de la
sentencia y, de forma transitiva, las claves foráneas del historial: una
membresía ajena revierte el lote completo.

El Durable Object no participa. El responsable es dato relacional y su dueño es
D1; el runtime solo coordina el estado vivo de la conversación.

El índice único `organization_invitations_token_unique` es la única excepción
del repositorio a la regla de que todo índice empieza por `organization_id`
([ADR-0006](../decisions/ADR-0006-d1-schema-conventions.md)). La aceptación no
tiene sesión ni organización activa: es el token el que las resuelve, así que la
búsqueda por hash debe ser global.

## Observabilidad

`audit_logs` registra la creación, aceptación, revocación, expiración y rechazo
de invitaciones con actor, resultado y `correlationId`, y el identificador de la
invitación como recurso. Nunca el token ni el correo.

Un rechazo cuyo token no identifica ninguna invitación no puede auditarse: sin
organización validada no hay a quién atribuirlo. Se emite como evento operativo
redactado, según [contratos transversales](../architecture/contracts.md).

Cada cambio de responsable queda en `conversation_assignments` con el
responsable anterior, el siguiente, el actor y su `correlationId`.

## En el panel

La sección `Equipo` muestra a cada miembro con su rol y estado. Quien administra
ve además las invitaciones, puede crear y revocar, y recibe el enlace **una sola
vez** con el aviso de que no vuelve a mostrarse.

En el inbox, la lista filtra por Todas, Mías, Sin responsable o una persona
concreta, y la cabecera del hilo elige responsable con la misma concurrencia
optimista que pausar o resolver. Un mensaje enviado por otra persona ya se
atribuye a su nombre en vez de anunciarse como equipo.

Los controles solo aparecen con el permiso correspondiente, y el backend vuelve
a comprobarlo en cada petición: ocultar un control no es un control de
seguridad.

## Fuera de alcance

Envío de correo —el enlace se comparte a mano hasta que Fase 4 aporte salida
propia—, editor de roles y permisos personalizados, suspender o revocar
membresías desde el panel, vincular una cuenta existente a otra organización,
recuperación de contraseña, MFA, OAuth y reasignación automática por reglas.
