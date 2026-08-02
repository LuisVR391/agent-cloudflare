# Decisiones arquitectónicas

Este directorio conserva las decisiones arquitectónicas de Agent Cloudflare.
Un Architecture Decision Record (ADR) explica por qué se eligió una dirección,
qué consecuencias tiene y cómo puede cambiar sin borrar la historia.

La [guía de arquitectura y producto](../guia-arquitectura-producto.md) mantiene
la visión completa. Los ADRs fijan decisiones concretas y prevalecen sobre
ejemplos o propuestas anteriores cuando existe una diferencia.

## Estados

| Estado | Significado |
| --- | --- |
| Propuesto | La decisión está en revisión y todavía no gobierna implementaciones. |
| Aceptado | La decisión fue aprobada y debe respetarse en cambios posteriores. |
| Sustituido | Otro ADR reemplazó total o parcialmente esta decisión. |
| Rechazado | La alternativa fue evaluada y no se adoptará. |

Un ADR incluido como `Aceptado` en un PR entra en vigor cuando ese PR se
fusiona en `main`.

## Estructura

Cada ADR debe incluir:

1. Título y número estable.
2. Estado.
3. Contexto y problema que obliga a decidir.
4. Decisión, con límites claros.
5. Consecuencias positivas, negativas y obligaciones operativas.
6. Alternativas consideradas.
7. Referencias a documentación, issues y ADRs relacionados.

Los nombres siguen `ADR-NNNN-descripcion-breve.md`. Los números no se reutilizan
aunque una decisión sea rechazada o sustituida.

## Ciclo de vida

1. Crea un ADR `Propuesto` junto con el cambio que necesita la decisión.
2. Recaba la revisión técnica y las autorizaciones necesarias.
3. Cambia el estado a `Aceptado` en el PR que adopta la decisión.
4. Actualiza el índice documental y el roadmap cuando corresponda.
5. Si la decisión cambia sustancialmente, crea un ADR nuevo.
6. Marca el anterior como `Sustituido` y enlaza ambos documentos.

Un ADR aceptado puede recibir correcciones tipográficas, enlaces o aclaraciones
que no cambien su significado. No se reescribe para presentar una decisión
histórica como si siempre hubiera sido distinta.

## Índice

| ADR | Estado | Decisión |
| --- | --- | --- |
| [ADR-0001](./ADR-0001-cloudflare-native.md) | Aceptado | Arquitectura Cloudflare-native mediante bindings |
| [ADR-0002](./ADR-0002-d1-source-of-truth.md) | Aceptado | D1 como fuente de verdad empresarial y relacional |
| [ADR-0003](./ADR-0003-conversation-agent.md) | Aceptado | Runtime durable por conversación |
| [ADR-0004](./ADR-0004-human-approval.md) | Aceptado | Aprobación humana para mejoras sensibles |
| [ADR-0005](./ADR-0005-shared-agent-guardrails.md) | Aceptado | Núcleo neutral de guardrails para agentes de codificación |
| [ADR-0006](./ADR-0006-d1-schema-conventions.md) | Aceptado | Convenciones de esquema y migraciones en D1 |
| [ADR-0007](./ADR-0007-better-auth-and-organization-context.md) | Aceptado | Better Auth en D1 y contexto organizacional validado |
