# Modelo de seguridad del panel

Este documento describe los controles implementados para el acceso
administrativo. La decisión y sus límites están en
[ADR-0007](../decisions/ADR-0007-better-auth-and-organization-context.md).

## Fronteras de confianza

- El navegador, sus cookies no verificadas, parámetros y cuerpos JSON son
  entradas no confiables.
- Better Auth demuestra identidad mediante una sesión válida en D1.
- La identidad no demuestra pertenencia empresarial: el Worker resuelve
  membresías, organización activa, rol y permisos desde D1.
- Los prompts y el Durable Object no autorizan acciones.
- Cloudflare Secrets custodia los secretos de sesión e instalación.
- `BETTER_AUTH_URL` declara el único origen público permitido para la
  autenticación de cada entorno; no se infiere de una solicitud.

## Flujo de acceso

```text
Credenciales
  -> Better Auth valida contraseña y crea sesión D1
  -> /api/context resuelve membresías activas
  -> una organización: selección automática
  -> varias organizaciones: selección explícita
  -> cookie firmada conserva la preferencia
  -> cada request revalida firma, membresía, organización y permiso
```

Una cookie alterada se ignora. Una cuenta suspendida, organización suspendida,
membresía revocada o falta de permisos produce rechazo en backend.

Las rutas protegidas distinguen sesión ausente, falta de membresía, selección
organizacional pendiente y permiso insuficiente. Ninguno de esos estados se
convierte en acceso por usar un identificador enviado por el frontend.

## Roles iniciales

Los roles son fijos en este corte y no existe editor:

| Rol | Alcance inicial |
| --- | --- |
| `owner` | Panel, conversaciones, contactos, agentes, equipo, usuarios y organización |
| `manager` | Panel, conversaciones, contactos, agentes y lectura de equipo |
| `operator` | Panel, operación de conversaciones y contactos, y lectura de equipo |

Los tres roles gestionan contactos: quien atiende la conversación es quien
descubre el nombre correcto de la persona mientras habla con ella. Y los tres
leen el equipo, porque los tres asignan conversaciones y no se puede asignar una
sin ver a quién. Invitar y revocar exigen `users.manage`, que solo tiene
`owner`.

Los agentes ya son configuración con superficie propia: `agents.read` los
consulta y `agents.manage` los crea, edita, publica, desactiva y revierte. Ese
segundo permiso no se desdobla para publicar, porque ya es el privilegio que
decide qué comportamiento tiene la empresa. `operator` no tiene ninguno de los
dos: atender una conversación no es configurar quién la atiende. El detalle está
en el [módulo de agentes y versiones](../modules/agents-and-versions.md) y en
[ADR-0014](../decisions/ADR-0014-configurable-agents-and-published-versions.md).

**Ejecutar** un agente sigue sin existir. Publicar una versión no cambia el
comportamiento de ninguna conversación, y las herramientas que una versión
declara no autorizan nada: no hay catálogo que las valide ni ruta que las
ejecute.

### Crecimiento del catálogo de permisos

`AuthorizationRepository.seedOwner` siembra el catálogo únicamente durante la
instalación, así que una organización ya instalada nunca vuelve a pasar por
ahí. Un permiso nuevo que solo se declarara en código dejaría a esa
organización sin acceso a la capacidad que lo exige.

Por eso, cada corte que añade permisos hace las tres cosas:

1. Declara el permiso en `permissionDefinitions` y `permissionsByRole`, que
   gobiernan las instalaciones nuevas.
2. Añade una migración aditiva que lo inserta y lo concede a los roles
   existentes por `role_key`, con `ON CONFLICT DO NOTHING` para que reaplicarla
   no duplique concesiones.
3. Cubre con una prueba que una instalación nueva y una migrada terminan con el
   mismo catálogo `(role_key, permission_key)`.

## Invitaciones

El alta de colaboradores ocurre solo por invitación, según
[ADR-0011](../decisions/ADR-0011-collaborator-invitations.md); el registro
público sigue cerrado. El [módulo de equipo](../modules/teams-and-permissions.md)
describe el flujo completo. Los controles son:

