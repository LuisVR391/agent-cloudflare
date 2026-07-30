# ADR-0002: D1 como fuente de verdad empresarial

**Estado:** Aceptado

**Fecha:** 2026-07-30

## Contexto

El CRM necesita una representación durable y consultable de organizaciones,
usuarios, permisos, contactos, conversaciones, mensajes, agentes, pipelines,
citas, automatizaciones y auditoría. Otros servicios de la arquitectura
conservan estado coordinado, contenido binario, transporte o índices, pero no
deben competir por la autoridad de esos datos.

Sin una fuente canónica, los reintentos y fallos parciales podrían producir
estados empresariales contradictorios que el panel no podría reconciliar.

## Decisión

D1 será la fuente de verdad de la configuración y los datos empresariales y
relacionales.

- Toda fila empresarial estará preparada para aislamiento por
  `organization_id`.
- La organización se derivará de contexto autenticado o configuración
  confiable, no de un identificador sin validar enviado por el frontend.
- El código accederá a D1 mediante límites de dominio o repositorios; no habrá
  SQL disperso en handlers, agentes o componentes de interfaz.
- Los cambios de esquema se harán con migraciones nuevas, versionadas y
  aplicables desde una base vacía.
- La deduplicación se persistirá antes de confirmar efectos empresariales
  reintentables.
- D1 guardará referencias opacas y metadatos de credenciales, nunca secretos.

Durable Objects podrá conservar proyecciones reconstruibles para coordinar una
conversación. R2 mantendrá contenido binario; Vectorize, índices derivados;
Queues, trabajos en tránsito; y Workflows, progreso técnico. Ninguno sustituye
el registro canónico de D1 para un resultado empresarial.

## Consecuencias

### Positivas

- El panel, las automatizaciones y la auditoría consultan una autoridad común.
- Las proyecciones pueden descartarse y reconstruirse.
- Las discrepancias tienen una regla explícita de reconciliación.
- Las migraciones permiten reproducir y revisar la evolución del esquema.

### Costos y obligaciones

- Los flujos distribuidos deben persistir el resultado en D1 y manejar fallos
  parciales con idempotencia.
- Las consultas deben incluir aislamiento por organización y pruebas de acceso
  cruzado.
- Los cambios incompatibles requieren migración o compatibilidad explícita.
- No se pueden editar ni borrar migraciones que hayan podido aplicarse.
- El diseño físico y los índices se validarán con cada capacidad; este ADR no
  anticipa todo el esquema del CRM.

## Alternativas consideradas

- **Durable Objects como base empresarial completa:** rechazada porque su
  responsabilidad es coordinación por identidad y no una vista relacional
  común de todo el negocio.
- **R2 o Vectorize como registro canónico:** rechazadas porque conservan
  contenido binario o índices derivados, no integridad relacional empresarial.
- **Una base distinta por módulo desde el inicio:** rechazada porque crea
  múltiples autoridades antes de que el dominio lo requiera.

## Referencias

- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Modelo de dominio](../architecture/domain-model.md)
- [D1](https://developers.cloudflare.com/d1/)
- [Migraciones de D1](https://developers.cloudflare.com/d1/reference/migrations/)
- [D1 y almacenamiento de Durable Objects](https://developers.cloudflare.com/durable-objects/best-practices/access-durable-objects-storage/)
