# Reglas compartidas de Agent Cloudflare

Estas instrucciones aplican a todo el repositorio y son la fuente única de
reglas para desarrolladores y agentes de codificación. Los archivos de
integración de herramientas deben remitir aquí en vez de copiar estas reglas.
La [guía de continuidad de agentes](./.docs/operations/agent-continuity.md)
explica el skill y los hooks repo-locales que ayudan a Codex y Claude Code a
aplicar estas reglas sin sustituirlas.

## Antes de modificar

1. Lee el `README.md` y la documentación relevante del cambio.
2. Consulta `.docs/guia-arquitectura-producto.md` para la visión y los límites
   del sistema.
3. Consulta `.docs/product/roadmap.md` para confirmar la fase, dependencias y
   estado aceptado.
4. Revisa `wrangler.jsonc`, los contratos y la propiedad de datos antes de
   modificar arquitectura o bindings.
5. Revisa todas las migraciones existentes antes de cambiar persistencia.
6. Busca ADRs relacionados en `.docs/decisions/`; una decisión aceptada tiene
   precedencia sobre propuestas o notas históricas.

No presentes una capacidad planificada como implementada. Verifica siempre el
código, configuración, migraciones y pruebas del repositorio.

## Límites del producto

- El MVP es un CRM conversacional para salones de belleza con WhatsApp como
  primer canal.
- El núcleo es común para todas las empresas. Las variaciones de giro se
  incorporan mediante configuración y paquetes empresariales, no mediante
  forks del producto.
- Una funcionalidad nueva debe contribuir a recibir, entender, gestionar o
  convertir una conversación y pertenecer a la fase activa del roadmap.
- No anticipes interfaces, bindings, recursos o esquemas físicos de fases
  futuras sin un issue y una decisión vigentes.

## Arquitectura y propiedad

- D1 es la fuente de verdad de los datos empresariales y relacionales.
- Un Durable Object coordina el estado vivo de una conversación; no sustituye
  el historial ni la configuración canónica de D1.
- R2 conserva archivos y medios; D1 conserva sus metadatos y permisos.
- Vectorize es un índice derivado y reconstruible, siempre filtrado por
  organización.
- Queues transporta trabajos; no demuestra que un efecto empresarial terminó.
- Workflows coordina procesos largos; sus resultados empresariales se
  persisten en D1.
- Workers AI y otros proveedores realizan cómputo; no son almacenes de datos.
- Los secretos pertenecen a Cloudflare Secrets y nunca a código, D1, Durable
  Objects, R2, Vectorize, colas, workflows, logs o respuestas.

Cada tipo de dato debe tener un solo dueño. No introduzcas un almacén paralelo
ni una segunda representación autoritativa sin un ADR que sustituya la decisión
vigente.

## Seguridad y aislamiento

- Toda entidad empresarial debe estar preparada para `organization_id`.
- La organización activa se deriva de contexto autenticado o configuración
  confiable; nunca se confía en un identificador enviado por el frontend.
- Autenticación, permisos y aislamiento se validan en backend antes de exponer
  datos, herramientas o acciones.
- Los prompts y las instrucciones al modelo no son controles de seguridad.
- Las búsquedas, herramientas y referencias a archivos deben fallar de forma
  cerrada si no pueden demostrar organización y permisos.
- Valida firmas, estructura y deduplicación antes de procesar webhooks.
- No registres tokens, prompts completos, mensajes completos ni datos
  personales innecesarios.
- Aplica mínimo privilegio y registra acciones autorizadas y rechazos
  relevantes con datos redactados.

## Contratos, idempotencia y compatibilidad

- TypeScript y mensajes internos usan `camelCase`; D1 usa `snake_case`.
- Los identificadores son opacos y no autorizan por sí mismos.
- Conserva `correlationId` entre Worker, Queue, Durable Object, Workflow,
  agente y herramienta.
- Todo efecto reintentable requiere una clave de idempotencia estable dentro de
  la organización.
- Valida inputs y salidas no confiables mediante schemas antes de producir
  efectos.
- No rompas contratos públicos. Un cambio incompatible requiere una nueva
  versión, una migración o un periodo explícito de compatibilidad.

## Cloudflare y persistencia

- Consume servicios Cloudflare mediante bindings tipados.
- Documenta todo binding nuevo y separa sus recursos por entorno.
- No crees, modifiques ni elimines recursos de producción sin autorización
  explícita.
- No guardes secretos en `wrangler.jsonc`, `.dev.vars.example` ni argumentos de
  comandos.
- Cada cambio de esquema crea una migración nueva, reversible cuando sea
  viable y aplicable desde una base vacía.
- No edites ni borres migraciones que puedan haber sido aplicadas.
- Mantén el acceso a D1 detrás de límites de dominio o repositorios; evita SQL
  disperso en handlers, agentes o componentes de interfaz.
- No almacenes en memoria global de Worker estado que deba sobrevivir,
  coordinarse o aislarse.

## Agentes y cambios sensibles

- Una salida del modelo es no confiable hasta validar schema, permisos y reglas
  de negocio.
- Una herramienta solo se anuncia y ejecuta después de autorización en backend.
- Los agentes pueden proponer cambios, pero no pueden autoaprobar cambios de
  agentes, pipelines, conocimiento, automatizaciones o producción.
