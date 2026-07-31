# ADR-0007: Better Auth en D1 y contexto organizacional validado

**Estado:** Aceptado

**Fecha:** 2026-07-30

## Contexto

El panel necesita identidad, sesiones y autorización antes de exponer datos
empresariales. [ADR-0002](./ADR-0002-d1-source-of-truth.md) hace a D1
autoritativo para usuarios y membresías, mientras
[ADR-0006](./ADR-0006-d1-schema-conventions.md) exige repositorios y aislamiento
por `organization_id`. También se necesita evitar una implementación propia de
contraseñas y cookies sin convertir una librería externa en dueña de roles,
permisos u organizaciones.

## Decisión

Se adopta Better Auth para autenticación por correo y contraseña y manejo de
sesiones. Su adaptador D1 es el único acceso técnico directo autorizado a las
tablas `users`, `user_sessions`, `user_accounts` y `auth_verifications`.
Estas tablas globales describen identidad y sesión, no datos empresariales.

La autorización permanece en el dominio del producto:

- D1 conserva `memberships`, roles fijos, permisos efectivos y auditoría.
- Una sesión no selecciona ni autoriza por sí sola una organización.
- El Worker obtiene las membresías activas en backend; si existe una, la
  selecciona automáticamente. Con varias, exige una selección válida.
- La organización activa viaja en una cookie `HttpOnly`, `SameSite=Lax`,
  firmada con HMAC. En cada solicitud se vuelve a comprobar la firma, la
  membresía, el estado de la organización y el permiso requerido.
- Los identificadores enviados por el frontend nunca otorgan acceso.

El registro público queda deshabilitado. `/setup` es un flujo de instalación
de un solo uso protegido por `AUTH_SETUP_TOKEN`, con bloqueo persistente y
lease en D1. Crea la primera organización, propietario, membresía, roles fijos
`owner`, `manager` y `operator`, permisos iniciales y auditoría. Si falla,
compensa los datos creados y libera el bloqueo.

`BETTER_AUTH_SECRET`, `AUTH_SETUP_TOKEN` y el origen público se entregan por
Cloudflare Secrets o configuración de entorno; nunca se persisten en D1 ni se
registran. El rate limit de autenticación usa D1 y solo guarda una clave HMAC,
conteo y timestamp numérico técnico.

## Consecuencias

### Positivas

- Contraseñas, cookies y sesiones usan una implementación mantenida y
  especializada.
- Organizaciones y permisos siguen bajo control explícito del dominio.
- El acceso falla de forma cerrada ante cookie alterada, membresía inexistente,
  organización suspendida o falta de permiso.
- El panel puede crecer por fases sin presentar módulos futuros como activos.

### Costos y obligaciones

- Las migraciones de las tablas técnicas deben mantenerse compatibles con la
  versión instalada de Better Auth.
- Actualizar Better Auth exige revisar schema, cookies, rate limit, pruebas de
  instalación y compatibilidad de sesiones.
- El adaptador D1 es una excepción deliberada al acceso exclusivo mediante
  repositorios de ADR-0006. Todo SQL propio del producto continúa en
  `src/worker/repositories/`.
- El flujo inicial no incluye recuperación por correo, invitaciones, MFA,
  OAuth ni edición de roles. Cada capacidad requerirá issue y controles
  adicionales.
- El secreto de sesión debe rotarse mediante una operación planificada porque
  una rotación invalida sesiones y firmas de organización activas.

## Alternativas consideradas

- **Autenticación y hash de contraseñas propios:** rechazada por ampliar
  innecesariamente la superficie criptográfica y de mantenimiento.
- **Plugin de organizaciones como fuente de autorización:** rechazado para
  mantener organizaciones, membresías y permisos bajo el modelo canónico del
  producto.
- **Organización enviada en cada request sin firma:** rechazada porque confía
  en un identificador controlado por el cliente.
- **Registro público:** rechazado para la primera fase; las cuentas se
  administrarán mediante capacidades posteriores.
- **Estado de sesión en memoria global:** rechazado porque no sobrevive ni
  coordina instancias de Workers.

## Referencias

- [Issue #6](https://github.com/LuisVR391/agent-cloudflare/issues/6)
- [ADR-0002: D1 como fuente de verdad](./ADR-0002-d1-source-of-truth.md)
- [ADR-0006: Convenciones de esquema](./ADR-0006-d1-schema-conventions.md)
- [Modelo de seguridad](../architecture/security-model.md)
- [Operación de autenticación](../operations/authentication.md)
