---
name: deliver-agent-cloudflare-change
description: Implementa y verifica cambios de Agent Cloudflare. Úsalo para preparar un cambio del repositorio, revisar un PR o validar un despliegue.
---

# Entregar un cambio de Agent Cloudflare

1. Lee [AGENTS.md](../../../AGENTS.md) y el contexto técnico del área. Acota el
   cambio y sus pruebas. Si empiezas trabajo autorizado, vincula tarjeta e issue
   con el [skill de pendientes](../pendientes-agent-cloudflare/SKILL.md).
2. Actualiza las fichas de `.docs/` afectadas junto con la implementación.
   Registra un ADR solo si cambia una decisión arquitectónica y ajusta el
   roadmap si cambia un entregable.
3. Ejecuta `npm run check`, la verificación específica y `git diff --check`.
   Revisa el diff y registra la evidencia real. Antes de fusionar, revisa
   el último SHA y confirma el resultado del CI de ese candidato.
4. Usa el [runbook de entrega](../../../.docs/operations/entrega.md) y las
   autorizaciones de `AGENTS.md` para operaciones remotas. El PR lleva
   `Documentación`, `ADR`, `Roadmap` y `Validación` con resultados o un motivo
   concreto si una sección no aplica.
5. Antes de publicar en staging revisa el diff desde la versión activa y
   aplica el [runbook de Cloudflare](../../../.docs/operations/environments.md).
   Tras una fusión confirmada, concilia las tarjetas afectadas.
