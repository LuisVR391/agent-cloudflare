import { Target } from "lucide-react";
import { useEffect, useState } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
  SheetTrigger,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createOpportunity,
  listContactOpportunities,
  listServices,
  type Opportunity,
  type Service,
} from "@/lib/api";

const NO_SERVICE = "sin-servicio";

/**
 * Oportunidades del contacto, abiertas desde la conversación. Una conversación
 * puede producir ninguna, una o varias a lo largo del tiempo, y sigue siendo el
 * hilo de atención: por eso el panel lista las que existen antes de ofrecer
 * crear otra (ADR-0010).
 *
 * La oportunidad nace en la primera etapa del pipeline y conserva la
 * conversación que la originó.
 */
export function OpportunitySheet({
  contactId,
  conversationId,
  canManage,
}: {
  contactId: string;
  conversationId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [opportunities, setOpportunities] = useState<Opportunity[] | null>(null);
  const [services, setServices] = useState<Service[]>([]);
  const [serviceId, setServiceId] = useState<string>(NO_SERVICE);
  const [creating, setCreating] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setOpportunities(null);
    setError(null);
    void (async () => {
      try {
        setOpportunities(await listContactOpportunities(contactId));
        if (canManage) setServices(await listServices("active"));
      } catch (caught) {
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las oportunidades.",
        );
      }
    })();
  }, [canManage, contactId, open]);

  async function create() {
    setCreating(true);
    setError(null);
    try {
      await createOpportunity({
        contactId,
        conversationId,
        serviceId: serviceId === NO_SERVICE ? null : serviceId,
      });
      setOpportunities(await listContactOpportunities(contactId));
      setServiceId(NO_SERVICE);
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible crear la oportunidad.",
      );
    } finally {
      setCreating(false);
    }
  }

  const selectedService = services.find((service) => service.id === serviceId);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <Target aria-hidden="true" />
          Oportunidad
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Oportunidades del contacto</SheetTitle>
          <SheetDescription>
            Resolver la conversación no cierra una oportunidad: son estados
            distintos y ninguno arrastra al otro.
          </SheetDescription>
        </SheetHeader>
        <div className="flex flex-col gap-4 px-4 pb-6">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>No pudimos completar la acción</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}

          {opportunities === null && !error ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ) : null}

          {opportunities?.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Este contacto todavía no tiene oportunidades.
            </p>
          ) : null}

          {opportunities?.map((opportunity) => (
            <div
              className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0"
              key={opportunity.id}
            >
              <div className="min-w-0">
                <p className="truncate font-medium">{opportunity.stageName}</p>
                <p className="truncate text-sm text-muted-foreground">
                  {opportunity.serviceName ?? "Sin servicio identificado"}
                </p>
              </div>
              <Badge variant="secondary">{opportunity.stagePosition}</Badge>
            </div>
          ))}

          {canManage ? (
            <div className="flex flex-col gap-3 rounded-xl border border-dashed p-4">
              <Field>
                <FieldLabel htmlFor="opportunityService">Servicio</FieldLabel>
                <DropdownMenu>
                  <DropdownMenuTrigger asChild>
                    <Button
                      className="w-full justify-between"
                      id="opportunityService"
                      type="button"
                      variant="outline"
                    >
                      {selectedService?.name ?? "Sin servicio identificado"}
                    </Button>
                  </DropdownMenuTrigger>
                  <DropdownMenuContent align="start" className="w-56">
                    <DropdownMenuRadioGroup
                      onValueChange={setServiceId}
                      value={serviceId}
                    >
                      <DropdownMenuRadioItem value={NO_SERVICE}>
                        Sin servicio identificado
                      </DropdownMenuRadioItem>
                      {services.map((service) => (
                        <DropdownMenuRadioItem key={service.id} value={service.id}>
                          {service.name}
                        </DropdownMenuRadioItem>
                      ))}
                    </DropdownMenuRadioGroup>
                  </DropdownMenuContent>
                </DropdownMenu>
                <FieldDescription>
                  Puedes identificarlo después, cuando la conversación lo aclare.
                </FieldDescription>
              </Field>
              <Button
                className="self-start"
                disabled={creating}
                onClick={() => void create()}
                type="button"
              >
                {creating ? "Creando…" : "Crear oportunidad"}
              </Button>
            </div>
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
