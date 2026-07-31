# Contribuir

Antes de modificar arquitectura, persistencia o integraciones, consulta las
[reglas compartidas del repositorio](./AGENTS.md). Este documento resume el
flujo local; `AGENTS.md` mantiene los principios y restricciones transversales.

## Flujo local

1. Usa Node.js 22 (`nvm use`).
2. Instala dependencias con `npm ci`.
3. Genera bindings con `npm run cf-typegen`.
4. Inicia el entorno con `npm run dev`.
5. Antes de enviar cambios, ejecuta `npm run check`.

Si trabajas con Codex o Claude Code, revisa la
[guía de continuidad de agentes](./.docs/operations/agent-continuity.md).
El skill se descubre desde el repositorio, pero los hooks requieren revisión y
confianza explícita mediante `/hooks` cada vez que cambie su definición.

## Convenciones

- TypeScript estricto y sin `any`.
- Los servicios Cloudflare se consumen mediante bindings.
- Cada nueva clase Durable Object requiere una migración nueva; las migraciones
  existentes no se editan.
- No se aceptan secretos, `.dev.vars` ni datos reales de clientes en commits.
- Los cambios deben incluir pruebas proporcionales al riesgo.
- Todo PR declara su impacto en documentación, ADR, roadmap y validación,
  incluso cuando una categoría no aplique.
