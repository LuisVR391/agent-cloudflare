---
name: deliver-agent-cloudflare-change
description: Implementa, corrige, refactoriza o publica cambios en Agent Cloudflare con alcance, seguridad, pruebas, documentación, ADRs y roadmap verificables. Úsalo para trabajo de código, configuración, migraciones, arquitectura, documentación técnica o entrega por issue/PR; no lo uses para preguntas informativas que no modifican el repositorio.
---

# Entregar un cambio de Agent Cloudflare

Mantén la implementación y su evidencia alineadas con las fuentes de verdad del
repositorio. Este skill organiza el trabajo; no sustituye las reglas ni duplica
la arquitectura.

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

Si falta una decisión que cambiaría materialmente el resultado, detente y
solicita dirección. No inventes recursos, contratos ni backlog de fases futuras.

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
- Vincula el PR al issue con `Closes #<número>` cuando corresponda.
- Incluye alcance, riesgos, operaciones externas pendientes y las cuatro
  declaraciones de impacto.
- Espera el CI y reporta su resultado.
- No fusiones ni despliegues sin autorización explícita.

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
