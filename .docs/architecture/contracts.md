# Contratos transversales

## Propósito

Estos contratos definen el vocabulario compartido entre Worker, Queues,
Durable Objects, Workflows, herramientas y persistencia. Son especificaciones
documentales; los tipos ejecutables se incorporarán junto con cada módulo.

## Convenciones

- TypeScript y mensajes internos usan `camelCase`.
- D1 usará `snake_case`; el repositorio realizará la conversión.
- Los identificadores son cadenas opacas y no se interpretan para autorizar.
- Los timestamps son cadenas ISO 8601 en UTC.
- Los contratos no transportan secretos.
- Los cambios incompatibles requieren una nueva versión o una migración.
- `organizationId` se deriva de contexto autenticado o configuración confiable,
  nunca de un valor del frontend sin validar.

## Mensaje entrante normalizado

```ts
type NormalizedInboundMessage = {
  organizationId: string;
  channelId: string;
  provider: "whatsapp";
  externalMessageId: string;
  externalContactId: string;
  messageType: "text" | "audio" | "image" | "document";
  text?: string;
  mediaUrl?: string;
  receivedAt: string;
  rawEventRef?: string;
};
```

Reglas:

- `provider: "whatsapp"` identifica el canal empresarial; Zernio es el
  adaptador y no introduce un contrato paralelo.
- `externalMessageId` identifica el mensaje externo de forma opaca.
- `channelId` ya debe estar resuelto dentro de `organizationId`.
- `mediaUrl` es una referencia temporal de entrada; después de validar y
  copiar el archivo, el dominio usará una referencia autorizada a R2.
- `rawEventRef` apunta a evidencia autorizada si la política decide
  conservarla; no contiene el payload completo.
- Para Zernio, la recepción se deduplica primero con el ID estable del webhook
  y solo después se construye este contrato. El `accountId` externo debe
  resolver canal y organización en D1; el payload no declara una organización
  confiable.
- El contrato se rechaza si el tipo no está soportado o falta un campo
  obligatorio.

## Contexto de ejecución del agente

```ts
type AgentExecutionContext = {
  organizationId: string;
  actorType: "customer" | "staff" | "system";
  actorId: string;
  role?: "owner" | "manager" | "operator";
  channelId?: string;
  conversationId?: string;
  contactId?: string;
  agentId: string;
  agentVersion: number;
  correlationId: string;
};
```

Reglas:

- El backend construye el contexto después de autenticar o resolver el canal.
- El modelo y las herramientas no pueden sobrescribirlo.
- Las referencias opcionales solo se incluyen cuando fueron verificadas dentro
  de la organización.
- `role` resume el rol operativo inicial; la autorización real consulta
  permisos y no depende únicamente de este valor.
- Toda tool recibe un contexto derivado, con el mínimo de datos necesario.

## Correlación

```ts
type CorrelationContext = {
  correlationId: string;
  causationId?: string;
};
```

`correlationId` se conserva desde la recepción hasta el resultado:

```text
webhook
  -> queue
  -> durable object
  -> agent run
  -> tool
  -> outbound
  -> provider response
```

`causationId` puede identificar el mensaje, evento o ejecución que originó un
nuevo trabajo sin sustituir el identificador de correlación.

## Idempotencia

```ts
type IdempotencyContext = {
  organizationId: string;
  scope: string;
  key: string;
  correlationId: string;
};
```

Reglas:

- Una entrega de Zernio usa como identidad lógica la combinación de adaptador
  e ID estable del evento. El mensaje normalizado conserva además la
  combinación de organización, canal y `externalMessageId` para impedir que
  dos eventos representen dos veces el mismo mensaje.
- Una acción empresarial usa una clave estable dentro de la organización y su
  `scope`, por ejemplo confirmar una cita o mover una oportunidad.
- Un reintento con la misma clave devuelve o reconstruye el resultado anterior
  sin repetir el efecto.
- La deduplicación se persiste en D1 antes de confirmar un efecto durable.
- Las claves no contienen tokens ni datos personales completos.

## Auditoría

```ts
type AuditRecord = {
  organizationId: string;
  actorType: "customer" | "staff" | "system";
  actorId: string;
  action: string;
  resourceType: string;
  resourceId?: string;
  result: "allowed" | "rejected" | "failed";
  correlationId: string;
  occurredAt: string;
};
```

Reglas:

- Se registran tanto acciones autorizadas como rechazos relevantes.
- `resourceId` se omite si todavía no existe un recurso.
- El registro describe el resultado sin copiar secretos, prompts completos,
  mensajes completos ni información personal innecesaria.
- Los detalles técnicos adicionales se almacenan de forma redactada y no
  cambian la semántica del resultado.
- Un rechazo anterior a la resolución de `organizationId` no puede producir un
  `AuditRecord` empresarial. Se emite como evento operativo redactado con
  `correlationId`; no se asigna a una organización no validada.

## Límites de confianza

| Origen | Tratamiento |
| --- | --- |
| Webhook de Zernio | No confiable hasta validar firma sobre el cuerpo crudo, estructura, plataforma y resolución del canal |
| Frontend autenticado | Identidad conocida; organización y permisos se recalculan |
| Queue o Workflow | Transporte confiable, pero el efecto sigue siendo idempotente |
| Durable Object | Coordinador confiable de su identidad; referencias empresariales se verifican |
| Modelo de IA | Salida no confiable hasta validar schema, permisos y reglas |
| Tool | Ejecuta únicamente después de autorización y validación de argumentos |

## Errores y compatibilidad

- Los errores internos comparten `correlationId`, pero no exponen detalles
  sensibles al cliente.
- Los consumidores ignoran campos adicionales compatibles.
- Eliminar o reinterpretar un campo requiere versionar el contrato.
- Un contrato inválido falla antes de ejecutar herramientas o producir efectos.
- Los adaptadores de futuros canales normalizan hacia estos contratos en lugar
  de introducir contratos paralelos.
