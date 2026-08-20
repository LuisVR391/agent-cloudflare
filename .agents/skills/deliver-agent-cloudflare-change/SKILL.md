---
name: deliver-agent-cloudflare-change
description: Implementa, corrige, refactoriza o publica cambios en Agent Cloudflare con alcance, seguridad, pruebas, documentación, ADRs y roadmap verificables. Úsalo para trabajo de código, configuración, migraciones, arquitectura, documentación técnica o entrega por issue/PR, y para auditar, comitear y publicar el resultado; no lo uses para preguntas informativas que no modifican el repositorio, ni para planificar un corte antes de escribirlo, que es de plan-agent-cloudflare-change.
---

# Entregar un cambio de Agent Cloudflare

Mantén la implementación y su evidencia alineadas con las fuentes de verdad del
repositorio. Este skill organiza el trabajo; no sustituye las reglas ni duplica
la arquitectura.

Tres skills se reparten la entrega y no se solapan:

| Skill | Qué resuelve |
| --- | --- |
| [`plan-agent-cloudflare-change`](../plan-agent-cloudflare-change/SKILL.md) | Investiga, clasifica las decisiones y escribe el SPEC con criterios verificables |
| [`run-agent-cloudflare-cycle`](../run-agent-cloudflare-cycle/SKILL.md) | Reparte el SPEC, verifica de forma independiente y registra los findings |
| Este skill | Audita el diff, declara el impacto, comitea y publica con trazabilidad |

Un cambio pequeño puede usar solo este. Un corte con criterios, migración o
decisiones de negocio empieza por el de planificación.

## 1. Cargar el contexto obligatorio

Antes de diseñar o editar:

1. Lee `AGENTS.md` completo. Es la fuente normativa para cualquier agente.
2. Lee `README.md`, `.docs/product/roadmap.md` y la documentación relacionada
   con el área afectada.
3. Si el cambio toca arquitectura, persistencia, contratos, bindings,
   autorización o agentes, lee `.docs/guia-arquitectura-producto.md`,
   `wrangler.jsonc` y los ADRs relevantes en `.docs/decisions/`.
4. Si el cambio toca persistencia, inspecciona todas las migraciones existentes.
   Crea una migración nueva; nunca edites ni borres una que pudiera haberse
   aplicado.
5. Verifica código, configuración y pruebas reales. No presentes el roadmap o
   una propuesta como capacidad implementada.

## 2. Delimitar el cambio

Confirma y conserva durante el trabajo:

- objetivo y criterios de aceptación;
- fase activa y dependencias del roadmap;
- alcance y fuera de alcance;
- fuente de verdad de cada dato;
- límites de confianza, permisos y aislamiento por organización;
- idempotencia, observabilidad, recuperación y compatibilidad;
- pruebas, documentación, ADR y fila del roadmap potencialmente afectados.

Si falta una decisión que cambiaría materialmente el resultado, pregúntala por
el canal de consulta del agente antes de implementarla, y sigue con lo que no
dependa de la respuesta. No inventes recursos, contratos ni backlog de fases
futuras.

Cuando el corte necesita criterios de aceptación, una migración o una decisión
de negocio, esta delimitación se hace en
[`plan-agent-cloudflare-change`](../plan-agent-cloudflare-change/SKILL.md) y
queda escrita en el SPEC de la rama.

## 2 bis. Pedir autorizaciones y verificaciones sin detener el trabajo

Dos clases de pausa aparecen a mitad de una entrega, y ninguna justifica
terminar el turno para pedirlas por escrito:

**Autorización de un efecto remoto.** Desplegar, migrar contra una base remota,
`git push`, fusionar un PR o cambiar un recurso Cloudflare. Pregunta en el
momento, nombrando la operación concreta —entorno y artefacto, base y entorno,
rama y commits, recurso y entorno— y continúa con lo aprobado. Una autorización
vale para esa operación y no se reutiliza. Si el bloqueo no es autorizable,
explica por qué y ofrece la alternativa en vez de preguntar.

**Verificación que solo puede hacer la persona.** Cómo se ve una pantalla, qué
muestra un panel, si un mensaje llegó a un teléfono real. Pregunta también, y
acompaña la pregunta de una comprobación guiada:

1. Punto de partida: comando exacto, ruta del panel o URL.
2. Pasos numerados, con los datos concretos que hay que escribir.
3. Resultado esperado en cada paso, descrito de forma observable.
4. Qué significa que falle y qué conviene copiar para diagnosticarlo.

