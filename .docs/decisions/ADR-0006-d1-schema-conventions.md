# ADR-0006: Convenciones de esquema y migraciones en D1

**Estado:** Aceptado

**Fecha:** 2026-07-30

## Contexto

[ADR-0002](./ADR-0002-d1-source-of-truth.md) estableció que D1 es la fuente de
verdad empresarial y relacional, pero declara explícitamente que «este ADR no
anticipa todo el esquema del CRM». El [modelo de
dominio](../architecture/domain-model.md) sostiene lo mismo desde el lado
conceptual: «tablas de unión, índices y restricciones se decidirán en el issue
de D1».

Al crear la primera migración real hay que fijar decisiones físicas que ninguna
de esas fuentes resuelve: qué tipo tienen los identificadores, cómo se
representan los timestamps, dónde vive la obligación de `organization_id`, cómo
se numeran y evolucionan las migraciones, y cómo se impide que aparezca SQL
disperso a medida que crezcan los módulos.

Estas decisiones son difíciles de revertir. Un identificador numérico
autoincremental o un timestamp guardado como entero se propagan a cada tabla y
a cada contrato posterior, y cambiarlos después obliga a migrar datos ya
escritos por varias fases del roadmap. Conviene fijarlas una vez, antes de que
existan tablas que las hereden.

## Decisión

Toda tabla de D1 en este repositorio sigue estas convenciones.

### Identificadores y tipos

- Los identificadores son `TEXT` opacos, estables y sin significado. No
  codifican organización, permisos ni orden, y no se interpretan para
  autorizar.
- No se usan enteros autoincrementales como identidad pública.
- Los timestamps son `TEXT` con formato ISO 8601 en UTC, coherentes con los
  [contratos transversales](../architecture/contracts.md).
- Los conjuntos cerrados de valores se expresan con `CHECK` sobre columnas
  `TEXT`, no con enteros ni tablas de catálogo prematuras.

### Nomenclatura

- Tablas y columnas usan `snake_case`; los nombres de tabla son plurales.
- Los índices se nombran `<tabla>_<propósito>_idx` y los únicos
  `<tabla>_<propósito>_unique`.
- La conversión a `camelCase` ocurre en la capa de repositorios y en un único
  lugar; ninguna capa superior conoce nombres físicos de columna.

### Aislamiento por organización

- Toda tabla empresarial incluye `organization_id TEXT NOT NULL`.
- Todo índice de acceso a una tabla empresarial empieza por `organization_id`,
  de modo que una consulta sin filtro de organización no pueda apoyarse en él.
- La unicidad de un dato de origen externo se define **dentro** de la
  organización, no globalmente. Dos organizaciones pueden observar el mismo
  identificador externo sin colisionar.
- `organizations` es la única tabla raíz sin `organization_id`; su propia clave
  primaria cumple esa función.

### Migraciones

- Viven en `migrations/` con el patrón `NNNN_descripcion.sql`, numeración
  correlativa de cuatro dígitos.
- Son aditivas y aplicables desde una base vacía en orden.
- Una migración versionada no se edita ni se borra: un cambio posterior es
  siempre una migración nueva.
- El esquema físico crece con la capacidad que lo necesita. No se crean tablas
  para fases futuras del roadmap por adelantado.

### Acceso a datos

- El acceso a D1 ocurre solo dentro de `src/worker/repositories/`. Handlers,
  agentes y componentes de interfaz no escriben SQL.
- Un repositorio recibe `D1Database`, nunca el `Env` completo.
- Salvo el repositorio de organizaciones, cada método recibe `organizationId`
  como primer parámetro y lo incluye en su cláusula `WHERE`. Si el valor falta
  o está vacío, la operación falla de forma cerrada antes de consultar D1.
- Las sentencias usan siempre parámetros vinculados; no se interpola valor
  alguno en el texto SQL.
- Una fila que referencia a otra entidad empresarial verifica que esa entidad
  pertenece a la organización activa. Dos claves foráneas independientes hacia
  `organizations` y hacia la tabla referenciada no lo garantizan: cada una es
  válida por separado mientras la combinación cruza el límite de aislamiento.
  La verificación forma parte de la misma sentencia que escribe, para no dejar
  ventana entre comprobar e insertar.

### Secretos

D1 no almacena secretos. Las credenciales de proveedores viven en Cloudflare
Secrets y D1 solo puede guardar una referencia opaca y metadatos no sensibles,
conforme a [ADR-0002](./ADR-0002-d1-source-of-truth.md) y a la [propiedad de
datos](../architecture/data-ownership.md).

## Consecuencias

### Positivas

- El aislamiento multiempresa es verificable por construcción: falta de
  `organization_id` en una tabla o en un índice es un defecto detectable.
- Los identificadores opacos permiten cambiar la estrategia de generación sin
  tocar contratos ni migrar datos.
- La conversión de nomenclatura en un solo lugar evita que `snake_case` se
  filtre a la API, al agente o a la interfaz.
- Las pruebas de acceso cruzado tienen un sujeto concreto y pueden ejecutarse
  desde una base vacía en cada corrida.

### Costos y obligaciones

- Los timestamps `TEXT` obligan a comparar cadenas ISO y no admiten aritmética
  de fechas en SQL sin conversión explícita.
- Cada tabla empresarial nueva debe justificar su índice encabezado por
  `organization_id` aunque el volumen inicial no lo exija.
- Agregar una columna o una restricción requiere una migración nueva, incluso
  para correcciones menores.
- Los repositorios crecen en superficie: cada consulta nueva necesita un método
  en vez de SQL puntual en el handler.
- Mientras el esquema exprese la pertenencia con claves foráneas
  independientes, la invariante depende del repositorio. Una clave foránea
  compuesta hacia `(organization_id, id)` la trasladaría al motor, a costa de
  recrear tablas en SQLite; se evaluará cuando una capacidad posterior toque
  esas tablas.
- Estas convenciones aplican al esquema de D1. El almacenamiento SQLite interno
  de un Durable Object se rige por [ADR-0003](./ADR-0003-conversation-agent.md).

## Alternativas consideradas

- **Identificadores enteros autoincrementales:** rechazada porque revelan
  volumen y orden de creación, invitan a inferir pertenencia desde el valor y
  contradicen la regla de identificadores opacos del modelo de dominio.
- **Timestamps numéricos (epoch):** rechazada porque obligaría a convertir en
  cada frontera de contrato, donde ya se acordó ISO 8601 en UTC.
- **Definir el esquema completo del CRM en la primera migración:** rechazada
  porque anticipa esquema físico de fases sin issue ni decisión vigentes, y
  fija restricciones antes de conocer el comportamiento que deben soportar.
- **Permitir acceso directo a `env.DB` desde handlers y agentes:** rechazada
  porque dispersa el filtro por organización en cada punto de uso y elimina el
  único lugar donde el aislamiento puede auditarse.
- **Unicidad global de identidades externas:** rechazada porque impediría que
  dos organizaciones atiendan al mismo número de teléfono o cuenta externa, un
  caso real en un producto multiempresa.

## Referencias

- [ADR-0002: D1 como fuente de verdad empresarial](./ADR-0002-d1-source-of-truth.md)
- [ADR-0003: Runtime durable por conversación](./ADR-0003-conversation-agent.md)
- [Modelo de dominio](../architecture/domain-model.md)
- [Propiedad y ciclo de vida de los datos](../architecture/data-ownership.md)
- [Contratos transversales](../architecture/contracts.md)
- [Issue #5](https://github.com/LuisVR391/agent-cloudflare/issues/5)
- [Migraciones de D1](https://developers.cloudflare.com/d1/reference/migrations/)
