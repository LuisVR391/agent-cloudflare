# Overview de arquitectura

Este documento resume los componentes que existen y los límites que gobiernan
la evolución de Agent Cloudflare. La [guía rectora](../guia-arquitectura-producto.md)
conserva la visión completa; el [README](../../README.md) distingue lo
implementado de lo planificado.

## Límites del sistema

Agent Cloudflare es dueño del CRM, la configuración empresarial, el historial
canónico, la autorización y la coordinación conversacional. Zernio conecta el
primer canal de WhatsApp y transporta mensajes y estados; no es autoridad del
inbox ni del dominio empresarial.

```text
WhatsApp
  -> Zernio
  -> POST /webhooks/zernio
  -> D1: cuenta, organización y deduplicación
  -> INBOUND_MESSAGES Queue
  -> consumidor de entrada
  -> Durable Object por conversación (pendiente)
  -> D1 / R2 / Workers AI / Workflows según su responsabilidad
  -> Queue de salida (pendiente)
  -> API de Zernio
```

## Componentes y propiedad

| Componente | Responsabilidad | No sustituye |
| --- | --- | --- |
| Worker HTTP | API, autenticación, webhook firmado y assets | Procesos largos ni estado durable |
| D1 | Datos empresariales, configuración, mapeos externos y deduplicación | Binarios ni coordinación viva |
| Durable Objects | Orden y estado vivo por conversación | Historial canónico de D1 |
| Queues | Transporte, desacoplamiento y reintentos | Confirmación de efectos empresariales |
| R2 | Medios y archivos originales | Metadatos, autorización ni CRM |
| Workers AI | Inferencia y cómputo | Datos canónicos ni permisos |
| Workflows | Procesos largos, esperas y recuperación | Resultado empresarial persistido |
| Zernio | Transporte bidireccional de WhatsApp | CRM, inbox, agentes o automatizaciones |

Vectorize se incorporará como índice derivado y reconstruible cuando exista
conocimiento empresarial. Producción permanece sin ruta ni recursos hasta una
autorización explícita.

## Límites de confianza

- El contexto autenticado resuelve usuario, organización y permisos del panel.
- El webhook de Zernio es no confiable hasta verificar HMAC-SHA256 sobre el
  cuerpo crudo, validar schema y resolver la cuenta externa desde D1.
- Los identificadores externos son opacos; no autorizan por sí mismos.
- Una Queue transporta datos ya normalizados, pero cada consumidor mantiene
  idempotencia y valida su contrato.
- Las salidas del modelo y argumentos de herramientas siguen siendo no
  confiables hasta validar permisos y reglas de negocio.

Los secretos solo existen como bindings de Cloudflare. Los logs conservan
identificadores de correlación y resultados técnicos redactados, nunca tokens,
mensajes completos ni datos personales innecesarios.

## Estado del recorrido de WhatsApp

El repositorio contiene la base del adaptador de entrada: ruta firmada,
validación, resolución de canal, recepción idempotente, Queue y manejo de
desconexiones. También existe un cliente de salida con `Idempotency-Key`, aún
sin un productor de salida ni conversación durable. Staging no está
provisionado y ningún webhook externo está activo.

El recorrido completo de Fase 1 sigue pendiente hasta incorporar persistencia
de conversaciones y mensajes, Durable Object, salida por Queue, inbox y
handoff humano.

## Referencias

- [Propiedad y ciclo de vida de los datos](./data-ownership.md)
- [Contratos transversales](./contracts.md)
- [Modelo de seguridad](./security-model.md)
- [ADR-0001: arquitectura Cloudflare-native](../decisions/ADR-0001-cloudflare-native.md)
- [ADR-0008: Zernio como adaptador](../decisions/ADR-0008-zernio-whatsapp-adapter.md)
