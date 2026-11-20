# ADR-0018: Separar la ejecución del agente de la publicación del CRM

**Estado:** Aceptado

**Fecha:** 2026-11-20

**Adoptada por:** [#72](https://github.com/LuisVR391/agent-cloudflare/issues/72).

## Contexto

[ADR-0015](./ADR-0015-model-provider-and-agent-runs.md) integra la corrida
automática con la conversación y su salida existente. La implementación
reunía elegibilidad, inferencia, envío y handoff en la misma operación.
Eso hacía difícil impedir que una candidata pendiente se publicara después
de que alguien tomara control o cambiara la asignación.

## Decisión

El CRM obtiene el contexto autorizado y decide si solicita una corrida.
El arnés resuelve la versión publicada, ejecuta el modelo y las herramientas
permitidas y devuelve una candidata validada, una omisión o un fallo. La
candidata vive en memoria durante el flujo. El CRM decide si persiste un
saliente, lo encola o devuelve la atención al equipo.

El CRM comprueba en D1 que la decisión de atención siga vigente en la misma
operación que acepta el saliente. Cambiar modo, estado o asignación invalida
una candidata pendiente. Recibir un nuevo mensaje conserva el efecto del
buffer. Si la atención cambió, la corrida queda con `ATTENTION_CHANGED` y
se mantiene la decisión del operador.

D1 conserva la unicidad de la corrida por organización y disparador. La
clave de salida automática deriva del `runId`. `succeeded` registra que
la cola aceptó el trabajo. El CRM conserva los estados de envío, entrega y
lectura. Al reintentar un webhook, la cola de entrada usa el `correlationId`
del recibo persistido.

La frontera es interna al Worker actual. D1 conserva las fuentes de verdad y
el esquema. La definición de APIs entre Workers y de recursos para Dialow
pertenece a los cortes de extracción.

## Consecuencias

Una decisión humana vigente puede impedir la publicación de una candidata
ya generada. La identificación de la corrida, el código de fallo y la
correlación permiten explicar ese resultado sin guardar otra copia del
contenido. El contrato conserva la atribución a la versión publicada y el
transporte de [ADR-0008](./ADR-0008-zernio-whatsapp-adapter.md).

Una interrupción entre D1 y Queue puede dejar una corrida `running`. Al
repetir el disparador se conserva la corrida original. El procedimiento de
recuperación exige conciliar el estado del mensaje y de la entrega con la cola
y el canal antes de repetir una operación.

## Alternativas consideradas

- Mantener los efectos del CRM dentro del ejecutor. Se descartó porque la
  decisión de atención y la publicación seguirían acopladas a la inferencia.
- Introducir otra cola o una tabla de candidatas. Se descartó para este
  corte porque requiere otro contrato de recuperación y retención. El modo
  supervisado se tratará en [#60](https://github.com/LuisVR391/agent-cloudflare/issues/60).

## Referencias

- [Runtime durable por conversación](./ADR-0003-conversation-agent.md)
- [Contrato de herramienta y autorización](./ADR-0017-agent-tool-contract.md)
- [Runtime de conversación](../modules/conversation-runtime.md)
- [Entornos y recuperación](../operations/environments.md)
