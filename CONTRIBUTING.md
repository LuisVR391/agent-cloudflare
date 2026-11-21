# Contribuir

Antes de modificar arquitectura, persistencia o integraciones, consulta las
[reglas compartidas del repositorio](./AGENTS.md). Este documento resume el
flujo local; `AGENTS.md` mantiene los principios y restricciones transversales.

## Flujo local

1. Usa Node.js 22 (`nvm use`).
2. Instala dependencias con `npm ci`.
3. Genera bindings con `npm run cf-typegen`.
4. Inicia el entorno con `npm run dev`.
5. Instala el hook Git con `npm run hooks:install`.
6. Antes de enviar cambios, actualiza la documentación afectada y ejecuta
   `npm run check` y `git diff --check`.

El [flujo de entrega](./.docs/operations/entrega.md) cubre Notion, revisión y
pruebas antes de fusionar o desplegar, y configuración de Codex y Claude Code.

## Convenciones

- TypeScript estricto y sin `any`.
- Los servicios Cloudflare se consumen mediante bindings.
- Cada nueva clase Durable Object requiere una migración nueva; las migraciones
  existentes no se editan.
- No se aceptan secretos, `.dev.vars` ni datos reales de clientes en commits.
- Los cambios deben incluir pruebas proporcionales al riesgo.
- Todo PR declara su impacto en documentación, ADR, roadmap y validación,
  incluso cuando una categoría no aplique.
