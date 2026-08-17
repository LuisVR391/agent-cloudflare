# ADR-0014: Agente configurable y versión publicable inmutable

**Estado:** Aceptado

**Fecha:** 2026-08-16

**Adoptada por:** el corte de agentes y versiones
([#54](https://github.com/LuisVR391/agent-cloudflare/issues/54)), primer
entregable de Fase 3, que crea `agents`, `agent_versions` y su historial de
publicación sin ejecutar nada. El detalle operativo está en el
[módulo de agentes y versiones](../modules/agents-and-versions.md).

## Contexto

Hasta este corte no existía la noción de agente: ni tabla, ni columna, ni
código. El runtime durable por conversación
([ADR-0003](./ADR-0003-conversation-agent.md)) declara entre sus
responsabilidades «cargar la versión autorizada del agente», pero no había nada
que cargar.

Sin configuración por organización, cualquier respuesta automática sería
comportamiento incrustado en código, idéntico para todas las empresas y opaco
cuando cambiara. Y sin versiones no se puede responder la pregunta que la Fase 3
entera necesita: **¿con qué configuración se respondió esta conversación?**

La Fase 3 enumera esa decisión como la primera que debía tomarse —qué queda
congelado, qué se edita sin publicar, cómo se activa una versión y si revertir
publica una versión nueva o reactiva una anterior— sin resolverla.

Este corte tampoco ejecuta: llamar a un modelo, recuperar conocimiento, ejecutar
herramientas y enrutar son cortes posteriores. La decisión debe sostener esos
cortes sin anticipar sus esquemas.

## Decisión

El **agente** es configuración reutilizable con dueño en D1. La **versión** es
una revisión inmutable de esa configuración. Publicar no reescribe lo ocurrido.

Esto fija diez reglas:

1. **Qué congela una publicación.** La versión conserva instrucciones, modelo
   previsto, herramientas declaradas, alcance de conocimiento y playbook. El
   nombre, el propósito y el estado del agente se editan sin crear una versión
   nueva, porque no describen comportamiento.
2. **Una versión no regresa a borrador.** El ciclo es `draft → published →
   archived`, y `archived → published` al revertir. Como el retorno a borrador no
   existe, `status <> 'draft'` significa exactamente «contenido congelado», y no
   hace falta una segunda columna que repita ese hecho.
3. **A lo sumo una versión publicada por agente**, garantizado por un índice
   único parcial en el motor y no por el repositorio: una segunda ruta de
   escritura no puede saltarse un índice. Como SQLite valida la unicidad
   sentencia a sentencia, el lote que publica archiva primero la versión vigente.
4. **Revertir es reactivar la versión anterior**, no publicar una copia derivada.
   El contenido es inmutable y lo único que cambia es cuál está publicada.
5. **Un solo escritor de la publicación**, con la etiqueta derivada en el
   servidor. `published`, `unpublished` y `rolled_back` se deducen comparando los
   ordinales de las versiones implicadas, de modo que quien llama no puede
   registrar un descenso de versión como una publicación.
6. **El historial de publicación es append-only y es el único dueño** de cuándo
   se publicó cada versión. Su motivo es obligatorio, porque el criterio de
   salida exige que conserve el porqué de cada cambio. Es distinto del motivo de
   una revisión, que explica por qué su contenido difiere del anterior.
7. **Un solo punto de concurrencia optimista.** `agents.version` cubre el agente,
   sus versiones y sus declaraciones, como `pipelines.version` en
   [ADR-0010](./ADR-0010-crm-commercial-model.md). El ordinal de una revisión,
   `version_number`, no es un contador de escrituras.
8. **Ningún permiso nuevo.** `agents.read` consulta y `agents.manage` crea,
   edita, publica, desactiva y revierte. `agents.manage` ya es el privilegio que
   decide qué comportamiento tiene la empresa, así que separar la publicación no
   protegería nada que ese permiso no conceda ya. `operator` no recibe ninguno de
   los dos: atender una conversación no es configurar quién la atiende.
9. **Las herramientas y el alcance de conocimiento son declaraciones sin
   catálogo.** No autorizan nada ni se validan contra un conjunto cerrado, porque
   ese conjunto todavía no existe; el backend valida su forma. El catálogo de
   herramientas y la validación referencial llegan con sus propios cortes. Se
   guardan en tablas hijas y no en una columna JSON: el esquema no tiene ninguna,
   un arreglo JSON no impide un elemento repetido, y la consulta que la
   autorización de herramientas necesitará —qué versiones declaran una
   herramienta— sería un recorrido de tabla.
10. **El modelo es un identificador opaco** del modelo previsto, sin `CHECK` ni
    catálogo. Qué contrato aísla el runtime del proveedor de inferencia se decide
    en el corte de ejecución, y fijar aquí una lista anticiparía esa decisión.
    Ninguna credencial se almacena: los secretos pertenecen a Cloudflare Secrets.

Una organización recién instalada **no recibe ningún agente sembrado**. A
diferencia del pipeline inicial, un agente sembrado traería instrucciones y un
modelo que nada ejecuta, anunciando una capacidad que no existe, y obligaría a
una siembra retroactiva por organización que no protege nada.

**Ninguna conversación cambia de comportamiento.** Nada lee todavía la versión
publicada.

### Diferido explícitamente

- El agente predeterminado del canal (`channels.default_agent_id`) se decide en
  el corte de routing. Nada lo consumiría hoy.
- La asignación de una versión a una conversación se decide en el corte de
  ejecución, que es su primer consumidor.
- Qué significa para el enrutamiento archivar un agente con versión publicada:
  hoy no despublica, porque nadie la lee.
- Comparar dos versiones con evidencia, evaluarlas antes de publicar y proponer
  cambios son Fase 5.

## Consecuencias

### Positivas

- La pregunta «con qué configuración se respondió» tiene una respuesta
  identificable y estable desde antes de que exista ejecución.
- La inmutabilidad es estructural: el repositorio rechaza editar lo publicado y
  el motor rechaza dos versiones publicadas a la vez.
- Revertir es barato y no ensucia la numeración: el ordinal sigue identificando
  una configuración única.
- El historial conserva autor, momento y motivo sin duplicar contenido.
- Los cortes posteriores heredan `agentId` y `agentVersion` ya poblados, tal como
  los fijan los [contratos transversales](../architecture/contracts.md).

### Costos y obligaciones

- El orden del lote que publica es una obligación operativa, no un detalle:
  archivar va antes de publicar o el lote entero falla.
- Un solo punto de versión implica que dos personas editando dos borradores
  distintos del mismo agente entran en conflicto. Es el mismo costo que ya aceptó
  el pipeline, y en la práctica un agente tiene un borrador a la vez.
- `archived` debe seguir significando siempre «fue publicada y ya no lo está».
  Por eso un borrador no se archiva; si algún corte necesita descartarlo, lo
  borra.
- Las etiquetas de herramientas y conocimiento quedarán sin validación
  referencial hasta sus cortes, y estos deberán reconciliar lo ya declarado.
- El panel debe decir explícitamente que publicar todavía no cambia ninguna
  conversación, o presentaría como disponible una capacidad planificada.

## Alternativas consideradas

- **Revertir publicando una versión nueva con el contenido anterior:** rechazada.
  Duplica contenido y rompe la correspondencia entre el ordinal y una
  configuración única, de modo que dos ordinales distintos describirían lo mismo.
- **Tres endpoints separados para publicar, desactivar y revertir:** rechazada.
  Serían tres escritores de una sola celda de estado, y el cliente podría
  etiquetar mal la transición que provoca.
- **Un permiso `agents.publish` propio:** rechazada. `agents.read` y
  `agents.manage` ya distinguen consultar de gestionar, que es lo que el corte
  exige, y un tercer permiso obligaría a una migración de catálogo para separar
  privilegios que el mismo rol ya reúne.
- **Herramientas y alcance como columnas JSON:** rechazada. Ninguna migración
  usa JSON, un arreglo no valida sus elementos ni impide duplicados, y convierte
  en escaneo la consulta inversa que el corte de herramientas necesitará.
- **Guardar el instante de la primera publicación en la versión:** rechazada. Ese
  dato ya tiene dueño en el historial, y una segunda copia divergiría en cuanto
  una escritura fallara a medias.
- **Sembrar un agente inicial, como se siembra el pipeline:** rechazada. Un
  agente sin ejecución sugiere una capacidad inexistente y exige decidir
  instrucciones por defecto sin ningún consumidor que las valide.
- **Permitir varias versiones publicadas y resolver por prioridad:** rechazada.
  Convierte «con qué configuración se respondió» en una pregunta ambigua justo
  donde la fase necesita una respuesta única.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md), §10 y §20
- [Modelo de dominio](../architecture/domain-model.md)
- [Contratos transversales](../architecture/contracts.md)
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [ADR-0002: D1 como fuente de verdad](./ADR-0002-d1-source-of-truth.md)
- [ADR-0003: Runtime durable por conversación](./ADR-0003-conversation-agent.md)
- [ADR-0006: Convenciones de esquema en D1](./ADR-0006-d1-schema-conventions.md)
- [ADR-0010: Modelo comercial del CRM](./ADR-0010-crm-commercial-model.md)
- [Issue #53](https://github.com/LuisVR391/agent-cloudflare/issues/53) y
  [#54](https://github.com/LuisVR391/agent-cloudflare/issues/54)
