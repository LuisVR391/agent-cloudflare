# ADR-0008: Zernio como adaptador de WhatsApp

**Estado:** Aceptado

**Fecha:** 2026-08-10

## Contexto

La primera edición de Agent Cloudflare usará WhatsApp como canal inicial. La
arquitectura objetivo asumía una integración directa con WhatsApp Cloud API,
lo que obligaría al producto a implementar y operar la conexión de cuentas,
la recepción de eventos y el envío específico de Meta.

Zernio ya permite conectar cuentas de WhatsApp, entrega eventos de inbox
mediante webhooks firmados y expone una API para responder conversaciones. El
producto puede aprovechar esa superficie como canal sin delegar en Zernio el
CRM, el historial canónico, la coordinación conversacional ni las
automatizaciones.

## Decisión

Zernio será el adaptador bidireccional de WhatsApp:

- Las cuentas se conectarán inicialmente de forma manual desde el panel de
  Zernio.
- Zernio entregará al Worker los eventos de entrada y estados de mensaje.
- El consumidor de salida enviará respuestas mediante la API de inbox de
  Zernio.
- `whatsapp` seguirá siendo el tipo de canal del dominio; `zernio` identifica
  el adaptador que transporta sus mensajes.
- D1 relacionará cada identificador opaco de cuenta externa con un canal y una
  organización. Ningún identificador recibido en el webhook autoriza por sí
  mismo.
- D1 conservará el historial, la configuración, la deduplicación y los
  resultados empresariales canónicos. Queues, Durable Objects, R2, Workflows y
  la observabilidad conservarán las responsabilidades ya aceptadas.
- El inbox, contactos, workflows, IA, CRM y automatizaciones de Zernio quedan
  fuera del runtime del producto.

El webhook deberá configurarse con secreto. El Worker verificará
`X-Zernio-Signature` como HMAC-SHA256 hexadecimal del cuerpo crudo, validará el
schema y la plataforma, resolverá la cuenta hacia una organización confiable y
persistirá el identificador estable del evento antes de confirmar la entrega.
El procesamiento posterior se moverá a Queues para responder dentro del plazo
del proveedor.

La suscripción mínima de Fase 1 cubrirá `message.received`,
`message.delivered`, `message.read`, `message.failed` y
`account.disconnected`. Otros eventos requieren una necesidad de producto y
validación explícitas.

`ZERNIO_API_KEY` y `ZERNIO_WEBHOOK_SECRET` vivirán en Cloudflare Secrets,
separados por entorno. D1 solo podrá guardar referencias opacas y metadatos no
sensibles. La clave de API tendrá el alcance mínimo que permita enviar mensajes
y operar únicamente los perfiles requeridos.

## Consecuencias

### Positivas

- Se evita implementar directamente el onboarding y transporte específico de
  Meta durante el MVP.
- El núcleo mantiene un límite de canal que podrá sustituirse o ampliarse sin
  cambiar la autoridad de los datos.
- La recepción conserva firma, deduplicación, confirmación rápida y
  procesamiento asíncrono compatibles con la arquitectura Cloudflare-native.
- La empresa continúa operando conversaciones e intervención humana desde
  Agent Cloudflare.

### Costos y obligaciones

- Zernio se convierte en una dependencia externa del transporte de WhatsApp;
  sus fallos, límites y cambios de contrato deben observarse y aislarse.
- La entrega de webhooks es al menos una vez. La deduplicación persistente en
  D1 es obligatoria antes de encolar efectos.
- La API de envío acepta `Idempotency-Key` y conserva la clave durante 24
  horas. El consumidor debe derivar una clave estable por operación, persistir
  el intento y reutilizarla en reintentos; la reconciliación con la respuesta y
  los eventos de estado sigue siendo obligatoria.
- Los identificadores de cuenta, conversación, mensaje y contacto de Zernio
  son opacos y no sustituyen los identificadores canónicos del producto.
- Las referencias de medios no son almacenamiento permanente. El contenido
  que deba conservarse se validará y copiará a R2 con metadatos y permisos en
  D1.
- La conexión manual en Zernio es una operación externa pendiente; no se
  presentará como capacidad disponible hasta completar la Fase 1 y validarla
  en staging.

## Alternativas consideradas

- **Integración directa con WhatsApp Cloud API:** descartada para el primer
  corte porque duplica capacidades de conexión y transporte que Zernio ya
  ofrece, sin aportar valor al núcleo empresarial.
- **Usar únicamente el webhook de Zernio y enviar directamente con Meta:**
  descartada porque mantiene dos adaptadores, dos conjuntos de credenciales y
  una reconciliación innecesaria para el mismo canal.
- **Adoptar el inbox, CRM o automatizaciones de Zernio como autoridad:**
  descartada porque crearía una segunda fuente de verdad y desplazaría las
  responsabilidades aceptadas de D1, Durable Objects, Queues y Workflows.
- **Conectar cuentas desde Agent Cloudflare mediante OAuth o redirect:**
  diferida hasta que exista una necesidad de producto, un issue y contratos de
  seguridad específicos.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md)
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Contratos transversales](../architecture/contracts.md)
- [ADR-0001: Arquitectura Cloudflare-native](./ADR-0001-cloudflare-native.md)
- [ADR-0002: D1 como fuente de verdad](./ADR-0002-d1-source-of-truth.md)
- [ADR-0003: Runtime durable por conversación](./ADR-0003-conversation-agent.md)
- [Webhooks de Zernio](https://docs.zernio.com/webhooks)
- [Inbox de WhatsApp en Zernio](https://docs.zernio.com/platforms/whatsapp/inbox)
- [Envío de mensajes de inbox](https://docs.zernio.com/messages/send-inbox-message)
