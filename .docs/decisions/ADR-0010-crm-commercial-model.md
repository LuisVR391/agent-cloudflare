# ADR-0010: Modelo comercial del CRM

**Estado:** Aceptado

**Fecha:** 2026-08-12

**Aceptado:** 2026-08-14, con el corte que adopta la oportunidad
([#36](https://github.com/LuisVR391/agent-cloudflare/issues/36)). La zona
horaria de la organización entró con el corte de citas
([#38](https://github.com/LuisVR391/agent-cloudflare/issues/38)), su primer
consumidor real: `organizations.time_zone` existe desde
`0017_appointments_and_time_zone.sql` y la agenda la usa para resolver el día.
El [módulo de pipelines](../modules/pipelines.md) y el de
[citas y tareas](../modules/appointments-and-tasks.md) describen lo que existe
hoy.

## Contexto

Fase 1 dejó el recorrido conversacional completo: un mensaje se recibe, se
ordena, se responde y se conserva en D1. Lo que no existe es el proceso
comercial que la conversación debería producir. Fase 2 lo introduce y su
criterio de salida exige operar el recorrido de un contacto desde la
conversación hasta una cita.

Ese alcance atraviesa seis cortes verticales ([#33](https://github.com/LuisVR391/agent-cloudflare/issues/33)),
y varias preguntas se responden igual en todos ellos. Sin una decisión previa,
cada corte las respondería por su cuenta y el esquema físico terminaría fijando
por accidente lo que debía decidirse:

- La [guía rectora](../guia-arquitectura-producto.md) describe un pipeline
  configurable por empresa, pero también un pipeline inicial concreto para
  salón de belleza. Sin decidir, es fácil incrustar ese pipeline como un enum.
- El [modelo de dominio](../architecture/domain-model.md) separa estado
  operativo, etapa comercial y estado de cita, y prohíbe intercambiarlos. Falta
  decir qué entidad conserva la etapa comercial.
- La etapa "Servicio identificado" y cualquier cita necesitan un servicio, pero
  el conocimiento empresarial —servicios, precios, políticas, horarios— aparece
  descrito en Fase 3 junto al RAG. No está resuelto de quién es ese dato.
- Una cita ocurre a una hora local. Hoy toda marca de tiempo del producto es
  ISO 8601 UTC y `organizations` no conserva zona horaria.

## Decisión

### El pipeline es configuración de la organización

Las etapas comerciales viven en datos propios de cada organización, con orden
explícito, no en un enumerado del código ni en una columna de la conversación.
El pipeline inicial de salón de belleza descrito en la guía §16.3 se siembra de
forma idempotente para cada organización —nueva o ya instalada— y desde ahí es
editable.

### La oportunidad es lo que avanza

La **oportunidad** es la entidad que recorre el pipeline. Pertenece a un
contacto y, opcionalmente, referencia la conversación que la originó. Una
conversación no cambia de etapa: puede producir una oportunidad, ninguna o
varias a lo largo del tiempo, y sigue siendo el hilo de atención.

Cada movimiento de etapa conserva actor, etapa anterior, etapa siguiente,
momento y `correlationId`, como ya hace el historial de estado de conversación.
El movimiento usa concurrencia optimista con `expectedVersion`.

### Los tres estados permanecen separados

Se mantiene lo que fija el modelo de dominio:

| Estado | Dueño | Pregunta |
| --- | --- | --- |
| Operativo | Conversación | ¿Quién atiende y qué ocurre? |
| Comercial | Oportunidad | ¿En qué etapa de conversión está? |
| Cita | Cita | ¿Cuál es la situación de la reserva? |

Ninguna transición arrastra automáticamente a otra. Resolver una conversación
no cierra su oportunidad; confirmar una cita no mueve la etapa. Las reglas que
relacionen estos estados son automatizaciones explícitas, autorizadas e
idempotentes, y pertenecen a Fase 4.

### El catálogo de servicios es dato empresarial de D1

Los servicios que la empresa ofrece —nombre, duración, precio opcional y
estado— son dato relacional con dueño en D1, no conocimiento recuperable. Los
consumen la calificación de la oportunidad y la cita.

Esto no anticipa el conocimiento de Fase 3: los documentos, políticas y
respuestas que un agente recupera siguen siendo un índice derivado en Vectorize
sobre fuentes en R2, y podrán referirse al catálogo sin sustituirlo.

### La organización declara su zona horaria

`organizations` gana una zona horaria IANA. Las marcas de tiempo se siguen
almacenando en ISO 8601 UTC, sin excepción; la zona horaria solo determina cómo
se interpreta y se presenta un día de agenda o un periodo de métricas. Las
organizaciones existentes reciben un valor por defecto explícito en la
migración que la introduce.

## Consecuencias

### Positivas

- Un giro distinto se atiende cambiando etapas y servicios, no bifurcando el
  producto, que es lo que exigen los límites del MVP.
- El historial comercial sobrevive a la reconfiguración del pipeline: mover una
  etapa no reescribe lo que ya ocurrió.
- La separación de estados evita el defecto clásico del CRM conversacional, en
  el que cerrar un chat cancela la venta.
- Las citas y las métricas por día dejan de depender de que UTC coincida con la
  hora local de la empresa.

### Costos y obligaciones

- Hay más lecturas: mostrar una oportunidad exige resolver pipeline, etapa,
  contacto y servicio dentro de la organización.
- La siembra del pipeline inicial debe ser idempotente y cubrir organizaciones
  ya instaladas; si falla a medias, una organización queda sin etapas.
- Toda validación de etapa debe comprobar que pertenece al pipeline de la
  oportunidad y a la organización activa; una clave foránea simple no basta.
- La zona horaria es entrada no confiable: se valida contra identificadores
  IANA antes de persistirse.
- Los reportes que crucen conversación, oportunidad y cita deben unir tres
  historiales distintos, porque ninguno resume a los otros.

## Alternativas consideradas

- **Etapa comercial como columna de la conversación:** rechazada. Confunde el
  hilo de atención con el proceso de venta, impide más de una oportunidad por
  contacto y contradice la separación de estados del modelo de dominio.
- **Pipeline fijo en el código para el MVP:** rechazada. La guía y los límites
  del producto exigen configuración antes que forks; convertir el pipeline de
  salón en enum obliga a migrar datos en cuanto entre el segundo giro.
- **Campos configurables por etapa, acciones de entrada y salida y tiempos
  máximos desde ahora:** diferida a Fase 4. Sin motor de automatizaciones, esa
  configuración no tendría quién la ejecutara y sería una interfaz sin
  comportamiento.
- **Servicios como conocimiento en Vectorize:** rechazada. Un servicio se
  agenda, se cobra y se cuenta; necesita autoridad relacional y consultas
  exactas, no recuperación semántica.
- **Guardar horas locales en la cita:** rechazada. Rompe la convención de
  timestamps del repositorio y hace ambiguo cualquier orden entre registros de
  distintas organizaciones.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md), §16 y §22
- [Modelo de dominio](../architecture/domain-model.md)
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Roadmap de producto](../product/roadmap.md)
- [ADR-0002: D1 como fuente de verdad](./ADR-0002-d1-source-of-truth.md)
- [ADR-0006: Convenciones de esquema en D1](./ADR-0006-d1-schema-conventions.md)
- [ADR-0012: Métricas iniciales derivadas de D1](./ADR-0012-initial-metrics.md)
- [Issue #33](https://github.com/LuisVR391/agent-cloudflare/issues/33) y
  [#36](https://github.com/LuisVR391/agent-cloudflare/issues/36)