Mientras llega la respuesta, termina todo lo que no dependa de ella. Lo que la
persona reporte se registra tal cual en `Validación`: una verificación que no se
hizo no se declara como hecha.

## 3. Implementar el corte vertical mínimo

1. Inspecciona antes de modificar.
2. Conserva las decisiones aceptadas y los contratos públicos.
3. Consume Cloudflare mediante bindings tipados y nunca expongas secretos.
4. Valida entradas, salidas, autorización y aislamiento en backend.
5. Agrega pruebas proporcionales al riesgo y casos de fallo cerrado.
6. Actualiza la documentación que describe el comportamiento cambiado.
7. Registra un ADR nuevo cuando se adopte o sustituya una decisión
   arquitectónica. No reescribas la historia de un ADR aceptado.
8. Actualiza el roadmap únicamente si el PR completa, bloquea o cambia un
   entregable. Enlaza issue y PR como evidencia.

## 4. Auditar antes de entregar

Ejecuta, como mínimo:

```bash
npm run check
git diff --check
git status --short --branch
```

Añade las validaciones específicas del módulo y revisa el diff completo. No
incluyas secretos, `.dev.vars`, archivos privados, generados accidentales ni
cambios ajenos.

Antes de commit, push o PR, declara cada impacto:

- `Documentación`: archivos actualizados, o `no aplica — <motivo concreto>`.
- `ADR`: ADR creado/sustituido, o `no aplica — <motivo concreto>`.
- `Roadmap`: fila actualizada, o `no aplica — <motivo concreto>`.
- `Validación`: comandos y resultados realmente ejecutados.

Una omisión silenciosa no equivale a `no aplica`. No afirmes que un hook está
activo hasta que la persona usuaria lo haya revisado y confiado mediante
`/hooks`.

## 5. Publicar con trazabilidad

- Usa commits atómicos y coherentes por responsabilidad.
- Puedes crear commits locales sin autorización adicional cuando forman parte
  del cambio solicitado.
- Nunca ejecutes `git push` por inferencia ni como continuación automática.
  Solicita confirmación explícita después de mostrar rama, commits y
  validaciones pendientes de publicar.
- Después de recibir esa confirmación en la conversación actual, ejecuta el
  push con `AGENT_PUSH_CONFIRMED=1 git push`. No reutilices una autorización de
  otra sesión, rama o conjunto de commits.
- Vincula el PR al issue con `Closes #<número>` cuando corresponda.
- Incluye alcance, riesgos, operaciones externas pendientes y las cuatro
  declaraciones de impacto.
- Espera el CI y reporta su resultado.
- No fusiones ni despliegues sin autorización explícita.

### GitHub por API

Issues, PRs, comentarios y estado del CI van contra `https://api.github.com`, no
por la CLI. El token se obtiene en el momento con `gh auth token`, se usa como
credencial y nunca se escribe en un archivo, en la URL ni en un log.

```bash
TOKEN=$(gh auth token) && curl -sS -X POST \
  -H "Authorization: Bearer $TOKEN" \
  -H "Accept: application/vnd.github+json" \
  --data @cuerpo.json \
  https://api.github.com/repos/<owner>/<repo>/pulls
```

Crear y editar PRs, issues y comentarios no necesita marca. Fusionar, cerrar o
reabrir exige `AGENT_MERGE_CONFIRMED=1`, con el cambio de estado escrito en el
propio comando. Borrar por la API, publicar releases, escribir secretos y
disparar workflows siguen prohibidos.

Redacta el cuerpo **antes** de crear el PR: debe llevar `## Documentación`,
`## ADR`, `## Roadmap` y `## Validación`, en ese orden y con contenido, porque
`npm run check` los valida. Corregir el cuerpo después no basta para el CI: un
`rerun` reutiliza el evento original, así que hace falta un commit nuevo.

## Formato de entrega

Finaliza con estas secciones, incluso cuando alguna no aplique:

### Documentación

Indica qué cambió o por qué no aplica.

### ADR

Indica la decisión registrada/sustituida o por qué no aplica.

### Roadmap

Indica la fila y evidencia actualizadas o por qué no aplica.

### Validación

Enumera comandos, pruebas y estado de CI sin exagerar lo verificado.
