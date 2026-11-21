# Entrega de cambios

## Seguimiento y trabajo local

- Registra los pendientes de producto o mantenimiento que indique el usuario en
  [Pendientes — Agent Cloudflare](https://app.notion.com/p/41fdb9dbd4118185a0a6fead768cd9b4).
  Cuando empiece la ejecución autorizada, enlaza la tarjeta y el issue de este
  repositorio en ambas direcciones. El
  [skill de pendientes](../../.agents/skills/pendientes-agent-cloudflare/SKILL.md)
  detalla los estados y la conciliación.
- Instala el hook de Git con `npm run hooks:install` después de `npm ci`.
  Si Git ya usa un hook pre-push distinto, el instalador lo conserva y avisa.
  En ese caso integra la comprobación del repositorio en el hook que mantienes.
  El validador se ejecuta en ramas que ya contienen este flujo.
- Actualiza en el mismo cambio las fichas de `.docs/` afectadas. El hook
  pre-push comprueba la documentación por área en los commits salientes. CI
  revisa el diff completo del PR y los encabezados de su descripción. Revisa
  también el contenido y los enlaces desde los documentos que usan el módulo.

## Antes de fusionar

1. Ejecuta `npm run check` y `git diff --check`. Incluye en el PR la tarjeta,
   el issue y la evidencia de las validaciones que se ejecutaron. Usa
   `Closes #<número>` si el PR completa el issue.
2. Revisa el código del SHA que se va a fusionar, resuelve los hallazgos
   bloqueantes y comprueba los checks de ese SHA en GitHub. Si la aceptación
   exige staging, registra el resultado antes de la fusión.
3. En la fusión autorizada, pasa el último SHA revisado como `sha` en el
   cuerpo de la solicitud REST. GitHub rechazará la fusión si la rama avanzó.
4. Confirma la fusión y el SHA devuelto por la API de GitHub, así como el estado
   del issue. Concilia la tarjeta del cambio y las tarjetas abiertas afectadas
   por esa entrega. Mantén `En curso` mientras falte verificación o cierre.

Si utilizas el hook de Codex o Claude Code, el recordatorio de conciliación
aparece cuando el comando de merge confirmado usa la ruta REST
`/pulls/<n>/merge` y su salida conserva la respuesta JSON de GitHub. La
conciliación usa la evidencia real del PR aunque el recordatorio no aparezca.

## Antes de desplegar

Haz una revisión de código para el despliegue y repite la suite completa
sobre el SHA candidato. Revisa lo que cambia desde la versión activa y registra
la versión previa y el plan de recuperación. Staging admite un candidato
revisado antes del merge, con autorización independiente para ese SHA.
El [runbook de entornos](./environments.md) describe la ejecución, verificación
y recuperación en Cloudflare.

## Configuración de herramientas

Codex y Claude Code leen las reglas de `AGENTS.md` y descubren los mismos
skills versionados. Revisa los hooks del proyecto con `/hooks` y confía su
configuración en el cliente que uses. El hook de Git funciona también desde
terminal después de instalarlo. Los hooks de agente evalúan herramientas que
emiten los eventos configurados y no ven operaciones hechas por MCP. Para
shadcn/ui, ambos clientes declaran el servidor MCP con la versión fijada en
`package.json`.
