# Runtime durable de conversación

`CustomerSupportAgent` conserva el nombre y binding existentes por
compatibilidad. Cada conversación usa una instancia independiente:

```text
organizationId:conversationId
```

La identidad se deriva en backend después de verificar D1; nunca se acepta una
organización enviada por el frontend.

## Responsabilidades

- Serializar referencias de mensajes entrantes.
- Mantener lista pendiente, cursor procesado, debounce y modo de atención.
- Agrupar actividad usando `communication_channels.buffer_seconds`, con valor
  inicial de ocho segundos.
- Ejecutar la versión publicada del agente cuando el buffer vence.
- Difundir eventos mínimos a conexiones del inbox.

D1 conserva contactos, conversación, mensajes, estados e historial. El estado
del Durable Object es una proyección reconstruible y no contiene secretos ni
el historial completo.

## Cuándo responde el agente

Al vencer el buffer, el **último mensaje agrupado** dispara la corrida. Quién
decide si hay corrida es **D1 y no la proyección del runtime**: un Durable Object
recreado empieza con su estado inicial, y confiar en él dejaría muda una
conversación que sí responde.

Se ejecuta solo si la conversación está abierta, en modo `automatic` y con un
agente asignado que siga activo y con versión publicada. Si falta cualquiera de
esas condiciones, el cursor avanza igual y no ocurre nada más.

```text
mensaje entrante -> buffer -> corrida -> respuesta -> salida existente
                                  |
                                  +-> traza en `agent_runs`
```

## Qué recibe el modelo

Los **últimos veinte mensajes de esa conversación**, en orden cronológico: los
entrantes como turno del contacto y los salientes como turno del agente. Un
mensaje sin texto entra como marcador de lo que el contacto envió —`[el contacto
envió una imagen]`— y nunca su binario ni la referencia temporal del canal.

Nada de otra conversación, de otro contacto o de otra organización entra al
contexto. El límite de veinte es una decisión de contexto, no una verdad: una
conversación muy larga pierde su principio.

## Qué puede afirmar

Las instrucciones publicadas van primero, y el backend las envuelve en un marco
que el modelo no puede modificar: responder con un solo mensaje de WhatsApp
dentro del límite del canal, y **no afirmar servicios, precios, promociones ni
horarios que no estén escritos en esas instrucciones**, ofreciendo en su lugar
que una persona lo confirme.

Esa segunda regla existe porque el catálogo de servicios, sus precios y la agenda
tienen dueño en D1 y **ninguna herramienta los expone todavía**: preguntar por
ellos sin poder consultarlos invita a inventarlos. No es un control de seguridad
—un prompt nunca lo es, según las reglas compartidas— sino la respuesta honesta
mientras el catálogo llega por una herramienta autorizada en backend
([#56](https://github.com/LuisVR391/agent-cloudflare/issues/56)), que es donde
`services` debe entrar por ser dato relacional
([ADR-0010](../decisions/ADR-0010-crm-commercial-model.md)).

## Un mensaje que no es texto

No se contesta a ciegas. La corrida queda `skipped` con
`UNSUPPORTED_MESSAGE_CONTENT` y la conversación vuelve al equipo: alguien tiene
que mirar la imagen o escuchar el audio.

## Cuando no hay respuesta

Toda corrida que no responde —proveedor caído, salida inválida, agente sin
versión publicada, mensaje sin texto— deja traza con su código y **devuelve la
conversación a `human`**, con su entrada en `conversation_status_history` como
actor `system` y su registro en la auditoría. El silencio prolongado sin que
nadie se entere no es una opción.

Reactivar al agente vuelve a ser una decisión humana explícita.

## Un mensaje nuevo durante una corrida

El runtime marca la corrida en vuelo: un flush que la encuentra viva vuelve a
programarse en dos segundos en lugar de disparar otra. Esa bandera reduce la
ventana, pero **la garantía dura es el índice único** de `agent_runs` por mensaje
disparador: un Durable Object recreado no recuerda la bandera, y el motor sí
rechaza la segunda corrida.

## La salida es la de siempre

La respuesta se crea como mensaje saliente con remitente `system` y el
identificador del agente, y viaja por `OUTBOUND_MESSAGES` con sus estados de
entrega de Fase 1. La clave de idempotencia deriva del identificador de la
corrida, así que un reintento no produce un segundo envío. No hay camino
paralelo.

## Modos

Fase 1 permitía `human` y `paused`. Con este corte se habilita `automatic`.
`supervised` sigue reservado por el contrato aceptado: existe en el esquema desde
`0004`, pero nada prepara todavía un borrador que aprobar
([#60](https://github.com/LuisVR391/agent-cloudflare/issues/60)).

Ninguna conversación existente cambia de modo por sí sola: todas siguen en
`human` y sin agente hasta que alguien lo decida desde el inbox.
