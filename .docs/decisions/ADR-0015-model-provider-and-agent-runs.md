# ADR-0015: Capa común de proveedor y traza de la corrida del agente

**Estado:** Aceptado

**Fecha:** 2026-08-18

**Adoptada por:** el corte de ejecución en la conversación
([#55](https://github.com/LuisVR391/agent-cloudflare/issues/55)), segundo
entregable de Fase 3, que hace responder a la versión publicada del agente y
registra cada corrida. El detalle operativo está en el
[módulo de proveedores de modelo](../modules/model-providers.md) y en el
[runtime de conversación](../modules/conversation-runtime.md).

## Contexto

Después de [ADR-0014](./ADR-0014-configurable-agents-and-published-versions.md)
hay configuración de agentes y versiones publicables, pero **nadie la lee**. El
runtime durable agrupa los mensajes del buffer, avanza su cursor y los deja
esperando: la única salida posible es que una persona escriba desde el inbox.

El binding `AI` está declarado en los tres entornos desde la Fase 0 y no se
consume en ninguna parte. Ninguna llamada a un modelo existe todavía en el
producto.

La Fase 3 dejó abiertas cuatro preguntas que este corte no puede esquivar: qué
contrato aísla el runtime del proveedor, qué forma tiene la evidencia de una
corrida, cómo se activa la respuesta sin que ninguna organización cambie de
comportamiento por sorpresa, y qué ocurre cuando el modelo falla. Si la traza
nace incompleta, los cortes de herramientas, conocimiento y costo no tendrán
dónde colgarse.

## Decisión

La ejecución vive en el runtime durable, el modelo se consume detrás de una capa
común y cada corrida deja traza en D1. Esto fija siete reglas:

1. **Un contrato propio entre el runtime y el proveedor.** El runtime pide
   `{ model, instructions, turns, maxOutputTokens }` y recibe `{ text }`. No
   conoce ningún proveedor concreto, ni sus formatos, ni sus credenciales. Es el
   punto donde el corte de presupuesto y failover
   ([#61](https://github.com/LuisVR391/agent-cloudflare/issues/61)) podrá medir y
   conmutar sin reescribir la conversación.
2. **Workers AI es el primer proveedor.** Su binding ya existe en los tres
   entornos, no exige credencial, recurso ni autorización nuevos, y
   `agent_versions.model` sigue siendo el identificador opaco que ADR-0014
   decidió. El binding tipa su catálogo cerrado de modelos; como el identificador
   lo escribe la empresa, se consume por una vista estructural y un modelo
   desconocido se clasifica como proveedor no disponible.
3. **La salida se valida antes de existir como mensaje.** Un texto vacío o más
   largo de lo que el canal acepta no se recorta ni se degrada: falla cerrado. Un
   mensaje truncado hacia una clienta es peor que ninguno.
4. **La conversación responde sola solo si alguien lo decidió, y con qué agente.**
   `conversations.agent_id` guarda quién la atiende y el modo `automatic` decide
   si responde. Activarlo exige un agente activo con versión publicada, y la
   comprobación viaja en la misma sentencia que escribe. Ninguna conversación
   existente se mueve: todas siguen en `human` con `agent_id` nulo.
5. **Una corrida por mensaje disparador, garantizado por el motor.** El índice
   único `(organization_id, trigger_message_id)` de `agent_runs` es lo que impide
   dos respuestas al mismo mensaje. La bandera del runtime reduce la ventana; no
   la cierra, porque un Durable Object recreado empieza sin ella.
6. **Toda corrida que no responde devuelve la conversación al equipo.** Da igual
   el motivo —proveedor caído, salida inválida, agente sin versión publicada o un
   mensaje que no es texto—: queda traza con su código y la conversación pasa a
   `human` con historial y auditoría. El silencio prolongado sin que nadie se
   entere no es una opción para un salón.
7. **La traza es evidencia, no una copia del contenido.** `agent_runs` conserva
   agente, versión, disparador, respuesta, resultado, código de fallo,
   correlación e instantes. No conserva el prompt, el texto del mensaje, la
   respuesta ni el cuerpo del proveedor. El modelo se deriva de la versión, que
   es inmutable.

La respuesta viaja por la **salida ya existente** de Fase 1, con su clave de
idempotencia derivada del identificador de la corrida y sus estados de entrega.
No se abre un camino paralelo de envío.

El contexto que recibe el modelo son los **últimos veinte mensajes de esa
conversación**, con los mensajes sin texto representados por un marcador de lo
que el contacto envió. Ningún dato de otra conversación, de otro contacto o de
otra organización entra, y ninguna referencia a un binario sale hacia el
proveedor.

### Diferido explícitamente

- El agente predeterminado del canal y la delegación entre agentes siguen siendo
  el corte de routing ([#58](https://github.com/LuisVR391/agent-cloudflare/issues/58)),
  que reutilizará `conversations.agent_id`.
- `supervised` sigue reservado. La aprobación previa al envío es
  [#60](https://github.com/LuisVR391/agent-cloudflare/issues/60).
- Tokens, costo, límite de gasto y failover son
  [#61](https://github.com/LuisVR391/agent-cloudflare/issues/61). La columna del
  modelo que efectivamente respondió nace ahí, que es cuando puede diferir del
  previsto.
- Herramientas anunciadas al modelo y conocimiento recuperable son #56 y #57. La
  corrida de este corte no anuncia ninguna herramienta.

## Consecuencias

### Positivas

- La pregunta «con qué configuración se respondió esta conversación» tiene por
  fin una respuesta ejecutada y verificable, no solo configurada.
- Cambiar de modelo o de proveedor no toca el runtime ni la conversación.
- Una corrida sin respuesta es visible en el inbox, porque la conversación vuelve
  al equipo en vez de quedarse callada.
- Los cortes siguientes heredan una traza con correlación y versión donde colgar
  herramientas, conocimiento y costo.

### Costos y obligaciones

- Cada mensaje que responde el agente gasta dinero, y este corte todavía no lo
  mide. Es exactamente el hueco que #61 debe cerrar.
- El límite de veinte mensajes es una decisión de contexto, no una verdad: una
  conversación larga pierde su principio, y ajustarlo exigirá evidencia.
- Un mensaje que no es texto siempre escala a una persona. Si el volumen de
  audios lo vuelve costoso, la transcripción tendrá que decidirse aparte.
- La bandera del runtime y el índice único describen la misma invariante en dos
  lugares. El índice es el que manda; la bandera solo evita trabajo perdido.
- Un fallo del proveedor cambia el modo de la conversación, así que reactivar el
  agente es una acción humana explícita.

## Alternativas consideradas

- **Llamar al binding de inferencia desde el runtime:** rechazada. Ataría la
  conversación al formato de un proveedor y obligaría a reescribir el runtime en
  el corte de failover, que es justo lo que la fase quiere evitar.
- **Un proveedor HTTP con credencial propia desde el primer corte:** rechazada
  por ahora. Introduce un secreto en tres entornos y gasto externo antes de que
  exista una sola corrida verificada; la capa común permite adoptarlo después sin
  tocar la conversación.
- **Guardar la traza en el Durable Object:** rechazada. La corrida es un hecho
  empresarial consultable y auditable, y el estado del runtime es una proyección
  reconstruible (ADR-0003).
- **Copiar el modelo y la duración en `agent_runs`:** rechazada. La versión es
  inmutable, así que el modelo previsto ya tiene dueño, y la duración se deriva de
  dos instantes que la traza sí conserva.
- **Resolver el agente por «el único publicado de la organización»:** rechazada.
  El comportamiento dependería de cuántos agentes existan y la conversación no
  explicaría quién la atiende.
- **Decidir el agente en el canal desde ya:** rechazada. Es la decisión que #58
  reserva, y anticiparla fijaría el routing sin sus reglas.
- **Quedarse callado y reintentar en el siguiente mensaje cuando el modelo
  falla:** rechazada. Un proveedor caído produciría silencio hasta que alguien
  mirara la traza, y la clienta ya se habría ido.
- **Responder a un audio o una imagen con una disculpa automática:** rechazada.
  El agente no sabe qué contienen, y una respuesta genérica es peor que llevar la
  conversación a quien puede mirarla.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md), §10 y §20
- [Contratos transversales](../architecture/contracts.md)
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Ciclo de vida de mensajes](../architecture/message-lifecycle.md)
- [ADR-0002: D1 como fuente de verdad](./ADR-0002-d1-source-of-truth.md)
- [ADR-0003: Runtime durable por conversación](./ADR-0003-conversation-agent.md)
- [ADR-0014: Agente configurable y versión publicable inmutable](./ADR-0014-configurable-agents-and-published-versions.md)
- [Issue #53](https://github.com/LuisVR391/agent-cloudflare/issues/53) y
  [#55](https://github.com/LuisVR391/agent-cloudflare/issues/55)
