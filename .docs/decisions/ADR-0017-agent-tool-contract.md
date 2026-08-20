# ADR-0017: Contrato de herramienta y autorización por catálogo cerrado

**Estado:** Aceptado

**Fecha:** 2026-08-20

**Adoptada por:** el corte de herramientas autorizadas en backend
([#56](https://github.com/LuisVR391/agent-cloudflare/issues/56)), tercer
entregable de Fase 3, que hace consultar datos reales del CRM a la versión
publicada y deja traza de cada intento. El detalle operativo está en el
[módulo de herramientas y permisos](../modules/tools-and-permissions.md).

## Contexto

[ADR-0014](./ADR-0014-configurable-agents-and-published-versions.md) dejó las
herramientas como **declaraciones sin catálogo**: una revisión escribe qué
claves usará, el backend valida solo su forma, y su regla 9 aplaza al corte de
herramientas tanto la validación referencial como la reconciliación de lo ya
declarado. [ADR-0015](./ADR-0015-model-provider-and-agent-runs.md) puso a
responder a la versión publicada, pero su corrida no anuncia ninguna
herramienta: el modelo contesta con lo que digan las instrucciones y el marco
del prompt le prohíbe afirmar servicios, precios y horarios «porque no puedes
consultarlos».

El resultado es un agente que habla del salón sin poder mirar el salón. El
catálogo de servicios y la agenda tienen dueño en D1 desde Fase 2, y la única
forma de que una clienta reciba el dato correcto es que el backend lo consulte
por ella.

La pregunta que obliga a decidir no es cómo se llama a un repositorio, sino
**quién autoriza**. La regla de seguridad de la
[guía](../guia-arquitectura-producto.md) (§14.2) supone un actor con rol y
permisos, y una corrida disparada por un mensaje entrante no tiene ninguno: no
hay sesión, ni membresía, ni persona. Sin un sujeto de autorización definido, la
alternativa por omisión sería que una herramienta se ejecute porque alguien la
escribió en un campo de texto, que es exactamente lo que ADR-0014 se negó a
llamar autorización.

La cuarta decisión abierta del épico [#53](https://github.com/LuisVR391/agent-cloudflare/issues/53)
—el contrato de herramienta— es esta.

## Decisión

Una herramienta se ejecuta cuando **cuatro controles de backend coinciden**, y
el conjunto que sobrevive a esos cuatro es lo único que se le anuncia al modelo.
Esto fija ocho reglas.

1. **La autorización es una conjunción, no una declaración.** Una herramienta se
   anuncia si —y solo si— la **versión publicada la declaró**, **existe en el
   catálogo cerrado del producto**, su **audiencia es `contact`**, y sus datos se
   **acotan a la organización de la corrida y al contacto de esa conversación**,
   ambos leídos en D1. Si falla cualquiera de los cuatro, la herramienta no se
   anuncia; y lo que no se anunció no se ejecuta aunque el modelo lo pida. La
   declaración de una versión deja de ser una etiqueta inerte y pasa a ser una de
   las cuatro condiciones, que es lo que ADR-0014 dejó pendiente.

2. **El corte no introduce ningún permiso**, y el motivo no es economía sino
   quién es el sujeto. `agents.manage` ya decide qué herramientas declara un
   agente y `agents.read` ya permite consultarlas; ambos existen en el catálogo
   de instalación desde el commit que creó `0002`. La corrida, en cambio, no
   tiene actor humano: **la unidad de autorización es la versión publicada**, que
   es inmutable, tiene autor, motivo e historial, y no puede ampliarse sin
   publicar otra. Un permiso nuevo no protegería nada que `agents.manage` no
   conceda ya, y obligaría a propagar catálogo por una capacidad que ninguna
   persona ejerce.

3. **El catálogo vive en código y no en D1.** El handler es código: una fila que
   nombrara un handler inexistente sería un segundo dueño del mismo hecho, y
   ninguna empresa puede añadir una herramienta al producto. El precedente son
   `permissionDefinitions` y la matriz de transiciones de estado de cita. Una
   clave declarada que el catálogo vigente no reconoce **no se anuncia y no deja
   fila** en la traza —no hubo intento del modelo, solo una declaración que dejó
   de existir—, y queda en el log con su motivo. Esa es la reconciliación entre
   declaraciones históricas y catálogo que ADR-0014 obligaba a hacer aquí, y por
   eso ninguna versión ya publicada se rompe.

4. **El sujeto de la consulta sale del backend, nunca del argumento.** La
   organización viene del contexto de la corrida y el contacto de
   `conversations.contact_id`. Como consecuencia, ninguna herramienta de este
   corte recibe argumentos, y su schema es **estricto**: una clave que el modelo
   añada —un identificador de contacto, por ejemplo— **invalida la llamada
   entera**, que queda `rejected` con su fila y su auditoría, en vez de
   descartarse en silencio. Descartarla dejaría la misma evidencia para una
   consulta limpia y para un intento de alcanzar datos ajenos, y la traza dejaría
   de distinguirlos. Una herramienta que no puede demostrar organización y
   contacto falla cerrada antes de existir: no se anuncia.

5. **El contrato del proveedor admite dos desenlaces excluyentes.** La respuesta
   del modelo es una unión discriminada —texto o llamadas—, nunca ambos ni
   ninguno, y pedir una herramienta cuando no se anunció ninguna es salida
   inválida. El nombre que el modelo dice invocar se valida como identificador
   corto **dos veces**: al traducir la salida del proveedor y otra vez justo
   antes de escribirlo en la traza, porque el límite de confianza se aplica donde
   se usa el dato y un proveedor futuro podría construir la respuesta sin pasar
   por la primera. La traducción a la forma concreta de cada proveedor vive en su
   adaptador; el contrato conserva su vocabulario propio.

6. **La traza es evidencia, no una copia del contenido.** Cada intento deja una
   fila en `agent_tool_calls` —herramienta, orden dentro de la corrida,
   resultado, código y correlación— y una entrada en `audit_logs` con actor
   `system`, escritas en el mismo lote. **No se guardan los argumentos ni el
   resultado**: los argumentos pueden arrastrar lo que la clienta escribió, y el
   resultado ya tiene dueño en `services` y en `appointments`. Es la regla 7 de
   ADR-0015 aplicada un nivel más abajo. Los tres resultados no son sinónimos:
   `succeeded` es una ejecución que terminó, `rejected` es la contención
   funcionando y `failed` es una avería.

7. **Límites duros: dos rondas de herramientas y cuatro llamadas por corrida.**
   Dos rondas permiten encadenar una consulta que depende de otra; la tercera
   petición deja la corrida `failed` con `TOOL_ROUNDS_EXCEEDED`. El techo de
   llamadas existe además de las rondas porque una sola ronda con veinte llamadas
   cuesta lo mismo que veinte rondas, y corta **antes de ejecutar** la ronda que
   lo excede: consultar por un resultado que nadie leerá es gasto. En ambos casos
   rige la regla 6 de ADR-0015 y la conversación vuelve al equipo con su traza.

8. **El marco del prompt se acota, no se retira.** Con herramientas anunciadas,
   el catálogo y la cita del contacto dejan de ser materia de invención y pasan a
   consultarse; lo que **ninguna** herramienta expone —horarios de atención,
   disponibilidad, promociones— conserva su prohibición, y sin herramientas
   anunciadas el marco queda entero. No es un control de seguridad —un prompt
   nunca lo es— sino la respuesta honesta a lo que el agente no puede saber.

Este ADR **extiende ADR-0015 y no lo sustituye**: el contrato con el proveedor,
la traza de la corrida, la activación por modo y agente, y el escalamiento de
toda corrida que no responde siguen vigentes tal como se aceptaron.

### Diferido explícitamente

- **Herramientas de escritura.** Ninguna de este corte produce un efecto, así que
  no hay clave de idempotencia que inventar: el índice único de la corrida y el
  de la traza son lo que impide duplicar un reintento. Cuando llegue la primera
  herramienta que escriba, su clave derivará de la corrida y del ordinal del
  intento.
- **Horario de atención y disponibilidad.** `get_business_hours` y
  `get_available_slots` de la guía §24.1 no tienen esquema en el producto:
  serían un corte de negocio propio, no una herramienta.
- **Herramientas internas, administrativas y del supervisor** (§24.2 a §24.4),
  que sirven a otra audiencia y llegan con su fase.
- **Recuperación de conocimiento no estructurado**
  ([#57](https://github.com/LuisVR391/agent-cloudflare/issues/57)).
- **Confirmación humana previa al efecto**
  ([#60](https://github.com/LuisVR391/agent-cloudflare/issues/60)).
- **Medición de tokens, costo y failover**
  ([#61](https://github.com/LuisVR391/agent-cloudflare/issues/61)). Este corte
  triplica en el peor caso las llamadas al modelo por mensaje y no las mide.

## Consecuencias

### Positivas

- Una clienta recibe el dato que está en D1 en lugar de una respuesta inventada,
  y el marco del prompt deja de contener lo que ahora se puede consultar.
- «Qué intentó hacer el agente en esta conversación, en qué orden y qué se le
  negó» tiene respuesta consultable, separada de «quién intentó qué», que sigue
  en la auditoría.
- Una declaración de herramienta ya no es una etiqueta libre: el panel ofrece el
  catálogo y el backend rechaza una clave que el producto no implementa, de modo
  que nadie configura una capacidad inexistente.
- Añadir una herramienta futura es añadir una entrada al catálogo con su schema y
  su handler; la autorización, la traza y los límites ya existen.
- La superficie de datos que el modelo alcanza queda acotada por construcción:
  todo handler entra por un repositorio que ya filtra por organización, y ninguno
  abre un camino nuevo a la base.

### Costos y obligaciones

- **Toda herramienta nueva debe declarar su audiencia y acotar su sujeto**, o el
  cuarto control deja de significar algo. Una herramienta cuyos datos no puedan
  acotarse a la organización y al contacto no pertenece a la audiencia `contact`.
- Una corrida con herramientas cuesta hasta tres llamadas al modelo por mensaje.
  El gasto está contenido por los límites, pero no medido: es el hueco de #61.
- El catálogo en código implica que ampliarlo es un despliegue, no una
  configuración. Es deliberado, y deja de serlo el día que una empresa deba
  aportar su propia herramienta, que sería otro ADR.
- La traza sin argumentos ni resultados no permite reproducir una consulta
  concreta desde D1. El diagnóstico se hace con el código de fallo y la
  correlación; recuperar el contenido exigiría un almacén de datos personales
  cuya única razón sería depurar.
- El schema estricto convierte en `rejected` cualquier llamada con una clave
  sobrante, incluso si un proveedor la añade por su cuenta. Es el precio de que
  la traza distinga un intento limpio de uno que no lo es.
- La reconciliación de claves desconocidas es silenciosa para el modelo y visible
  solo en el log. Quien opere debe saber que una versión antigua puede declarar
  menos de lo que creía.

## Alternativas consideradas

- **Un rol de sistema con permisos propios en D1 para la corrida:** rechazada.
  Crearía un sujeto de autorización que ninguna persona controla y cuyo alcance
  se ampliaría editando filas, sin publicar una versión y sin autor ni motivo. La
  configuración publicada dejaría de explicar qué puede hacer el agente, que es
  justo la pregunta que ADR-0014 hizo respondible.
- **Una concesión por empresa, herramienta a herramienta, además de la
  declaración:** rechazada. Duplica en dos lugares el mismo hecho —qué puede
  consultar este agente— y los deja divergir: una versión declararía una
  herramienta que la concesión niega, y nadie sabría cuál manda. La versión
  publicada ya es el lugar donde la empresa lo decide, con `agents.manage` como
  privilegio.
- **Una tabla `agent_tools` sembrada por migración:** rechazada. El handler vive
  en código, así que la fila sería un segundo dueño del mismo hecho y obligaría a
  sincronizar datos con despliegues sin ganar nada: ninguna empresa puede añadir
  una herramienta, y una fila que nombrara un handler inexistente pasaría la
  validación referencial y fallaría en ejecución.
- **`ModelReply` con campos opcionales (`{ text?, toolCalls? }`) en vez de unión
  discriminada:** rechazada. Haría representables «ambos» y «ninguno», que son
  exactamente los estados que la validación tiene que rechazar, y un tipo que los
  admite los deja llegar hasta el runtime, donde ya no hay dónde fallar cerrado.
- **Guardar los argumentos y el resultado en la traza:** rechazada. Contradice la
  regla 7 de ADR-0015 y crearía un almacén paralelo de datos personales cuya
  única justificación sería el diagnóstico.
- **Registrar el intento solo en `audit_logs`:** rechazada. Su forma no admite la
  herramienta y el orden dentro de la corrida sin desnaturalizar `resource_id`, y
  el reparto entre una tabla de hechos y la auditoría ya existe entre `agent_runs`
  y `audit_logs`.
- **Limitar solo las rondas y no las llamadas:** rechazada. Una sola ronda con
  veinte llamadas tendría el mismo costo y la misma espera que veinte rondas.
- **Descartar en silencio las claves que el modelo añada a los argumentos:**
  rechazada. Un intento de alcanzar datos de otra clienta y una consulta limpia
  dejarían exactamente la misma evidencia.
- **Retirar entero el marco del prompt al anunciar herramientas:** rechazada.
  Dejaría al agente inventando horarios y disponibilidad, que es lo que ese marco
  contiene y lo que ninguna herramienta de este corte expone.

## Referencias

- [Guía de arquitectura y producto](../guia-arquitectura-producto.md), §14.2,
  §14.3 y §24.1
- [Modelo de seguridad](../architecture/security-model.md)
- [Contratos transversales](../architecture/contracts.md)
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Módulo de herramientas y permisos](../modules/tools-and-permissions.md)
- [ADR-0002: D1 como fuente de verdad](./ADR-0002-d1-source-of-truth.md)
- [ADR-0014: Agente configurable y versión publicable inmutable](./ADR-0014-configurable-agents-and-published-versions.md)
- [ADR-0015: Capa común de proveedor y traza de la corrida](./ADR-0015-model-provider-and-agent-runs.md)
- [Issue #53](https://github.com/LuisVR391/agent-cloudflare/issues/53) y
  [#56](https://github.com/LuisVR391/agent-cloudflare/issues/56)
