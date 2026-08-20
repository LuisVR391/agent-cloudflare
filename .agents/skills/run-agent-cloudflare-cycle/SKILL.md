---
name: run-agent-cloudflare-cycle
description: Orquesta la implementación de un corte que ya tiene SPEC aprobado: reparte los criterios entre los subagentes por dominio, baja los comandos al corredor, verifica con el revisor, registra los findings con severidad, acota el Fix Mode y declara el cierre con evidencia. Úsalo cuando exista el SPEC y haya que ejecutarlo; no lo uses para planificar ni para escribir el SPEC, que es de plan-agent-cloudflare-change.
---

# Ejecutar el ciclo de un corte de Agent Cloudflare

Este skill organiza quién hace qué. Las reglas siguen siendo las de
`AGENTS.md`, y la publicación sigue siendo de
[`deliver-agent-cloudflare-change`](../deliver-agent-cloudflare-change/SKILL.md).

## Precondición

Existe `.plans/<slug>/SPEC.md` aprobado. Sin él no se arranca: se vuelve a
`plan-agent-cloudflare-change`. `FINDINGS.md` nace con el primer hallazgo, en el
mismo directorio.

Ninguno de los dos se versiona. Lo permanente vive en el issue, en el cuerpo del
PR y en `.docs/`.

## El orquestador no edita ni corre comandos

Escribes únicamente bajo `.plans/**`. La implementación es de los subagentes y
los comandos largos son del `corredor`.

Dos excepciones, ambas deliberadas:

- **git y la API de GitHub se quedan arriba.** El guardrail audita el diff en el
  propio comando de commit, y solo el turno principal puede pedir una
  autorización.
- **Una corrección de una línea** cuya causa ya entendiste, cuando delegarla
  cuesta más que hacerla.

El motivo es medible: el contexto del turno principal se relee en cada turno
posterior. El volcado de una suite dentro de él se paga muchas veces; dentro de
un subagente se paga una.

## Arranque, en este orden

1. Confirma que el SPEC está escrito y aprobado.
2. Pregunta **una sola vez**, con `AskUserQuestion`: qué motor se usa —los
   subagentes del repositorio, los genéricos del entorno, o mixto por criterio—
   y quién hace la verificación manual, si el corte la necesita.
3. Monta el tablero con `TaskCreate` y `TaskUpdate`. Una tarea es una unidad con
   dueño y final comprobable. El orden habitual es: esquema, después backend e
   interfaz en paralelo, después corredor, después revisor, después
   documentación y cierre.
4. Pide la línea base al `corredor` mientras preparas el resto.
5. Si hay criterios visuales, comprueba ahora el navegador y la frescura del
   bundle.

## El motor

| Subagente | Cuándo entra |
| --- | --- |
| `d1-schema` | Solo si hay migración. Va primero: el resto depende del esquema |
| `worker-backend` | Comportamiento del servidor y sus pruebas |
| `client-ui` | Interfaz y sus pruebas |
| `corredor` | Línea base, comandos largos y cierre |
| `revisor` | Verificación, después de que el gate parcial está en verde |

Quien implementa un criterio escribe su prueba. Un agente por dominio y turno;
lo que no comparte archivos se lanza en paralelo, en un solo mensaje.

### El encargo

Nunca «implementa la feature». Todo encargo lleva: la ruta del SPEC, los
criterios asignados **por número**, la tarea del tablero, las restricciones del
corte y la petición de un informe telegráfico. `templates/BRIEF.md` tiene las
variantes.

Ningún subagente reparte trabajo, decide alcance ni ejecuta un efecto remoto.

## El ciclo

```
IMPLEMENT ──→ CHECK (corredor) ─┬─ falla ──→ FIX ──→ repite ESE comando
                                └─ verde ──→ VERIFY (revisor)
                                                ├─ findings ──→ FIX ──→ re-check DEL finding ──┐
                                                │←───────────────────────────────────────────────┘
                                                └─ sin findings ──→ DOCS ──→ cierre
```

