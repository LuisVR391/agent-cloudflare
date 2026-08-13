# ADR-0012: Métricas iniciales derivadas de D1

**Estado:** Propuesto

**Fecha:** 2026-08-12

## Contexto

El criterio de salida de Fase 2 exige que el recorrido de un contacto pueda
**medirse** desde el CRM, y la guía enumera métricas operativas, comerciales y
de inteligencia artificial. El corte de métricas
([#39](https://github.com/LuisVR391/agent-cloudflare/issues/39)) cierra la fase.

La tentación natural es crear contadores: una tabla de agregados que se
actualice cuando llega un mensaje, se mueve una etapa o se confirma una cita.
Eso crea un segundo dueño para un dato que ya lo tiene, y el repositorio
prohíbe explícitamente introducir una representación autoritativa paralela sin
sustituir la decisión vigente.

El volumen actual es el de un piloto: una organización, tráfico real de un
salón, y ninguna línea base que justifique optimizar antes de medir.

## Decisión

Las métricas de Fase 2 se **derivan por consulta sobre D1**, en el momento en
que se piden. No se crean tablas de agregación, columnas contador,
proyecciones materializadas ni un almacén analítico paralelo.

Esto fija cuatro reglas:

1. **El rango es obligatorio y acotado.** Toda consulta declara inicio y fin, y
   se rechaza si falta, está invertido o excede el máximo declarado. Una
   métrica sin rango sería un escaneo completo del historial.
2. **La organización siempre filtra.** Una consulta que no puede demostrar
   organización activa falla cerrada, como cualquier otro acceso.
3. **El resultado es agregado.** Las métricas devuelven conteos, promedios y
   distribuciones; no contenido de mensajes ni datos personales de contactos.
4. **El día lo define la organización.** Los agrupamientos por día usan la zona
   horaria declarada por la organización en
   [ADR-0010](./ADR-0010-crm-commercial-model.md), sobre marcas ISO 8601 UTC.

Las métricas de inteligencia artificial —tokens, costos, modelo, herramientas y
calidad— quedan fuera de esta decisión: dependen de que exista inferencia, que
llega en Fase 3.

Cuando el volumen deje de sostener el cálculo en línea, la agregación se decide
en un ADR nuevo que sustituya a este, con evidencia de la consulta que dejó de
cumplir. No se anticipa aquí su forma.

## Consecuencias

### Positivas

- Cada dato conserva un solo dueño: la métrica es una lectura del historial, no
  una copia que pueda desincronizarse.
- No hay backfill ni recomputación cuando cambia la definición de una métrica;
  se cambia la consulta.
- Un dato corregido —una entrega reconciliada, una cita reprogramada— se
  refleja sin reparar contadores.
- Los índices que la fase ya necesita para listar por organización y fecha
  sirven también para agregar.

### Costos y obligaciones

- El costo de la consulta crece con el historial. El rango máximo es el control,
  y debe declararse explícitamente en vez de dejarse al cliente.
- Los índices por organización y fecha dejan de ser opcionales: sin ellos, cada
  métrica recorre la tabla.
- El tiempo de primera respuesta exige correlacionar entrada y salida dentro de
  la conversación; es la consulta más cara de la fase y debe probarse con datos.
- No habrá series históricas precalculadas: comparar periodos largos será
  trabajo posterior, no un efecto secundario gratuito.
- Esta decisión tiene fecha de caducidad implícita y debe revisarse con datos
  reales del piloto, no por intuición.

## Alternativas consideradas

- **Tabla de agregados actualizada en escritura:** rechazada. Duplica la
  autoridad del dato, obliga a idempotencia adicional en cada efecto y produce
  cifras que divergen en silencio cuando un reintento falla a medias.
- **Analytics Engine u otro almacén de series:** rechazada por ahora. Añade un
  binding y un recurso por entorno para un volumen que D1 sostiene, y las
  métricas comerciales exigen unir entidades relacionales que ese almacén no
  conserva.
- **Cálculo en el cliente sobre listados paginados:** rechazada. Obligaría a
  exponer historial completo para contar, contradiciendo el mínimo privilegio.
- **Métricas sin límite de rango:** rechazada. Convierte cualquier panel en un
  escaneo de tabla y no falla de forma predecible.
- **Incluir ya las métricas de inteligencia artificial:** rechazada por
  dependencia: no hay inferencia que medir hasta Fase 3.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md), §22
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [ADR-0002: D1 como fuente de verdad](./ADR-0002-d1-source-of-truth.md)
- [ADR-0006: Convenciones de esquema en D1](./ADR-0006-d1-schema-conventions.md)
- [ADR-0010: Modelo comercial del CRM](./ADR-0010-crm-commercial-model.md)
- [Issue #33](https://github.com/LuisVR391/agent-cloudflare/issues/33) y
  [#39](https://github.com/LuisVR391/agent-cloudflare/issues/39)
