# Visión de producto de Agent Cloudflare

> **Estado:** vigente al fusionarse este documento en `main`.
>
> Esta visión especializada resume para quién se construye el producto, qué
> problema resuelve y cómo se reconocerá el éxito del MVP. La
> [guía de arquitectura y producto](../guia-arquitectura-producto.md) conserva
> la visión amplia y los límites técnicos; el
> [roadmap](./roadmap.md) conserva el estado verificable de ejecución.

## Audiencia inicial

La primera edición está dirigida a salones de belleza pequeños y medianos que
atienden prospectos y clientes por WhatsApp y necesitan coordinar atención,
ventas, citas y seguimiento desde una sola operación.

Dentro de cada empresa, el producto debe servir a:

- Propietarios y responsables que configuran la organización y supervisan
  resultados.
- Gerentes que coordinan atención, oportunidades y agenda.
- Operadores que consultan conversaciones, intervienen y dan seguimiento.
- Clientes y prospectos que esperan una respuesta coherente y continua por
  WhatsApp.

La organización es siempre el límite de datos, permisos y auditoría. Una
persona puede participar en más de una organización, pero ninguna sesión,
conversación o automatización puede cruzar información entre ellas.

## Problema prioritario

La atención comercial de un salón suele quedar fragmentada entre chats,
agendas y seguimientos manuales. Esto provoca respuestas inconsistentes,
oportunidades sin seguimiento, citas perdidas y poca visibilidad sobre el
recorrido completo del cliente.

Agent Cloudflare debe convertir la conversación en un proceso operable sin
obligar a la empresa a administrar herramientas técnicas separadas ni a confiar
en una automatización sin supervisión.

## Propuesta de valor

El producto reúne en una sola interfaz el canal, la conversación, el contexto
del contacto, el proceso comercial, la agenda y la supervisión de agentes. La
automatización debe ayudar a responder y dar continuidad, mientras que las
decisiones sensibles permanecen autorizadas, trazables y reversibles.

El núcleo es común para todas las empresas. Las particularidades del salón se
representan mediante configuración y, después del MVP, paquetes por giro; no
mediante forks del producto.

## Recorrido que valida el MVP

El primer recorrido empresarial que debe comprobarse de extremo a extremo es:

```text
Mensaje por WhatsApp
  -> atención
  -> identificación del servicio
  -> calificación
  -> propuesta de cita
  -> cita
  -> seguimiento
  -> recordatorio de retoque
```

El recorrido debe conservar contexto, organización, permisos, correlación y
estado empresarial aunque intervengan procesos asíncronos o una persona tome
el control de la conversación.

## Alcance del MVP

El MVP incluye las capacidades mínimas para:

1. Conectar WhatsApp Cloud API y procesar mensajes con validación, deduplicación
   y entrega durable.
2. Consultar conversaciones y contactos desde un inbox e intervenir como
   persona autorizada.
3. Gestionar el avance de un prospecto, tareas y citas desde el CRM.
4. Configurar agentes, conocimiento y herramientas con autorización en
   backend y aislamiento por organización.
5. Ejecutar seguimientos recuperables y observar sus resultados empresariales.
6. Evaluar una mejora, obtener aprobación humana, publicar una versión y
   revertirla.

Las fases y dependencias que materializan estas capacidades se mantienen en el
[roadmap](./roadmap.md). Una capacidad de esta lista no está implementada por
aparecer en este documento; requiere evidencia fusionada en `main`.

## Fuera de alcance del MVP

Quedan fuera de la primera edición:

- Contabilidad, nómina, punto de venta completo e inventario avanzado.
- Administración integral de campañas publicitarias.
- Marketplace de agentes y fine-tuning automático.
- Constructor visual de automatizaciones de propósito general.
- Múltiples canales o giros operativos simultáneos antes de validar WhatsApp y
  el paquete inicial para salones.
- Cambios autónomos en agentes, conocimiento, pipelines, automatizaciones o
  producción sin evaluación y aprobación humana.

## Criterios de éxito del MVP

El MVP se considera validado cuando existe evidencia de que:

- Un mensaje real de WhatsApp recorre recepción, procesamiento y respuesta sin
  duplicar efectos ante reintentos.
- Un colaborador autorizado puede consultar la conversación, intervenir y
  devolver el control sin acceder a datos de otra organización.
- El recorrido de un contacto desde conversación hasta cita puede operarse y
  medirse desde el producto.
- Una automatización de seguimiento sobrevive esperas y fallos, y su resultado
  queda persistido y observable.
- Una versión identificable de un agente usa únicamente conocimiento y
  herramientas autorizados, con fallos y costos observables.
- Una propuesta de mejora puede evaluarse, aprobarse, publicarse y revertirse
  con evidencia y auditoría.
- El flujo completo se valida primero en un entorno aislado de staging antes de
  cualquier publicación de producción.

Los objetivos cuantitativos de adopción, tiempo de respuesta, conversión y
calidad se fijarán con datos del primer piloto; no se inventan umbrales antes de
contar con una línea base real.

## Principios para decidir alcance

Una capacidad entra al producto cuando:

- Contribuye a recibir, entender, gestionar o convertir una conversación.
- Pertenece a la fase activa y respeta sus dependencias.
- Mantiene D1 como fuente canónica empresarial y los demás servicios dentro de
  su responsabilidad aceptada.
- Falla de forma cerrada cuando no puede demostrar organización, permisos o
  validez de una entrada.
- Puede probarse, observarse, recuperarse y documentarse sin exponer secretos o
  datos personales innecesarios.

Si una propuesta no satisface estos límites, se difiere o requiere una decisión
arquitectónica nueva antes de implementarse.
