import { Scissors } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";
import { useOutletContext } from "react-router";

import type { PanelContext } from "@/components/panel-shell";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import { Field, FieldDescription, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import {
  createService,
  listServices,
  updateService,
  type Service,
} from "@/lib/api";

const DEFAULT_CURRENCY = "MXN";

type PriceDraft = { amount: string; currency: string };

const emptyDraft = {
  name: "",
  duration: "60",
  price: { amount: "", currency: DEFAULT_CURRENCY } satisfies PriceDraft,
};

/**
 * El importe se persiste en la unidad menor de la moneda, así que lo escrito
 * se redondea a centavos aquí. Un campo vacío significa «sin precio», no cero:
 * un servicio sin tarifa publicada es distinto de uno gratuito.
 */
function parsePrice(draft: PriceDraft): { amountCents: number; currency: string } | null {
  const amount = draft.amount.trim();
  if (amount === "") return null;
  const parsed = Number(amount.replace(",", "."));
  if (!Number.isFinite(parsed) || parsed < 0) return null;
  return {
    amountCents: Math.round(parsed * 100),
    currency: draft.currency.trim().toUpperCase(),
  };
}

function formatPrice(service: Service): string {
  if (service.priceAmountCents === null || service.priceCurrency === null) {
    return "Sin precio publicado";
  }
  try {
    return new Intl.NumberFormat(undefined, {
      style: "currency",
      currency: service.priceCurrency,
    }).format(service.priceAmountCents / 100);
  } catch {
    // Una moneda que el navegador no reconoce no debe romper la lista.
    return `${(service.priceAmountCents / 100).toFixed(2)} ${service.priceCurrency}`;
  }
}

function formatDuration(minutes: number): string {
  if (minutes < 60) return `${minutes} min`;
  const hours = Math.floor(minutes / 60);
  const rest = minutes % 60;
  return rest === 0 ? `${hours} h` : `${hours} h ${rest} min`;
}

/**
 * Catálogo de servicios de la organización. Leerlo exige `services.read`, que
 * tienen los tres roles porque quien atiende necesita saber qué ofrece la
 * empresa; editarlo exige `services.manage`. El backend vuelve a comprobarlo en
 * cada petición: esta condición solo evita mostrar acciones que serían
 * rechazadas.
 */
export function ServiceCatalog() {
  const panel = useOutletContext<PanelContext>();
  const permissions = panel.activeOrganization.permissions;
  const canRead = permissions.includes("services.read");
  const canManage = permissions.includes("services.manage");

  const [services, setServices] = useState<Service[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [editing, setEditing] = useState<Service | null>(null);
  const [draft, setDraft] = useState(emptyDraft);
  const [saving, setSaving] = useState(false);

  // Quien administra ve también los archivados, para poder reactivarlos.
  const scope = canManage ? "all" : "active";

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        setServices(await listServices(scope));
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "No fue posible cargar los servicios.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [canRead, scope]);

  function startEditing(service: Service) {
    setEditing(service);
    setError(null);
    setDraft({
      name: service.name,
      duration: String(service.durationMinutes),
      price: {
        amount:
          service.priceAmountCents === null
            ? ""
            : (service.priceAmountCents / 100).toFixed(2),
        currency: service.priceCurrency ?? DEFAULT_CURRENCY,
      },
    });
  }

  function cancelEditing() {
    setEditing(null);
    setDraft(emptyDraft);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const duration = Number(draft.duration);
    if (!Number.isInteger(duration) || duration < 1) {
      setError("La duración debe ser un número de minutos mayor que cero.");
      return;
    }
    setSaving(true);
    setError(null);
    try {
      if (editing) {
        await updateService(editing.id, {
          expectedVersion: editing.version,
          name: draft.name.trim(),
          durationMinutes: duration,
          price: parsePrice(draft.price),
        });
      } else {
        await createService({
          name: draft.name.trim(),
          durationMinutes: duration,
          price: parsePrice(draft.price),
        });
      }
      setServices(await listServices(scope));
      cancelEditing();
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible guardar el servicio.",
      );
    } finally {
      setSaving(false);
    }
  }

  async function toggleStatus(service: Service) {
    setError(null);
    try {
      await updateService(service.id, {
        expectedVersion: service.version,
        status: service.status === "active" ? "archived" : "active",
      });
      setServices(await listServices(scope));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible actualizar el servicio.",
      );
    }
  }

  if (!canRead) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Scissors />
          </EmptyMedia>
          <EmptyTitle>No tienes acceso al catálogo</EmptyTitle>
          <EmptyDescription>
            Pide a quien administra tu organización que te conceda la lectura de
            los servicios.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Servicios</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Lo que ofrece {panel.activeOrganization.organizationName}, con su
            duración y su precio. Califica una oportunidad y reservará tiempo en
            la agenda.
          </p>
        </header>

        {error ? (
          <Alert variant="destructive">
            <AlertTitle>No pudimos completar la acción</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        ) : null}

        <Card>
          <CardHeader>
            <CardTitle>Catálogo</CardTitle>
            <CardDescription>
              Un servicio no se borra: se archiva, para que las citas y las
              oportunidades que lo mencionan sigan explicando qué se vendió.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {loading ? (
              [0, 1].map((row) => (
                <div className="flex flex-col gap-2" key={row}>
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : services.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no hay servicios registrados.
              </p>
            ) : (
              services.map((service) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0 last:pb-0"
                  key={service.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{service.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {formatDuration(service.durationMinutes)} · {formatPrice(service)}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {service.status === "archived" ? (
                      <Badge variant="outline">Archivado</Badge>
                    ) : null}
                    {canManage ? (
                      <>
                        <Button
                          onClick={() => startEditing(service)}
                          size="sm"
                          variant="outline"
                        >
                          Editar
                        </Button>
                        <Button
                          onClick={() => void toggleStatus(service)}
                          size="sm"
                          variant="outline"
                        >
                          {service.status === "active" ? "Archivar" : "Reactivar"}
                        </Button>
                      </>
                    ) : null}
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>
                {editing ? `Editar ${editing.name}` : "Agregar un servicio"}
              </CardTitle>
              <CardDescription>
                El precio es opcional. Si lo declaras, viaja con su moneda: un
                importe sin moneda no significa nada.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={submit}>
                <Field>
                  <FieldLabel htmlFor="serviceName">Nombre</FieldLabel>
                  <Input
                    autoComplete="off"
                    id="serviceName"
                    maxLength={120}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, name: event.target.value }))
                    }
                    placeholder="Corte y peinado"
                    required
                    value={draft.name}
                  />
                </Field>
                <Field>
                  <FieldLabel htmlFor="serviceDuration">Duración en minutos</FieldLabel>
                  <Input
                    id="serviceDuration"
                    inputMode="numeric"
                    max={1440}
                    min={1}
                    onChange={(event) =>
                      setDraft((current) => ({ ...current, duration: event.target.value }))
                    }
                    required
                    type="number"
                    value={draft.duration}
                  />
                  <FieldDescription>
                    Es el tiempo que la agenda reservará para la cita.
                  </FieldDescription>
                </Field>
                <div className="flex flex-wrap gap-4">
                  <Field className="flex-1">
                    <FieldLabel htmlFor="servicePrice">Precio</FieldLabel>
                    <Input
                      id="servicePrice"
                      inputMode="decimal"
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          price: { ...current.price, amount: event.target.value },
                        }))
                      }
                      placeholder="Sin precio publicado"
                      value={draft.price.amount}
                    />
                  </Field>
                  <Field className="w-32">
                    <FieldLabel htmlFor="serviceCurrency">Moneda</FieldLabel>
                    <Input
                      id="serviceCurrency"
                      maxLength={3}
                      onChange={(event) =>
                        setDraft((current) => ({
                          ...current,
                          price: { ...current.price, currency: event.target.value },
                        }))
                      }
                      value={draft.price.currency}
                    />
                  </Field>
                </div>
                <div className="flex flex-wrap gap-2">
                  <Button disabled={saving} type="submit">
                    {saving ? "Guardando…" : editing ? "Guardar cambios" : "Agregar servicio"}
                  </Button>
                  {editing ? (
                    <Button onClick={cancelEditing} type="button" variant="outline">
                      Cancelar
                    </Button>
                  ) : null}
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
