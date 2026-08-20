---
feature: <Nombre del corte>
slug: <issue-00-tema>
issue: <número o vacío>
rama: <rama que lo implementa>
estado: activo
fecha: <AAAA-MM-DD>
---

# <Nombre del corte>

## Objetivo

<!-- Qué queda resuelto cuando esto termina, en una o dos frases. -->

## Alcance

### Incluido

<!-- Lo que este corte entrega. -->

### Fuera de alcance

<!-- Lo que explícitamente no entrega, para que nadie lo dé por hecho. -->

## Estado actual

<!-- Qué existe hoy en el código, con archivos concretos. No lo que dice el
roadmap: lo que está implementado. -->

## Flujos

<!-- Qué ocurre de extremo a extremo, desde el disparador hasta el efecto. -->

## Worker

<!-- Rutas, repositorios, dominio, colas, Durable Object e integraciones que
cambian. -->

## Cliente

<!-- Pantallas, componentes y estados. Marca «no aplica» si el corte no toca la
interfaz. -->

## D1 y migraciones

<!-- Tablas, columnas, índices y la migración nueva. Qué pasa con las filas que
ya existen. Marca «no aplica» si no toca persistencia. -->

## Bindings y entornos

<!-- Bindings que se consumen y cualquier recurso que no exista todavía en un
entorno. Un recurso nuevo es una decisión sensible. -->

## Aislamiento y permisos

<!-- Cómo se deriva la organización, qué permiso exige cada acción y qué
devuelve el sistema cuando falta. -->

## Contratos e idempotencia

<!-- Schemas de validación, clave de idempotencia, correlationId y
compatibilidad con lo que ya existe. -->

## Reglas de negocio

<!-- Lo que respondió la persona en las decisiones D y E, literal. -->

## Decisiones técnicas

<!-- Una línea por decisión. Las de tipo C llevan «Alternativa descartada» y su
motivo. -->

## Supuestos

<!-- S-01, S-02… Cada supuesto dice qué criterios dependen de él. -->

## Riesgos

<!-- Qué puede salir mal y qué lo contiene. -->

## Estrategia de pruebas

<!-- Qué se prueba, dónde vive cada prueba y cuál es la LÍNEA BASE medida: qué
falla ya antes de empezar. -->

## Criterios de aceptación

<!-- Actor + acción + resultado observable + verificación. Sin checkbox: el SPEC
es contrato, no tablero. -->

- AC-01 · <criterio>
  Verificación: <prueba, comando o paso observable>

## Comandos de verificación

<!-- Solo comandos que no escriben. -->

```bash
```

## Impacto declarado

- Documentación: <archivos, o «no aplica — motivo concreto»>
- ADR: <decisión registrada o sustituida, o «no aplica — motivo concreto»>
- Roadmap: <fila y evidencia, o «no aplica — motivo concreto»>
- Validación: <se completa al cierre con lo que realmente se ejecutó>
