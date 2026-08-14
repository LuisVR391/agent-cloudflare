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
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import {
  listPipelineOpportunities,
  listPipelines,
  updateOpportunity,
  type Opportunity,
  type Pipeline,
  type StageColor,
} from "@/lib/api";

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
 * Tablero del pipeline comercial: una columna por etapa y una tarjeta por
 * oportunidad. Mover una tarjeta usa un menú en vez de arrastre, para que la
 * acción sea alcanzable con teclado y verificable en pruebas.
 *
 * El movimiento viaja con la versión de la oportunidad: si otra persona la
 * movió mientras tanto, el backend responde conflicto y la vista se recarga.
 *
 * Renombrar, recolorear, reordenar y borrar etapas existe en `/api/pipelines`
 * y todavía no tiene interfaz.
 */
export function PipelineBoard() {
  const panel = useOutletContext<PanelContext>();
  const permissions = panel.activeOrganization.permissions;
  const canRead = permissions.includes("pipelines.read");
  const canReadOpportunities = permissions.includes("opportunities.read");
  const canMove = permissions.includes("opportunities.manage");

  const [pipelines, setPipelines] = useState<Pipeline[]>([]);
  const [opportunities, setOpportunities] = useState<Opportunity[]>([]);
  const [truncated, setTruncated] = useState(false);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        const loaded = await listPipelines();
        setPipelines(loaded);
        const first = loaded.at(0);
        if (first && canReadOpportunities) {
          const page = await listPipelineOpportunities(first.id);
          setOpportunities(page.opportunities);
          setTruncated(page.truncated);
        }
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "No fue posible cargar el pipeline.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [canRead, canReadOpportunities]);

  async function move(opportunity: Opportunity, stageId: string) {
    if (stageId === opportunity.stageId) return;
    setError(null);
    try {
      await updateOpportunity(opportunity.id, {
        expectedVersion: opportunity.version,
        stageId,
      });
      const page = await listPipelineOpportunities(opportunity.pipelineId);
      setOpportunities(page.opportunities);
      setTruncated(page.truncated);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible mover la oportunidad.",
      );
    }
  }

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
          {pipeline.stages.map((stage) => {
            const cards = opportunities.filter(
              (opportunity) => opportunity.stageId === stage.id,
            );
            return (
              <section
                aria-label={stage.name}
                className="flex w-64 shrink-0 flex-col gap-3 rounded-xl border bg-card p-4"
                key={stage.id}
              >
                <div className="flex items-center justify-between gap-2">
                  <h2 className="truncate text-sm font-medium">{stage.name}</h2>
                  <Badge variant={stageVariants[stage.color]}>
                    {cards.length}
                  </Badge>
                </div>
                {cards.length === 0 ? (
                  <p className="text-sm text-muted-foreground">
                    Sin oportunidades todavía.
                  </p>
                ) : null}
                {cards.map((opportunity) => (
                  <article
                    className="flex flex-col gap-2 rounded-lg border p-3"
                    key={opportunity.id}
                  >
                    <p className="truncate text-sm font-medium">
                      {opportunity.contactDisplayName ?? "Contacto sin nombre"}
                    </p>
                    <p className="truncate text-xs text-muted-foreground">
                      {opportunity.serviceName ?? "Sin servicio identificado"}
                    </p>
                    {canMove ? (
                      <DropdownMenu>
                        <DropdownMenuTrigger asChild>
                          <Button
                            aria-label={`Mover ${
                              opportunity.contactDisplayName ?? "la oportunidad"
                            }`}
                            size="sm"
                            variant="outline"
                          >
                            Mover
                          </Button>
                        </DropdownMenuTrigger>
                        <DropdownMenuContent align="start" className="w-56">
                          <DropdownMenuRadioGroup
                            onValueChange={(value) => void move(opportunity, value)}
                            value={opportunity.stageId}
                          >
                            {pipeline.stages.map((target) => (
                              <DropdownMenuRadioItem
                                key={target.id}
                                value={target.id}
                              >
                                {target.name}
                              </DropdownMenuRadioItem>
                            ))}
                          </DropdownMenuRadioGroup>
                        </DropdownMenuContent>
                      </DropdownMenu>
                    ) : null}
                  </article>
                ))}
              </section>
            );
          })}
        </div>
      )}

      {truncated ? (
        <p className="text-sm text-muted-foreground">
          El tablero muestra las oportunidades más recientes; hay más de las que
          caben en esta vista.
        </p>
      ) : null}
    </div>
  );
}
