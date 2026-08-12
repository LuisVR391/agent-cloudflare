# Instrucciones del repositorio

[`AGENTS.md`](./AGENTS.md) es la fuente única de reglas compartidas. Este punto
de entrada no las duplica: las importa para que estén disponibles desde el
inicio de la sesión.

@AGENTS.md

Para cambios del repositorio usa el skill `/deliver-agent-cloudflare-change`.
La [guía de continuidad de agentes](./.docs/operations/agent-continuity.md)
describe los hooks locales, su alcance y cómo revisarlos con `/hooks`.

## Autorizaciones dentro del turno

Cuando el guardrail bloquee una operación autorizable —desplegar, migrar en
remoto, `git push`, fusionar un PR o eliminar un recurso Cloudflare—, pide la
autorización con `AskUserQuestion` en ese mismo turno y continúa según lo que el
usuario apruebe. No termines la entrega para pedirla por escrito.

La pregunta debe nombrar la operación concreta: entorno y artefacto en un
despliegue, base y entorno en una migración, rama y commits en un push, recurso
y entorno en un borrado. Una autorización vale para esa operación y no se
reutiliza para la siguiente.

Si el bloqueo no es autorizable, explica por qué no puede ejecutarse y ofrece la
alternativa; no lo conviertas en una pregunta, porque no existe autorización que
lo habilite. La tabla de marcas está en [`AGENTS.md`](./AGENTS.md).
