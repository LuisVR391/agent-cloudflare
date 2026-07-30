# ADR-0003: Runtime durable por conversación

**Estado:** Aceptado

**Fecha:** 2026-07-30

## Contexto

Los mensajes de una conversación pueden llegar juntos, repetidos o fuera del
ritmo de procesamiento. La respuesta automática y el handoff humano necesitan
orden, exclusión mutua, buffer, debounce y conexiones en tiempo real sin
concentrar todas las empresas en un coordinador global.

D1 conserva el historial y la configuración canónicos, pero no reemplaza un
actor con identidad estable que serialice el trabajo vivo de cada conversación.

## Decisión

Cada conversación activa tendrá un Durable Object identificado por:

```text
organizationId:conversationId
```

Ese runtime será responsable de:

- Ordenar y agrupar mensajes pendientes.
- Evitar respuestas concurrentes.
- Mantener buffer, debounce, cursor y alarmas cercanas.
- Coordinar el modo IA, supervisado o humano.
- Mantener conexiones en tiempo real asociadas a la conversación.
- Cargar la versión autorizada del agente y ejecutar herramientas permitidas.

El runtime puede conservar proyecciones de contacto, agente asignado, versión y
modo de atención para reducir latencia. D1 seguirá siendo la fuente canónica y
permitirá reconstruir esas proyecciones.

La identidad se resolverá en backend después de validar organización, canal y
conversación. No habrá un Durable Object único para todas las empresas ni para
todo el inbox.

## Consecuencias

### Positivas

- Cada conversación tiene un punto de serialización y coordinación.
- El aislamiento forma parte de la identidad del runtime.
- Buffer, handoff y conexiones en tiempo real comparten el mismo límite.
- Una falla de una conversación no requiere coordinar el estado de todas.

### Costos y obligaciones

- Los mensajes y resultados empresariales deben persistirse en D1.
- Todo reintento conserva correlación y claves de idempotencia.
- El runtime debe poder reconstruirse si pierde una proyección.
- Las referencias a contacto, agente y herramientas se revalidan dentro de la
  organización.
- Las migraciones de la clase Durable Object serán aditivas y nunca se
  reescribirán después de aplicarse.
- La estrategia concreta de buffer y alarmas se definirá en la Fase 1.

## Alternativas consideradas

- **Procesamiento exclusivo en handlers de Worker:** rechazado porque la
  memoria efímera no coordina orden ni concurrencia entre solicitudes.
- **Una cola como estado de conversación:** rechazada porque una cola
  transporta trabajos, pero no representa el actor ni el estado vivo.
- **Un Durable Object global:** rechazado por contención, riesgo de cruce entre
  empresas y un dominio de fallo innecesariamente amplio.
- **D1 como mecanismo único de coordinación:** rechazado porque mezcla el
  registro canónico con el actor de baja latencia por conversación.

## Referencias

- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Contratos transversales](../architecture/contracts.md)
- [Durable Objects](https://developers.cloudflare.com/durable-objects/)
- [Storage de Durable Objects](https://developers.cloudflare.com/durable-objects/api/sqlite-storage-api/)
