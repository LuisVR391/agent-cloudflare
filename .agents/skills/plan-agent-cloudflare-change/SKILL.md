---
name: plan-agent-cloudflare-change
description: Planifica un corte de Agent Cloudflare antes de escribir código: investiga el estado real, clasifica cada decisión, distingue lo que se decide de lo que se pregunta, y produce un SPEC con criterios de aceptación binarios y comandos de verificación. Úsalo cuando el trabajo empiece por una feature, un issue o un corte del roadmap; no lo uses para ejecutar el ciclo ya aprobado, que es de run-agent-cloudflare-cycle, ni para una corrección de una línea.
---

# Planificar un cambio de Agent Cloudflare

Este skill produce el contrato del corte. No sustituye `AGENTS.md`, que sigue
siendo la norma, ni describe la arquitectura: la busca donde ya está escrita.

Un plan sirve para dos cosas: fijar qué significa terminar, y separar lo que
puedes decidir de lo que solo puede decidir la persona.

## Cuándo no usarlo

Un texto, una constante, un nombre de variable o un ajuste de estilo se hacen
directamente. Si el corte cabe en un archivo y no toca persistencia, permisos ni
contratos, basta un plan corto: los criterios y los comandos, sin SPEC.

## 1. Investigar antes de diseñar

En este orden, porque cada paso decide dónde mirar en el siguiente:

1. `.docs/product/roadmap.md`: fase activa, dependencias y estado del
   entregable. Un corte que no pertenece a la fase activa se discute antes de
   planificarse.
2. `.docs/modules/` y `.docs/architecture/` del área afectada.
3. Los ADRs vigentes en `.docs/decisions/`. Una decisión aceptada tiene
   precedencia sobre cualquier propuesta o nota histórica.
4. `search_cloudflare_documentation` para el comportamiento de la plataforma.
   Conviene consultarla en vez de recordarla.
5. El código real: la superficie HTTP, el repositorio del dominio, las
   migraciones existentes y las pruebas que ya cubren la zona.

Responde antes de diseñar: ¿existe ya algo parecido en otro módulo?, ¿qué se
reutiliza?, ¿qué entidades y contratos se tocan?, ¿qué pruebas pueden romperse?,
¿qué efectos quedan fuera del módulo —colas, Durable Object, permisos, métricas,
medios—?

## 2. Clasificar cada decisión

| Tipo | Qué es | Qué haces | Dónde queda |
| --- | --- | --- | --- |
| A · Trivial | Nombre, orden, formato | Decides y sigues | En ningún sitio |
| B · Convención | Dónde va el archivo, cómo se tipa, qué primitiva se usa | No decides: localizas la regla que ya existe en `AGENTS.md`, un ADR o un módulo | `Decisiones técnicas`, una línea |
| C · Técnica | Cursor u offset, columna nueva o tabla, cálculo en el repositorio o en la ruta | Decides tú y anotas la alternativa descartada | `Decisiones técnicas` con su motivo |
| D · Negocio | Qué ve cada rol, si un campo es obligatorio, qué pasa con lo que ya existe | Preguntas antes de cerrar el SPEC | `Supuestos`, con los criterios que dependen marcados |
| E · Sensible | Ver la lista de abajo | Paras y preguntas siempre | `Riesgos`, con la respuesta literal en `Reglas de negocio` |

**La severidad sube y nunca baja.** Ante la duda entre C y D, es D.

En este repositorio son de tipo E, sin excepción:

- el aislamiento por organización y cualquier cambio en cómo se deriva;
- permisos, roles y el catálogo que los concede;
- secretos, y qué queda registrado en logs o respuestas;
- una migración de D1, y qué pasa con las filas que ya existen;
- un mensaje saliente real hacia WhatsApp;
- el costo o el presupuesto del modelo;
- datos personales de un contacto;
- un recurso Cloudflare que todavía no existe en el entorno.

Agrupa las preguntas D y E y hazlas juntas, con `AskUserQuestion`. Cuando la
decisión es de comportamiento, muestra el comportamiento: qué ve la persona, qué
puede hacer y qué ocurre al guardar, en vez de nombrar la implementación.

