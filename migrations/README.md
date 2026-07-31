# Migraciones de D1

Este directorio contiene el esquema versionado de la base D1 declarada como
binding `DB`. Las convenciones que rigen su contenido están en
[ADR-0006](../.docs/decisions/ADR-0006-d1-schema-conventions.md); la autoridad
de D1 sobre los datos empresariales está en
[ADR-0002](../.docs/decisions/ADR-0002-d1-source-of-truth.md).

## Reglas

- Los archivos siguen `NNNN_descripcion.sql` con numeración correlativa de
  cuatro dígitos y se aplican en orden.
- Toda migración debe poder aplicarse desde una base vacía.
- Los cambios son aditivos. **Una migración versionada no se edita ni se
  borra**: un cambio posterior siempre es un archivo nuevo. El guardrail de
  agentes bloquea la edición de un archivo de este directorio que ya esté en
  git.
- Toda tabla empresarial incluye `organization_id TEXT NOT NULL` y un índice
  que empiece por esa columna.
- Ninguna columna almacena secretos.

## Crear una migración

```bash
npx wrangler d1 migrations create agent-cloudflare-db <descripcion>
```

El comando crea el archivo con el siguiente número disponible. Escribe el SQL y
aplícalo en local antes de commitear.

## Aplicar en local

```bash
npm run db:migrate          # aplica las migraciones pendientes
npm run db:migrations:list  # muestra cuáles faltan por aplicar
```

Ambos comandos operan siempre con `--local`. La ejecución remota de D1 desde un
agente está bloqueada por los guardrails del repositorio, y crear la base real
requiere autorización explícita; ese trabajo pertenece al issue de entornos y
staging.

El flujo completo de desarrollo local, incluido cómo inspeccionar o restablecer
la base, está en [base de datos
local](../.docs/operations/local-database.md).

## Pruebas

Las pruebas no usan estos comandos: `vitest.config.ts` lee este directorio con
`readD1Migrations` y `test/apply-migrations.ts` aplica el resultado con
`applyD1Migrations` sobre una base vacía en cada archivo de prueba. Una
migración nueva queda cubierta automáticamente.