| Estado | Quién | Sale cuando |
| --- | --- | --- |
| IMPLEMENT | Implementadores | El criterio tiene código y prueba |
| CHECK | `corredor` | El marcador está en verde |
| VERIFY | `revisor` | Devolvió veredicto y findings |
| FINDINGS | Orquestador | Están registrados con identificador y severidad |
| FIX | Implementadores | El finding tiene corrección |
| RE-CHECK | Quien lo abrió | El finding concreto pasa |
| DOCS | Implementadores u orquestador | La documentación afectada está al día |

**Una sola pasada de verificación.** El revisor contesta cumplimiento y calidad
en el mismo turno. El re-check se acota al finding, nunca al diff entero. La
excepción es un corte sensible, donde la verificación se desdobla.

Después de VERIFY, nada modifica el código salvo un Fix Mode declarado.

### Los tres orígenes de un finding

| Origen | Quién lo abre | Cómo se cierra |
| --- | --- | --- |
| `func` | `revisor`: un criterio no se cumple | Re-check de ese criterio |
| `tech` | `revisor`: calidad técnica que la pantalla no muestra | Re-check del archivo tocado |
| `check` | Orquestador, con el marcador del `corredor` | Volver a correr ese comando |

Numeración global y continua: `F-07 · major · tech · AC-03`. No se reinicia
entre rondas.

### Severidad

- `critical` — daño real: fuga entre organizaciones, secreto expuesto, pérdida
  de datos, efecto irreversible sin autorización.
- `major` — un criterio no se cumple, o se rompe una regla de `AGENTS.md`.
- `minor` — defecto acotado que conviene corregir ahora.
- `suggestion` — no se implementa en este ciclo; se anota y se propone como
  issue.

Un criterio que falla es `major`. `critical` se reserva para el daño.

### Fix Mode

Un encargo por dominio con todos sus findings ordenados por severidad. El
re-check lo hace quien abrió el finding. Solo entonces se mueve a `Resueltos`.

Límite: tres intentos por finding y cinco rondas en total. Al alcanzarlo se
declara bloqueado con el formato de `templates/FINDINGS.md`, y la decisión pasa
a la persona.

## Autorizaciones y verificación manual

Cuando el ciclo llega a un efecto remoto —desplegar, migrar contra una base
remota, `git push`, fusionar—, el orquestador pide la autorización con
`AskUserQuestion` en ese momento, nombrando la operación concreta, y continúa
con lo aprobado. Ningún subagente la pide ni la ejecuta.

Cuando un criterio solo puede comprobarlo la persona, se pregunta acompañando la
comprobación guiada: punto de partida, pasos numerados con datos concretos,
resultado esperado observable y qué copiar si falla. Lo que la persona reporte se
transcribe tal cual. Una verificación que no se hizo no se declara como hecha.

## Cierre

El bloque de cierre se declara, no se deduce, y **cada línea se respalda con algo
que se ejecutó**. Usa `templates/GOAL-STATUS.md`, que termina con las cuatro
secciones que el repositorio exige en todos los turnos: `Documentación`, `ADR`,
`Roadmap` y `Validación`.

Después, `deliver-agent-cloudflare-change` se ocupa de la auditoría del diff, los
commits, el PR y el CI.

## Reglas duras

1. Sin SPEC no hay ciclo.
2. El orquestador no implementa.
3. Quien implementa no verifica su propio criterio.
4. El revisor no escribe: ni código, ni `FINDINGS.md`.
5. El corredor devuelve marcador, no volcado.
6. La numeración de criterios y findings no se reinicia.
7. Una `suggestion` no entra en el ciclo.
8. Ningún subagente ejecuta un efecto remoto.
9. El cierre lleva evidencia ejecutada, no intención.

## Referencias

- [Skill de planificación](../plan-agent-cloudflare-change/SKILL.md)
- [Skill de entrega](../deliver-agent-cloudflare-change/SKILL.md)
- [Reglas compartidas](../../../AGENTS.md)
- [ADR-0016](../../../.docs/decisions/ADR-0016-multi-agent-delivery-cycle.md)
