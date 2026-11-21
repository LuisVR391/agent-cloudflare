---
name: pendientes-agent-cloudflare
description: Mantiene Notion e issues de Agent Cloudflare alineados. Úsalo al registrar un pendiente, empezar trabajo aprobado o conciliar una entrega fusionada.
---

# Pendientes de Agent Cloudflare

Usa la [tabla de pendientes](https://app.notion.com/p/41fdb9dbd4118185a0a6fead768cd9b4)
y [GitHub](https://github.com/LuisVR391/agent-cloudflare/issues). Localiza una
tarjeta por su URL, issue o coincidencia clara de título y alcance antes de
crearla o editarla. Lee el esquema de Notion antes de escribir.

- **Pendiente dictado** · Registra alcance y dependencias en `Nombre` y el
  cuerpo de una tarjeta `Sin empezar`. Reutiliza la tarjeta existente.
- **Trabajo autorizado** · Crea o reutiliza el issue de Agent Cloudflare.
  Enlaza la tarjeta desde el issue y rellena `GitHub` con el issue. Marca
  `En curso`. Documenta los acuerdos que cambien el alcance o las dependencias.
- **Después de fusionar** · Confirma el PR, su SHA, la validación requerida y
  el cierre del issue. Marca `Listo` si se completó todo el alcance. Revisa las
  tarjetas `Sin empezar` o `En curso` afectadas por la fusión y corrige solo
  los datos o dependencias que cambiaron. Conserva el contenido de las tarjetas
  `Listo`.

Relee la tarjeta después de escribir. Si una escritura queda incierta,
verifica el estado antes de reintentar y corrige únicamente lo pendiente.
Reporta la sincronización pendiente si el acceso, el alcance o la evidencia
impiden confirmarla.
