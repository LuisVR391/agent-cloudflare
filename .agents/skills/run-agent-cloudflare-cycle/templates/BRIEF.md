# Encargos a un subagente

Un encargo prescriptivo se reconoce porque quien lo recibe no necesita decidir
qué entra en el corte. Si el subagente tiene que interpretar el alcance, el
encargo está incompleto.

## IMPLEMENT

```text
SPEC: .plans/<slug>/SPEC.md
Criterios asignados: AC-03, AC-04
Tarea del tablero: <título de la tarea>

Implementa solo esos criterios y escribe también sus pruebas.

Restricciones de este corte:
- <lo que no se toca>
- <la decisión ya cerrada que no se reabre>

Si te falta un dato de otro dominio, pídelo con SendMessage a `main` en vez de
suponerlo.

Devuelve un informe telegráfico de unas quince líneas: qué criterio quedó
implementado y dónde, qué prueba lo demuestra, qué comandos corriste y su
resultado, qué decidiste que el SPEC no fijaba, y qué necesitas.
```

## FIX

```text
SPEC: .plans/<slug>/SPEC.md
Findings: .plans/<slug>/FINDINGS.md

Corrige SOLO F-04 y F-06, en ese orden de severidad.

No toques otros archivos, no refactorices de paso, no implementes ninguna
suggestion y no amplíes el alcance del corte.

Devuelve, por finding: qué lo causaba, qué cambiaste y con qué lo comprobaste.
```

## Al corredor

```text
Corre: npm run test:worker && npm run test:client

Devuelve SOLO el marcador. Si algo falla, añade una línea por prueba fallida,
hasta diez, y di cuántas quedan fuera.
```

## Al revisor

```text
SPEC: .plans/<slug>/SPEC.md
Criterios a verificar: AC-01 a AC-07
Diff: git diff main...HEAD
Marcador del corredor: <lo que devolvió>
Línea base: <lo que ya fallaba antes del corte>

Numera tus findings desde F-07.

No escribes FINDINGS.md: devuelves los findings y yo los registro.
```
