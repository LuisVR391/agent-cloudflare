# Métricas iniciales del proceso

> **Estado:** vigente para las métricas operativas y comerciales del sexto
> entregable de Fase 2
> ([#39](https://github.com/LuisVR391/agent-cloudflare/issues/39)). Este
> documento describe lo que existe hoy, no lo planificado.

El criterio de salida de Fase 2 exige que el recorrido de un contacto pueda
**medirse** desde el CRM. Estas métricas son la lectura de ese recorrido: qué
llegó, en cuánto se atendió, cuánta gente nueva apareció y cuánto terminó en una
cita.

Ninguna cifra tiene almacén propio. Se derivan por consulta sobre D1 en el
momento en que se piden, según
[ADR-0012](../decisions/ADR-0012-initial-metrics.md): no hay tablas de
agregación, columnas contador ni proyecciones materializadas, porque cada dato
ya tiene un dueño y una copia paralela divergiría en silencio en cuanto un
reintento fallara a medias.

## Qué se lee y de dónde

| Métrica | Definición | Tabla |
| --- | --- | --- |
| Mensajes recibidos | Mensajes con `direction = 'incoming'` cuyo `occurred_at` cae en el periodo | `messages` |
| Conversaciones activas | Conversaciones distintas con al menos un mensaje en el periodo | `messages` |
| Tiempo de primera respuesta | Mediana y promedio de la espera de cada turno respondido, más cuántos siguen esperando | `messages` |
| Intervenciones humanas | Mensajes salientes con `sender_type = 'staff'` y conversaciones distintas en que ocurrieron | `messages` |
| Contactos nuevos | Contactos con `created_at` en el periodo | `contacts` |
| Oportunidades por etapa | Oportunidades abiertas en el periodo, agrupadas por su etapa actual | `opportunities`, `pipeline_stages`, `pipelines` |
| Conversión a cita | De esas oportunidades, cuántas tienen al menos una cita enlazada | `opportunities`, `appointments` |
| Citas por estado | Citas cuyo `starts_at` cae en el periodo, agrupadas por estado | `appointments` |

Las métricas de inteligencia artificial —tokens, costos, modelo, herramientas y
calidad— no están aquí: dependen de que exista inferencia, que llega en Fase 3.

## El periodo es obligatorio y lo define la empresa

Toda consulta declara inicio y fin. No hay periodo por defecto en el backend: una
métrica derivada sin rango es un escaneo del historial completo, y el rango
acotado es el único control de costo que tiene este diseño.

Los dos extremos son **días civiles inclusivos** —quien pide del 1 al 31 espera
el 31 entero— y se interpretan con la zona horaria declarada por la organización
([ADR-0010](../decisions/ADR-0010-crm-commercial-model.md)). Un mensaje recibido
a las 23:00 hora del salón pertenece a su día local, aunque en UTC ya sea el día
siguiente. El Worker resuelve el rango a un intervalo semiabierto `[from, to)`
en UTC antes de tocar D1; el navegador no decide dónde empieza un día.

El máximo es de **92 días**, un trimestre, y se declara en el servidor. Un
máximo que decidiera el cliente no sería un máximo.

## Qué cuenta como un turno

El tiempo de primera respuesta se mide por turno, no por mensaje. Un turno es un
mensaje entrante que abre una espera: el anterior de esa conversación no fue
entrante. Dos mensajes seguidos del contacto son **un solo turno**, porque quien
atiende debe una respuesta, no dos, y contarlos por separado duplicaría
artificialmente el trabajo pendiente.

La espera de un turno es el tiempo hasta el siguiente mensaje saliente de esa
conversación. Los turnos que al consultar seguían sin respuesta se cuentan
aparte, como `pending`, y **no entran en la mediana ni en el promedio**:
promediar una espera que todavía no terminó mejoraría la cifra cuanto peor
fuera el servicio.

El cálculo mira un día antes y un día después del periodo, para saber si el
primer mensaje continuaba una espera ya abierta y para encontrar la respuesta de
un turno que se abrió justo antes del cierre. La consecuencia es explícita: un
turno cuya respuesta llega más de un día después del cierre se cuenta como
pendiente.

La cifra que el panel destaca es la **mediana**. Un promedio se distorsiona con
un solo mensaje contestado a la mañana siguiente.

## Intervención humana es lo que envía una persona

Hoy toda respuesta la escribe alguien del equipo, así que la métrica cuenta los
mensajes salientes con remitente `staff` y en cuántas conversaciones ocurrieron.
La alternativa —contar los cambios de modo hacia control humano— daría cero de
forma permanente, porque en Fase 2 toda conversación nace en modo `human` y no
hay automatización que interrumpir.

La definición sobrevive a Fase 3 sin cambiar: cuando el agente responda solo,
esta misma cuenta pasará a medir exactamente lo que una persona tuvo que
atender.

## La conversión se mide por el enlace, no por coincidencia

Una oportunidad cuenta como convertida cuando existe una cita con su
`opportunity_id`. No basta con que el contacto tenga una cita posterior:
atribuir por contacto le adjudicaría a una venta la cita que salió de otra, y en
un salón la misma persona vuelve.

Por eso la cita agendada desde la conversación conserva la oportunidad que ese
hilo abrió; el panel la propone preseleccionada y permite dejarla sin enlazar.
Una cita sin oportunidad sigue contando en «citas por estado»: es una cita real,
solo que no explica ninguna venta.

Las citas creadas antes de este corte no tienen ese enlace y no aparecerán como
conversión. Es una consecuencia asumida del piloto, no un error de cálculo.

## Superficie HTTP

| Ruta | Método | Permiso | Respuesta |
| --- | --- | --- | --- |
| `/api/metrics?from=YYYY-MM-DD&to=YYYY-MM-DD` | `GET` | `metrics.read` | `{ timeZone, range, window, operations, commercial }` |

`range` devuelve los dos días civiles y cuántos días abarcan; `window`, el
intervalo UTC que realmente se consultó, para que quien lo lea pueda comprobar
cómo se interpretó la fecha.

La conversión viaja como dos conteos, `created` y `withAppointment`, y no como
una tasa: el porcentaje lo calcula quien lo muestra, y devolverlo además
duplicaría la definición en dos sitios que podrían divergir.

Códigos de error: `400 INVALID_RANGE` cuando falta un extremo, no es un día del
calendario o el periodo termina antes de empezar; `400 RANGE_TOO_LONG` por
encima del máximo; `403 FORBIDDEN` sin permiso; `405 METHOD_NOT_ALLOWED` con
cualquier método que no sea `GET`.

## Permisos

| Permiso | Roles |
| --- | --- |
| `metrics.read` | `owner`, `manager`, `operator` |

Los tres roles las consultan. Son agregados del proceso —conteos, promedios y
distribuciones—, no datos personales del contacto ni contenido de mensajes, y
quien atiende la conversación produce la mayoría de esas cifras: ocultarle el
efecto de su trabajo no protege nada.

Como en los cortes anteriores, los permisos entran por dos caminos que deben
coincidir: `0018_metrics_read_access.sql` concede `metrics.read` por `role_key` a
toda organización ya instalada y `permissionDefinitions`/`permissionsByRole`
cubren las instalaciones nuevas, con una prueba que verifica que ambos catálogos
terminan iguales.

## Aislamiento y observabilidad

Toda consulta filtra por la organización activa, que se deriva del contexto
autenticado, y falla cerrada sin ella: `MetricsRepository` exige el alcance
antes de tocar D1, como el resto de repositorios
([ADR-0006](../decisions/ADR-0006-d1-schema-conventions.md)).

La agregación ocurre en D1, no en el Worker. Traer el historial para contarlo
expondría al proceso exactamente lo que el mínimo privilegio protege, y el
resultado no lo necesita: lo que sale son conteos y promedios.

La petición conserva `correlationId`. No se registran las fechas consultadas ni
ningún dato personal: la respuesta es agregada por construcción.

## Índices

El rango acotado no sirve de nada sin un índice que empiece por la organización
y siga por la fecha. `0018_metrics_read_access.sql` añade
`messages (organization_id, occurred_at, direction)` y
`opportunities (organization_id, created_at)`; los contactos y las citas ya
tenían el suyo desde `0001` y `0017`.

## Panel

El resumen de `/app` es la superficie de estas métricas. Abre en los últimos 30
días de la empresa y ofrece presets de 7, 30 y 90 días más un rango elegido a
mano; el cliente siempre envía el periodo.

Un periodo sin actividad lo dice —«Sin actividad en este periodo»— en vez de
mostrar guiones. Antes había tres tarjetas con un guion y la promesa de una
etapa futura, y eso es justo lo que un resumen no debe hacer: aparentar una
cifra que nadie midió. Sin `metrics.read`, la bienvenida permanece y el tablero
se sustituye por la explicación de qué permiso falta.

## Límites conocidos

- Sin comparación entre periodos, series históricas ni tendencias: no hay
  agregados precalculados y compararlos era trabajo posterior, no un efecto
  secundario gratuito.
- Sin exportación ni reportes programados, fuera del alcance de #39.
- Sin segmentación por colaborador, canal o servicio. La guía las enumera; #39
  entrega el conjunto que el criterio de salida exige.
- Sin métricas de errores ni reintentos del canal: existen en el historial de
  entregas, pero pertenecen a la observabilidad operativa y no al resumen
  comercial de este corte.
- El tiempo de resolución de una conversación no se mide todavía: exige decidir
  qué cuenta como resuelta cuando alguien la reabre, y esa decisión no está
  tomada.
- El costo de la consulta crece con el historial. El máximo de 92 días es el
  control, y ADR-0012 obliga a revisar esta decisión con datos reales del
  piloto, no por intuición.
