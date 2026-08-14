# Instrucciones del repositorio

[`AGENTS.md`](./AGENTS.md) es la fuente única de reglas compartidas. Este punto
de entrada no las duplica: las importa para que estén disponibles desde el
inicio de la sesión.

@AGENTS.md

Para cambios del repositorio usa el skill `/deliver-agent-cloudflare-change`.
La [guía de continuidad de agentes](./.docs/operations/agent-continuity.md)
describe los hooks locales, su alcance y cómo revisarlos con `/hooks`.

## Autorizaciones dentro del turno

Cuando el trabajo llegue a una operación autorizable —desplegar, migrar en
remoto, `git push`, fusionar un PR o cambiar un recurso Cloudflare—, pide la
autorización con `AskUserQuestion` en ese mismo turno y continúa según lo que el
usuario apruebe. No esperes a que el guardrail te bloquee, y no termines la
entrega para pedirla por escrito.

La pregunta debe nombrar la operación concreta: entorno y artefacto en un
despliegue, base y entorno en una migración, rama y commits en un push, recurso
y entorno en un borrado. Una autorización vale para esa operación y no se
reutiliza para la siguiente.

Si el bloqueo no es autorizable, explica por qué no puede ejecutarse y ofrece la
alternativa; no lo conviertas en una pregunta, porque no existe autorización que
lo habilite. La tabla de marcas está en [`AGENTS.md`](./AGENTS.md).

## Verificación manual dentro del turno

Cuando la entrega dependa de algo que solo el usuario puede comprobar —cómo se
ve una pantalla, qué muestra el panel de Cloudflare, si un mensaje llegó a un
teléfono real—, pídelo también con `AskUserQuestion`, nunca terminando el turno
con la petición escrita al final.

Cada opción de esa pregunta describe qué se comprobaría, y el mensaje incluye la
comprobación guiada que define [`AGENTS.md`](./AGENTS.md): punto de partida,
pasos numerados con los datos concretos que hay que escribir, resultado esperado
y qué copiar si falla. Mientras esperas la respuesta, termina todo lo que no
dependa de ella, y registra lo que el usuario reporte tal cual en `Validación`.

## GitHub por API

Las operaciones con GitHub van contra `https://api.github.com` con `curl` y
`gh auth token` como proveedor de credencial, según
[`AGENTS.md`](./AGENTS.md). La CLI `gh` de esta máquina no puede editar un PR:
falla al consultar Projects clásicos, ya retirados por GitHub. Redacta el cuerpo
completo antes de crear el PR y verifica que lleve los cuatro encabezados que
valida el CI.
