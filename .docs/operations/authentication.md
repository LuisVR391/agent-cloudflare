# Autenticación local y configuración inicial

La arquitectura y límites de seguridad están en
[modelo de seguridad](../architecture/security-model.md) y
[ADR-0007](../decisions/ADR-0007-better-auth-and-organization-context.md).

## Variables

Copia `.dev.vars.example` como `.dev.vars` y sustituye todos los marcadores:

```text
BETTER_AUTH_SECRET=<valor aleatorio de al menos 32 caracteres>
AUTH_SETUP_TOKEN=<token aleatorio de un solo uso>
BETTER_AUTH_URL=http://localhost:5190
```

No confirmes `.dev.vars`. En un entorno remoto registra los valores
interactivamente:

```bash
npx wrangler secret put BETTER_AUTH_SECRET
npx wrangler secret put AUTH_SETUP_TOKEN
```

`BETTER_AUTH_URL` es opcional; cuando se define debe coincidir exactamente con
el origen público. Si falta, el Worker usa el origen de la solicitud. No se
creó ni modificó ningún recurso remoto como parte del Issue #6.

## Arranque local

```bash
npm run db:migrate
npm run dev
```

Vite usa `http://localhost:5190` y falla explícitamente si ese puerto está
ocupado, en lugar de cambiar silenciosamente a otro origen que invalide la
configuración de autenticación.

1. Abre `/setup`.
2. Introduce `AUTH_SETUP_TOKEN`, organización y propietario.
3. Al completar, `/setup` redirige a `/login` y no puede reutilizarse.
4. Inicia sesión y abre `/app`.

No compartas el token de instalación ni lo incluyas en URLs, logs o capturas.
Después de instalar un entorno, puedes rotarlo; el estado cerrado permanece en
D1.

## Recuperación

En desarrollo, para repetir desde cero, elimina únicamente el estado local
siguiendo [base de datos local](./local-database.md) y vuelve a aplicar las
migraciones. En staging o producción no borres tablas ni el registro de
instalación: la recuperación requiere un procedimiento autorizado y
auditable.

Rotar `BETTER_AUTH_SECRET` invalida sesiones y cookies de organización, por lo
que debe tratarse como una operación planificada.
