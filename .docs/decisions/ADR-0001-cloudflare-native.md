# ADR-0001: Arquitectura Cloudflare-native

**Estado:** Aceptado

**Fecha:** 2026-07-30

## Contexto

Agent Cloudflare necesita recibir webhooks, servir una aplicación web,
coordinar conversaciones, persistir datos empresariales, procesar tareas
asíncronas y ejecutar automatizaciones e inferencia. La primera edición debe
mantener un núcleo común y desplegable para distintas empresas sin crear forks.

Distribuir estas responsabilidades sin una regla explícita produciría acceso
directo a APIs de infraestructura, credenciales duplicadas y servicios que
compiten por el mismo estado.

## Decisión

La arquitectura objetivo usará servicios administrados de Cloudflare mediante
bindings tipados:

- Workers será la entrada HTTP, API, webhook y entrega de assets.
- Agents SDK y Durable Objects coordinarán el estado vivo por conversación.
- D1 conservará los datos empresariales y relacionales canónicos.
- Queues desacoplará transporte, reintentos y procesamiento asíncrono.
- Workflows ejecutará procesos largos, esperas y recuperación.
- R2 conservará archivos, medios y documentos originales.
- Vectorize mantendrá índices semánticos derivados y reconstruibles.
- Workers AI u otros proveedores autorizados realizarán inferencia, no
  persistencia empresarial.
- Cloudflare Secrets custodiará credenciales.

Los servicios se consumirán mediante bindings declarados y separados por
entorno. No se llamará a la API administrativa de Cloudflare desde el runtime
para sustituir un binding disponible.

El producto conservará un solo núcleo. Las diferencias por empresa o giro se
resolverán mediante configuración y paquetes empresariales.

## Consecuencias

### Positivas

- Las responsabilidades y límites de confianza quedan explícitos.
- Los bindings evitan distribuir credenciales administrativas en el runtime.
- Los servicios pueden probarse localmente con una topología cercana a
  producción.
- El núcleo puede evolucionar sin bifurcar el producto por cliente.

### Costos y obligaciones

- El sistema depende de semánticas, límites y herramientas de Cloudflare.
- Cada entorno necesita bindings, recursos y secretos aislados.
- Las interacciones entre servicios requieren correlación, idempotencia y
  observabilidad.
- Una capacidad no puede anunciarse hasta tener ruta completa desde el binding
  hasta permisos, ejecución, persistencia y pruebas.
- Adoptar un servicio nuevo requiere justificar su responsabilidad y registrar
  otro ADR cuando cambie esta arquitectura.

## Alternativas consideradas

- **Infraestructura independiente para cada capacidad:** rechazada para el MVP
  porque aumenta operación, credenciales y puntos de fallo antes de validar el
  producto.
- **Un Durable Object o Worker como almacén de todo el sistema:** rechazado
  porque mezcla coordinación efímera con datos empresariales consultables.
- **Un fork por empresa o giro:** rechazado porque fragmenta el núcleo y hace
  incompatibles las mejoras.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md)
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Bindings de Workers](https://developers.cloudflare.com/workers/runtime-apis/bindings/)
- [Opciones de almacenamiento de Workers](https://developers.cloudflare.com/workers/platform/storage-options/)