- El token es opaco, de un solo uso y **se conserva hasheado**: D1 guarda su
  HMAC con el secreto de sesión, nunca el valor.
- Viaja en el fragmento del enlace, que el navegador no envía al servidor, y en
  el cuerpo de las peticiones. Nunca en una query ni en `audit_logs`.
- La aceptación consume el límite persistente de `auth_rate_limits` antes de
  tocar el token, y reclama la invitación con un lease, de modo que dos
  intentos simultáneos producen una sola membresía.
- La identidad se crea con el correo de la invitación y la membresía con el rol
  declarado al invitar; el cliente no elige ninguno de los dos.
- Toda invitación inutilizable responde lo mismo. La previsualización no revela
  el correo invitado.
- Aceptar es el segundo y último punto que levanta `disableSignUp`, y vive junto
  a la instalación para que ambos queden auditables en un solo archivo.

## Instalación y registro

- El registro público de Better Auth está deshabilitado.
- `GET /api/setup/status` solo revela si hace falta la instalación.
- `POST /api/setup` limita tamaño y valida schema antes de producir efectos.
- `AUTH_SETUP_TOKEN` se compara sobre digests de tamaño fijo.
- Un bloqueo con lease en D1 permite una única instalación; después queda
  cerrado.
- Los fallos compensan usuario y organización creados antes de liberar el
  bloqueo.

## Sesiones y abuso

- Cookies de sesión y organización son `HttpOnly` y `SameSite=Lax`; usan
  `Secure` cuando el origen configurado usa HTTPS.
- Better Auth solo confía en el origen exacto de `BETTER_AUTH_URL`. Si falta,
  es inválido o no coincide con el origen de la solicitud, las rutas de
  autenticación y autorización fallan de forma cerrada.
- Better Auth mantiene sesiones en D1 y aplica rate limit persistente.
- La clave del rate limit se guarda como HMAC para no conservar IP ni
  identificadores crudos.
- Las respuestas de error usan un envelope estable y `correlationId`, sin
  contraseñas, tokens ni detalles internos.
- D1 audita la instalación, el cambio explícito de organización y los rechazos
  de permisos que ya tienen una organización y un actor validados.
- Los rechazos anteriores al contexto organizacional se registran como eventos
  operativos redactados con acción, motivo y `correlationId`. No incluyen
  credenciales, tokens, cuerpos, correos ni el identificador empresarial
  solicitado.

## Utillaje de desarrollo

El panel local expone `POST /api/dev/inbound-messages` para simular un mensaje
entrante sin salir del navegador. Una ruta capaz de inyectar mensajes falsos es
justo lo que nunca debe alcanzar un entorno real, así que se protege por capas
y ninguna basta sola:

1. `src/worker/index.ts` solo la importa dentro de `import.meta.env.DEV`, de
   modo que el artefacto construido no la contiene.
2. `scripts/validate-staging-build.mjs` comprueba esa ausencia sobre el bundle
   generado, dentro de `npm run check`. Si el guard fallara, el gate lo detecta
   antes de publicar.
3. La ruta solo responde cuando el origen de autenticación configurado es
   local. Se comprueba `BETTER_AUTH_URL` —configuración del entorno— y no solo
   el `Host` de la petición, que lo fija quien llama.
4. Exige sesión válida y `conversations.manage`, como cualquier otra escritura.

Fuera de un entorno local la ruta no se niega: no existe. La petición cae en el
`404` genérico de `/api/`, sin revelar que hubo algo ahí.

La simulación no escribe en D1: firma el evento y lo entrega al webhook real,
de modo que la deduplicación, la resolución de canal y el runtime se ejercitan
igual que con tráfico del proveedor.

## Fuera de alcance

No existen todavía recuperación de contraseña por correo, MFA, OAuth, edición de
roles ni suspensión de membresías desde el panel. Tampoco existe un panel
operativo de agentes. Estas capacidades requieren issues y pruebas
proporcionales antes de activarse.
