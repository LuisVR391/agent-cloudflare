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
- Difundir eventos mínimos a conexiones del inbox.

D1 conserva contactos, conversación, mensajes, estados e historial. El estado
del Durable Object es una proyección reconstruible y no contiene secretos ni
el historial completo.

Fase 1 permite operación `human` y `paused`. Los modos `automatic` y
`supervised` están reservados por el contrato aceptado, pero no se habilitan
en la interfaz hasta implementar agentes.
