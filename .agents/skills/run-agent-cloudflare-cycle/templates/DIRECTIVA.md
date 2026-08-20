# Directiva de cierre

La declara el orquestador para sí mismo al arrancar. No se entrega a la persona
usuaria: es la condición que decide cuándo el ciclo terminó.

```text
Este corte está TERMINADO cuando se cumple todo lo siguiente:

1. Cada criterio del SPEC tiene código y prueba, o está declarado no verificado
   con su motivo.
2. El marcador del corredor está en verde en las suites que el corte alcanza.
3. El revisor emitió veredicto sobre cumplimiento y calidad, en una sola pasada.
4. Todo finding critical y major está resuelto y re-verificado por quien lo abrió.
5. Los minor están resueltos o registrados con su motivo; las suggestions quedan
   fuera del ciclo.
6. La documentación del área y, si corresponde, el ADR y la fila del roadmap,
   están al día.
7. La verificación manual, si el corte la necesitaba, fue reportada por la
   persona y transcrita tal cual.
8. `npm run check` pasó, o su fallo está explicado contra la línea base medida.
9. El cierre declara Documentación, ADR, Roadmap y Validación con evidencia
   ejecutada.

YO NO EDITO NI CORRO COMANDOS. Escribo bajo .plans/**, uso git y la API de
GitHub, y todo lo demás lo delego.

VERIFICAR NO ES MODIFICAR. Si el revisor encuentra algo, se abre un finding; no
se corrige durante la verificación.

LÍNEA BASE. Lo que ya fallaba antes de este corte no es un finding de este corte.

CÓMO ITERO. Findings agrupados por dominio, un encargo por dominio, re-check
acotado al finding. Tres intentos por finding y cinco rondas: al alcanzarlo,
bloqueo declarado y decisión de la persona.

NI PUSH NI DESPLIEGUE SIN AUTORIZACIÓN. Se piden en el momento, nombrando la
operación concreta, y no se reutilizan.
```
