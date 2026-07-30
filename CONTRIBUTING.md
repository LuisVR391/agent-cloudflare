# Contribuir

## Flujo local

1. Usa Node.js 22 (`nvm use`).
2. Instala dependencias con `npm ci`.
3. Genera bindings con `npm run cf-typegen`.
4. Inicia el entorno con `npm run dev`.
5. Antes de enviar cambios, ejecuta `npm run check`.

## Convenciones

- TypeScript estricto y sin `any`.
- Los servicios Cloudflare se consumen mediante bindings.
- Cada nueva clase Durable Object requiere una migración nueva; las migraciones
  existentes no se editan.
- No se aceptan secretos, `.dev.vars` ni datos reales de clientes en commits.
- Los cambios deben incluir pruebas proporcionales al riesgo.