- Toda mejora sensible requiere evidencia, evaluación, aprobación humana,
  nueva versión, auditoría y rollback.

## Herramientas de desarrollo asistido

La interfaz del cliente es un proyecto shadcn/ui y se compone con las primitivas
del registro, según [ADR-0009](./.docs/decisions/ADR-0009-client-ui-composition.md).
El repositorio declara la skill `shadcn` en `.agents/skills`, con symlink desde
`.claude/skills`, y el servidor MCP `shadcn` en `.mcp.json` para Claude Code y en
`.codex/config.toml` para Codex. Úsalos en vez de adivinar la API de un
componente.

- Son herramientas de desarrollo local: no forman parte del producto
  desplegado, no declaran bindings ni recursos y no añaden por sí mismas
  dependencias de runtime.
- Un componente del registro sí puede exigir un paquete que entra en el bundle.
  Instalarlo no autoriza su dependencia: se declara, se fija a una versión
  exacta y se justifica en la entrega.
- No autorizan nada por sí solas. El código que generen se revisa en el diff y
  cumple las mismas reglas de alcance, seguridad, pruebas y documentación.
- Los guardrails no observan las llamadas a herramientas MCP; la revisión
  humana y `npm run check` siguen siendo el control.
- Una skill o un servidor MCP externo se incorpora con su contenido revisado,
  una sola copia canónica, declaración en ambos agentes y registro en
  `skills-lock.json`.

La [guía de continuidad](./.docs/operations/agent-continuity.md) explica su
descubrimiento, verificación y límites.

## Flujo de trabajo

1. Confirma el objetivo, fase, dependencias, alcance y fuera de alcance.
2. Inspecciona el comportamiento y configuración reales antes de diseñar.
3. Identifica la fuente de verdad, límites de confianza, permisos,
   idempotencia, observabilidad y recuperación.
4. Registra o sustituye un ADR si el cambio modifica una decisión
   arquitectónica aceptada.
5. Implementa el cambio vertical más pequeño que satisfaga los criterios.
6. Agrega pruebas proporcionales al riesgo y actualiza la documentación
   afectada.
7. Ejecuta `npm run check` y las validaciones específicas del módulo.
8. Revisa `git diff --check` y confirma que el diff no contenga secretos,
   archivos generados accidentales ni cambios ajenos.
9. Actualiza la fila del roadmap si el PR completa, bloquea o cambia un
   entregable, enlazando issue y PR como evidencia.

Los commits deben ser coherentes por responsabilidad. Un PR debe explicar
alcance, impacto, validación, riesgos y cualquier operación externa pendiente.
Además, debe declarar explícitamente el impacto en `Documentación`, `ADR`,
`Roadmap` y `Validación`; si una categoría no aplica, incluye un motivo
concreto.

Los agentes pueden crear commits locales atómicos como parte de un cambio
solicitado, pero nunca ejecutan `git push` sin confirmación explícita del
usuario para la rama y los commits actuales. Después de recibirla, el comando
usa `AGENT_PUSH_CONFIRMED=1 git push`; una autorización anterior no se
reutiliza. El force push permanece prohibido.

Los agentes solo despliegan después de recibir autorización explícita para el
entorno y el artefacto actuales. Después de recibirla, el comando usa
`AGENT_DEPLOY_CONFIRMED=1` como prefijo. Esa autorización no se reutiliza para
otra versión o entorno, y no habilita ninguna otra operación bloqueada.
Producción y las operaciones destructivas requieren una autorización separada.

Cada clase de efecto remoto tiene su propia marca, de modo que autorizar una no
habilita otra:

| Operación | Marca |
| --- | --- |
| `git push` de la rama y commits actuales | `AGENT_PUSH_CONFIRMED=1` |
| Despliegue de un entorno y artefacto | `AGENT_DEPLOY_CONFIRMED=1` |
| Migraciones sobre una base remota | `AGENT_MIGRATION_CONFIRMED=1` |
| Fusionar, cerrar o reabrir un PR o issue | `AGENT_MERGE_CONFIRMED=1` |
| Eliminar un recurso Cloudflare | `AGENT_DESTRUCTIVE_CONFIRMED=1` |

Una autorización se pide para la operación concreta que está a punto de
ejecutarse y no se reutiliza. Cuando el agente dispone de un canal para
consultar al usuario dentro de la entrega, la pide ahí y continúa con lo que se
apruebe, en vez de interrumpir el trabajo; el guardrail del repositorio se lo
indica en el propio bloqueo.

Permanecen prohibidas sin excepción, porque ninguna autorización las habilita:
el force push, el descarte destructivo de trabajo local, la ejecución remota
arbitraria sobre D1, la escritura de secretos, la publicación de paquetes o
releases y la alteración del repositorio remoto. Esas siguen siendo operaciones
humanas separadas.

## Documentación y ADRs

- La guía rectora conserva la visión; el roadmap conserva el estado aceptado.
- Los documentos especializados enlazan la guía y los ADRs en vez de duplicar
  explicaciones extensas.
- Las funciones, rutas, schemas y bindings se documentan cuando existen, no
  como interfaces supuestamente disponibles.
- Sigue `.docs/decisions/README.md` para crear, aceptar, sustituir o rechazar
  decisiones.
- Un ADR aceptado no se reescribe para ocultar su historia. Los cambios
  sustanciales se registran en un ADR nuevo con enlaces en ambas direcciones.
