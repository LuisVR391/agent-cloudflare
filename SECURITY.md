# Seguridad

## Reportar una vulnerabilidad

No publiques vulnerabilidades, tokens o datos de clientes en issues públicos.
Reporta el hallazgo de forma privada al propietario del repositorio.

## Principios del proyecto

- La clave de API y el secreto de webhook de Zernio, junto con otros secretos,
  se administran con `wrangler secret put`; nunca se guardan en Git.
- `BETTER_AUTH_SECRET` y `AUTH_SETUP_TOKEN` son distintos por entorno. El
  registro público permanece deshabilitado y la instalación inicial se cierra
  en D1 después del primer propietario.
- Una sesión válida no autoriza una organización por sí sola: membresía,
  organización activa y permisos se validan en backend.
- Los webhooks de Zernio deben verificar `X-Zernio-Signature` sobre el cuerpo
  crudo antes de interpretar o procesar el evento.
- Una cuenta externa solo puede resolver organización y canal mediante
  configuración confiable de D1; el identificador del webhook no autoriza.
- Los identificadores de eventos deben deduplicarse antes de producir efectos.
- Los archivos recibidos se almacenarán mediante el binding de R2, no mediante
  llamadas REST a la API de Cloudflare.
- El procesamiento lento o reintentable debe salir de la ruta crítica mediante
  Queues o Workflows.
- Los logs no deben contener mensajes completos, tokens ni datos personales.
