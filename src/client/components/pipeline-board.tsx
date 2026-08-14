import { KanbanSquare } from "lucide-react";
import { useEffect, useState } from "react";
import { useOutletContext } from "react-router";

import type { PanelContext } from "@/components/panel-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Skeleton } from "@/components/ui/skeleton";
import { listPipelines, type Pipeline, type StageColor } from "@/lib/api";

/**
 * El color de la etapa es un token semántico, no una clase: aquí se traduce a
 * una variante del componente para que el tema siga decidiendo el color
 * (ADR-0009).
 */
const stageVariants: Record<
  StageColor,
  "default" | "secondary" | "destructive" | "outline"
> = {
  neutral: "secondary",
  info: "default",
  success: "default",
  warning: "outline",
  danger: "destructive",
};

/**
 * Tablero del pipeline comercial. Este corte muestra las etapas configuradas y
 * su orden; las oportunidades que las recorren llegan en el corte siguiente del
 * mismo entregable, así que cada columna se anuncia vacía en vez de fingir
 * contenido.
 *
 * Renombrar, recolorear, reordenar y borrar etapas existe en `/api/pipelines`
 * y todavía no tiene interfaz.
 */
export function PipelineBoard() {
  const panel = useOutletContext<PanelContext>();
  const canRead = panel.activeOrganization.permissions.includes("pipelines.read");

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        setPipelines(await listPipelines());
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "No fue posible cargar el pipeline.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [canRead]);

  if (!canRead) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <KanbanSquare />
          </EmptyMedia>
          <EmptyTitle>No tienes acceso al pipeline</EmptyTitle>
          <EmptyDescription>
            Pide a quien administra tu organización que te conceda la lectura del
            pipeline.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  const pipeline = pipelines.at(0) ?? null;

  return (
    <div className="flex min-h-0 flex-1 flex-col gap-6 overflow-y-auto p-4 sm:p-6">
      <header>
        <h1 className="text-2xl font-semibold tracking-tight">
          {pipeline ? pipeline.name : "Pipeline"}
        </h1>
        <p className="mt-1 text-sm text-muted-foreground">
          Las etapas por las que avanza una oportunidad en{" "}
          {panel.activeOrganization.organizationName}. Se configuran por
          organización: cambiar de giro no bifurca el producto.
        </p>
      </header>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No pudimos cargar el pipeline</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {loading ? (
        <div className="flex gap-4">
          {[0, 1, 2].map((column) => (
            <Skeleton className="h-40 w-64 shrink-0" key={column} />
          ))}
        </div>
      ) : pipeline === null || pipeline.stages.length === 0 ? (
        <Empty>
          <EmptyHeader>
            <EmptyMedia variant="icon">
              <KanbanSquare />
            </EmptyMedia>
            <EmptyTitle>Todavía no hay etapas</EmptyTitle>
            <EmptyDescription>
              El pipeline inicial se crea al instalar la organización. Si no
              aparece, revisa la configuración con quien administra.
            </EmptyDescription>
          </EmptyHeader>
        </Empty>
      ) : (
        <div className="flex gap-4 overflow-x-auto pb-2">
          {pipeline.stages.map((stage) => (
            <section
              aria-label={stage.name}
              className="flex w-64 shrink-0 flex-col gap-3 rounded-xl border bg-card p-4"
              key={stage.id}
            >
              <div className="flex items-center justify-between gap-2">
                <h2 className="truncate text-sm font-medium">{stage.name}</h2>
                <Badge variant={stageVariants[stage.color]}>
                  {stage.position}
                </Badge>
              </div>
              <p className="text-sm text-muted-foreground">
                Sin oportunidades todavía.
              </p>
            </section>
          ))}
        </div>
      )}
    </div>
  );
}