## 3. Criterios de aceptación binarios

Un criterio es **actor + acción + resultado observable + cómo se verifica**.
Se numeran `AC-01`, `AC-02`… y esa numeración no cambia: los findings la
referencian.

No sirven «correctamente», «adecuadamente», «de forma robusta», «optimizado»,
«intuitivo» ni «sin problemas». Si el criterio necesita un adjetivo para
sostenerse, todavía no es un criterio.

Un criterio es una condición. Dos comportamientos unidos por «y» son dos.

Cubre siempre los caminos tristes que este producto tiene de verdad: permiso
denegado, organización ajena, payload que no valida, reintento de un efecto ya
aplicado, y lista vacía.

## 4. Comandos de verificación

| Alcance | Comando |
| --- | --- |
| Lógica del Worker | `npm run test:worker`, o `npx vitest run --config vitest.config.ts test/<archivo>` |
| Interfaz | `npm run test:client`, o el archivo concreto con `vitest.client.config.ts` |
| Tipos | `npm run typecheck` |
| Configuración de agentes | `npm run check:agents` |
| Migración | `npm run db:migrate` y `npm run db:migrations:list` |
| Mensaje entrante local | `npm run dev:inbound` |
| Interfaz en vivo | `npm run dev` en `127.0.0.1:5190` |
| Gate de cierre | `npm run check` |

Nada que escriba entra en esta lista: se ejecuta después de que el revisor vio el
diff. El gate completo es caro y necesita red; se reserva para el cierre.

**Mide la línea base, no la supongas.** Anota qué falla ya antes de empezar; lo
que no, se atribuirá a este corte.

Si el corte tiene criterios visuales, comprueba **ahora** que el navegador
responde y que el bundle está fresco. Descubrirlo al verificar cuesta una ronda
entera.

## 5. Escribir el SPEC

Copia `templates/SPEC.md` a `.plans/<slug>/SPEC.md`, donde `<slug>` es
`issue-<n>-<tema>` cuando hay issue. Rellena el frontmatter de verdad: la sesión
recupera el plan de la rama a partir de él.

El SPEC es el contrato del corte. Una vez aprobado, solo cambia su `estado`. Si
el alcance cambia, se dice explícitamente y se vuelve a acordar.

`FINDINGS.md` no se crea aquí: nace con el primer hallazgo.

## 6. Arrancar el ciclo

Invoca `run-agent-cloudflare-cycle` y sigue su arranque. A partir de ahí el plan
deja de ser tuyo: pasa a ser el contrato contra el que otros trabajan.

## Dimensiona por decisiones, no por diff

El costo de un corte lo marcan los contratos que hay que cerrar, no las líneas
que cambian. Más de dos decisiones D o E significa que el corte son dos issues.

| Naturaleza | Qué es | Carril |
| --- | --- | --- |
| Mudanza | Mover, renombrar, extraer. Sin comportamiento nuevo | SPEC corto, verificación acotada al diff |
| Comportamiento nuevo | Algo que antes no existía | Ciclo normal |
| Sensible | Cualquier cosa de la lista E | Ciclo completo aunque sean diez líneas |

La naturaleza manda sobre el tamaño.

## Salida esperada

1. El plan en pantalla, con las decisiones D y E explícitas y una recomendación
   para cada una.
2. El SPEC escrito una vez aprobado.
3. El paso al ciclo.

Cierra el turno con `Documentación`, `ADR`, `Roadmap` y `Validación`, como
cualquier otro turno del repositorio. En un plan que todavía no toca el
repositorio, cada una lleva su motivo concreto.

## Referencias

- [Reglas compartidas](../../../AGENTS.md)
- [Skill del ciclo](../run-agent-cloudflare-cycle/SKILL.md)
- [Skill de entrega](../deliver-agent-cloudflare-change/SKILL.md)
- [Continuidad de agentes](../../../.docs/operations/agent-continuity.md)
