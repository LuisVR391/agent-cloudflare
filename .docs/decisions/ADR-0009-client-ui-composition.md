# ADR-0009: Composición de la interfaz de cliente con primitivas de shadcn/ui

**Estado:** Aceptado

**Fecha:** 2026-08-12

## Contexto

La interfaz de cliente se declaró como proyecto shadcn/ui desde su
configuración —`components.json`, Tailwind v4, base `radix`, iconos `lucide`—,
pero solo seis componentes del registro estaban instalados. El shell del panel y
el hilo de conversaciones se componían con `div` y clases de Tailwind escritas a
mano, y eso produjo defectos que el markup propio no podía evitar:

- El sidebar era un `aside` con `lg:min-h-screen`, así que participaba del scroll
  del documento y desaparecía al recorrer una conversación larga.
- La lista del inbox crecía sin scroll propio y arrastraba al resto del panel.
- El hilo no seguía el borde al llegar un mensaje nuevo porque no había anclaje
  ni control de desplazamiento.
- El estado de entrega se pintaba con clases de color crudas
  (`text-red-200`, `text-amber-200`) en vez de tokens del tema.
- El estado activo de la navegación derivaba de un flag de disponibilidad y no
  de la sección abierta, así que varias secciones se veían activas a la vez.

No existía ninguna decisión registrada sobre cómo se compone la interfaz, de modo
que cada pantalla podía resolver estos problemas por su cuenta. La única regla
vigente estaba en la skill `shadcn` del repositorio, que ya exigía componer con
las primitivas del registro, pero sin respaldo arquitectónico.

## Decisión

La interfaz de cliente se compone con las primitivas del registro de shadcn/ui.
Cuando existe un componente del registro para una necesidad, se usa ese
componente en vez de markup propio equivalente.

Esto fija tres cosas concretas:

1. **El shell del panel** es `SidebarProvider` + `Sidebar variant="inset"` +
   `SidebarInset`. El shell acota la altura de la ventana y no scrollea: cada
   sección resuelve su propio desplazamiento con contenedores acotados. La
   sección activa se deriva de la URL mediante rutas hijas de `/app`, nunca de
   estado local.
2. **El hilo de conversación** usa `MessageScroller` para el desplazamiento
   anclado y el salto al último mensaje, `Message` para la fila, `Bubble` para la
   superficie, `Attachment` para los archivos y `Marker` para separadores y notas
   del sistema. No se implementan contenedores de scroll, lógica de
   stick-to-bottom ni burbujas propias.
3. **El color y el estado** se expresan con tokens del tema y variantes de
   componente. Los indicadores de estado usan variantes de `Badge`, no clases de
   color crudas. El sidebar conserva su contraste oscuro mediante los tokens
   `--sidebar-*` en `src/client/styles.css`, no con clases incrustadas en el JSX.

Esta decisión acepta dos dependencias de paquete que las primitivas requieren:

- `@shadcn/react`, dependencia de runtime del bundle del cliente que aporta el
  comportamiento del scroller.
- `shadcn`, dependencia de build cuyo `tailwind.css` se importa para aportar las
  utilidades que los componentes dan por hechas (`shimmer`, `scroll-fade-*`).

Ambas quedan fijadas a una versión exacta: `@shadcn/react` es pre-1.0 y el
contenido de `shadcn` cambia con el CLI.

El modo oscuro queda fuera de esta decisión. El proyecto declara el variant
`dark` pero no define un tema oscuro, así que los tokens `--sidebar-*` son
oscuros en el único tema existente. Habilitarlo requiere definir el juego
completo de tokens y es trabajo aparte.

Esta decisión gobierna la superficie de cliente. No modifica la arquitectura del
producto, la propiedad de datos ni ninguna decisión de ADR-0001 a ADR-0008, y no
altera qué expone el backend más allá del campo aditivo `filename` en el
historial de mensajes.

## Consecuencias

### Positivas

- El comportamiento de layout y scroll deja de reinventarse por pantalla: el
  sidebar fijo y los paneles con desplazamiento propio son propiedad del
  componente, no de clases repetidas.
- El tema se cambia en un solo lugar porque ningún componente incrusta color.
- Las secciones futuras del panel heredan el shell, la navegación y el estado
  activo sin volver a decidirlos.
- La skill `shadcn` del repositorio y esta decisión dicen lo mismo, así que un
  agente y una persona llegan al mismo resultado.

### Costos y obligaciones

- El bundle del cliente crece: entra `@shadcn/react` y Tailwind genera las
  utilidades de todos los componentes instalados.
- Actualizar un componente del registro es un diff a revisar, no una operación
  automática. El CLI reinstala dependencias de registro ya presentes, así que
  cada actualización exige revisar `button`, `input` y `separator`.
- Los componentes traen clases `dark:` que no se activan mientras no exista tema
  oscuro, y clases de utilidad que el proyecto no define
  (`scrollbar-thin`, `scrollbar-none`): son inertes, no errores, y no se
  corrigen editando el componente del registro.
- Las pruebas de cliente dependen de APIs de layout que jsdom no implementa
  (`matchMedia`, `ResizeObserver`, `scrollTo`), declaradas una vez en
  `test/client/setup.ts`.
- `BreadcrumbPage` expone `role="link"`, así que una consulta por rol en pruebas
  debe acotarse al menú del sidebar.

## Alternativas consideradas

- **Corregir solo el scroll del sidebar:** rechazada porque deja el resto del
  layout artesanal y no evita que el próximo panel repita el mismo defecto. El
  bug reportado era un síntoma, no la causa.
- **Descargar los bloques `sidebar-08` y `sidebar-09` tal cual:** rechazada
  porque sus archivos apuntan a `app/dashboard/page.tsx` del App Router y este
  proyecto es un SPA con `react-router`. Se replica su composición sobre las
  mismas primitivas.
- **Anidar un segundo `Sidebar` para la lista de conversaciones, como el bloque
  `sidebar-09`:** rechazada porque haría que la navegación del panel cambiara de
  forma al abrir Conversaciones. La lista es un panel de la sección, no parte del
  chrome de la aplicación.
- **Escribir las utilidades `shimmer` y `scroll-fade-*` a mano:** rechazada
  porque duplica CSS que el paquete ya publica y que las reglas de estilo
  prohíben reimplementar.
- **Habilitar el modo oscuro en el mismo cambio:** rechazada por alcance. Exige
  el juego completo de tokens y una decisión de producto sobre cómo se activa.

## Referencias

- [Reglas compartidas](../../AGENTS.md)
- [Inbox y handoff humano](../modules/inbox-and-handoff.md)
- [Continuidad de agentes de codificación](../operations/agent-continuity.md)
- [ADR-0005: Núcleo neutral de guardrails](./ADR-0005-shared-agent-guardrails.md)
- [ADR-0007: Better Auth y contexto organizacional](./ADR-0007-better-auth-and-organization-context.md)
