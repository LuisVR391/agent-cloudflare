# ADR-0011: Incorporación de colaboradores por invitación

**Estado:** Propuesto

**Fecha:** 2026-08-12

## Contexto

[ADR-0007](./ADR-0007-better-auth-and-organization-context.md) cerró el
registro público: `emailAndPassword.disableSignUp` solo se levanta durante la
instalación inicial, protegida por `AUTH_SETUP_TOKEN`. Esa decisión dejó
explícito que las invitaciones, la recuperación por correo y la administración
de usuarios llegarían con capacidades posteriores.

Fase 2 llega a ese punto. Un CRM se opera entre varias personas: sin una
segunda cuenta no hay a quién asignar una conversación, un responsable de tarea
o de cita, y el corte de equipo
([#35](https://github.com/LuisVR391/agent-cloudflare/issues/35)) no tendría
sentido. Hoy la única cuenta del producto es la que creó la instalación.

Reabrir el registro sería la vía corta y también la peligrosa: expondría la
creación de cuentas a cualquiera que alcance el origen. Y el correo saliente
—la forma habitual de repartir una invitación— pertenece a Fase 4, así que la
decisión no puede depender de él.

## Decisión

El alta de colaboradores ocurre **solo por invitación**. El registro abierto
permanece deshabilitado, tal como lo fijó ADR-0007.

### Crear la invitación

Quien tiene `users.manage` en la organización activa crea una invitación con
correo, roles y expiración. La invitación pertenece a la organización, como
cualquier otra entidad empresarial.

El token es opaco, de un solo uso, y **se conserva hasheado**: D1 nunca guarda
el valor en claro, del mismo modo que `AUTH_SETUP_TOKEN` se compara sin
almacenarse. El enlace se entrega a la persona por el medio que la empresa ya
use; el producto no envía correo en esta fase.

### Aceptar la invitación

Aceptar es el único camino que habilita el alta de credenciales, y únicamente
para el correo invitado. La aceptación:

1. Verifica el token por hash y comprueba vigencia, estado y correspondencia
   con el correo, fallando cerrada en cualquier discrepancia.
2. Consume el token de forma exclusiva, de modo que dos intentos simultáneos
   producen una sola membresía.
3. Crea la identidad y la membresía con los roles declarados en la invitación,
   no con roles enviados por el cliente.

Los límites de `auth_rate_limits` aplican al intento de aceptación, igual que a
la instalación y al inicio de sesión.

### Lo que no cambia

- Los roles siguen siendo fijos: `owner`, `manager` y `operator`. Una
  invitación elige entre ellos; no los define.
- La organización activa se sigue derivando de la sesión y las membresías, y
  nunca de un identificador enviado por el frontend.
- Crear, aceptar, expirar o rechazar una invitación queda en `audit_logs` con
  actor, resultado y `correlationId`. El token nunca aparece en la auditoría,
  los logs ni las respuestas.

## Consecuencias

### Positivas

- El producto puede operarse en equipo sin abrir el registro a Internet.
- La superficie de alta queda acotada a un secreto de un solo uso, con
  expiración y auditoría, y reutiliza el patrón de custodia que ya se aplica al
  token de instalación.
- La membresía y los roles se fijan en el momento de invitar, así que la
  persona invitada no puede elevarse a sí misma durante el alta.
- Desbloquea asignación de conversaciones, tareas y citas, que son la base de
  los cortes siguientes.

### Costos y obligaciones

- El reparto del enlace es manual y queda fuera del producto: la empresa asume
  ese canal hasta que Fase 4 aporte salida propia.
- Un token filtrado es suficiente para crear la cuenta invitada. Se mitiga con
  expiración corta, un solo uso, límite de intentos y revocación, no con
  obscuridad.
- Hace falta un camino de revocación y reenvío; una invitación olvidada no debe
  quedar vigente para siempre.
- Aceptar debe ser exclusivo bajo concurrencia: sin esa garantía, dos
  peticiones simultáneas duplicarían membresías.
- El modelo de seguridad, que hoy declara que no existen invitaciones, deja de
  ser exacto y se actualiza en el mismo corte.

## Alternativas consideradas

- **Reabrir `disableSignUp` y filtrar por dominio de correo:** rechazada.
  Convierte un dominio en credencial y contradice ADR-0007.
- **Crear la cuenta con contraseña temporal desde el panel:** rechazada. Obliga
  a que una persona conozca la contraseña de otra y a transportarla por un canal
  fuera del producto.
- **Esperar a Fase 4 para tener correo saliente:** rechazada. Bloquearía la
  asignación, las tareas y las citas de Fase 2 por una dependencia de
  transporte, no de dominio.
- **Guardar el token en claro para poder reenviar el mismo enlace:** rechazada.
  Un secreto legible en D1 contradice las reglas de custodia; reenviar genera
  una invitación nueva.
- **Invitación sin expiración:** rechazada. Un enlace permanente es una
  credencial permanente.

## Referencias

- [ADR-0007: Better Auth y contexto organizacional](./ADR-0007-better-auth-and-organization-context.md)
- [Modelo de seguridad](../architecture/security-model.md)
- [Operación de autenticación](../operations/authentication.md)
- [Modelo de dominio](../architecture/domain-model.md)
- [Issue #33](https://github.com/LuisVR391/agent-cloudflare/issues/33) y
  [#35](https://github.com/LuisVR391/agent-cloudflare/issues/35)
