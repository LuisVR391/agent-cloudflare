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
| `owner` | Panel, conversaciones, contactos, agentes, usuarios y organización |
| `manager` | Panel, conversaciones, contactos y agentes |
| `operator` | Panel, operación de conversaciones y contactos |

Los tres roles gestionan contactos: quien atiende la conversación es quien
descubre el nombre correcto de la persona mientras habla con ella.

Los módulos de agentes y equipo todavía están planificados. El panel muestra su
lugar futuro deshabilitado; los permisos no implican que esas interfaces o
contratos ya existan.

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

## Fuera de alcance

No existen todavía recuperación de contraseña por correo, invitaciones, MFA,
OAuth, edición de roles ni administración de usuarios. Tampoco existe un panel
operativo de conversaciones o agentes. Estas capacidades requieren issues y
pruebas proporcionales antes de activarse.
