import { Contact as ContactIcon, Search } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import { useOutletContext } from "react-router";

import { ContactProfileCard } from "@/components/contact-profile";
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
import { Input } from "@/components/ui/input";
import { Skeleton } from "@/components/ui/skeleton";
import { Spinner } from "@/components/ui/spinner";
import { cn } from "@/lib/utils";
import {
  addContactTag,
  getContact,
  listContacts,
  removeContactTag,
  updateContact,
  type ContactProfile,
} from "@/lib/api";

/** Un contacto sin nombre se anuncia como tal; no se inventa uno. */
export function contactLabel(contact: ContactProfile): string {
  return (
    contact.displayName ??
    contact.phoneNumber ??
    contact.identities[0]?.externalId ??
    "Contacto sin nombre"
  );
}

export function ContactDirectory() {
  const panel = useOutletContext<PanelContext>();
  const canManage = panel.activeOrganization.permissions.includes("contacts.manage");
  const [query, setQuery] = useState("");
  const [contacts, setContacts] = useState<ContactProfile[]>([]);
  const [selected, setSelected] = useState<ContactProfile | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadingMore, setLoadingMore] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const sentinel = useRef<HTMLDivElement | null>(null);

  // La búsqueda espera a que la escritura se detenga: cada pulsación es una
  // consulta con `LIKE` sobre la organización entera.
  useEffect(() => {
    setLoading(true);
    const timer = window.setTimeout(() => {
      void (async () => {
        setError(null);
        try {
          const result = await listContacts(query.trim() || undefined);
          setContacts(result.contacts);
          setCursor(result.nextCursor);
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "No fue posible cargar los contactos.",
          );
        } finally {
          setLoading(false);
        }
      })();
    }, 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  useEffect(() => {
    const element = sentinel.current;
    if (!element || cursor === null) return;
    const observer = new IntersectionObserver((entries) => {
      if (!entries.some((entry) => entry.isIntersecting) || loadingMore) return;
      setLoadingMore(true);
      void (async () => {
        try {
          const result = await listContacts(query.trim() || undefined, cursor);
          setContacts((previous) => [...previous, ...result.contacts]);
          setCursor(result.nextCursor);
        } catch (caught) {
          setError(
            caught instanceof Error ? caught.message : "No fue posible cargar más contactos.",
          );
        } finally {
          setLoadingMore(false);
        }
      })();
    });
    observer.observe(element);
    return () => observer.disconnect();
  }, [cursor, loadingMore, query]);

  /** Refleja la ficha guardada tanto en el detalle como en la lista. */
  function apply(contact: ContactProfile) {
    setSelected(contact);
    setContacts((previous) =>
      previous.map((item) => (item.id === contact.id ? contact : item)),
    );
  }

  async function open(contactId: string) {
    setError(null);
    try {
      apply(await getContact(contactId));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible abrir el contacto.");
    }
  }

  async function run(action: () => Promise<ContactProfile>) {
    setError(null);
    try {
      apply(await action());
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : "No fue posible guardar el contacto.");
    }
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      {error ? (
        <div className="shrink-0 p-4 pb-0">
          <Alert variant="destructive">
            <AlertTitle>No pudimos completar la acción</AlertTitle>
            <AlertDescription>{error}</AlertDescription>
          </Alert>
        </div>
      ) : null}
      <div className="grid min-h-0 flex-1 md:grid-cols-[320px_1fr] lg:grid-cols-[360px_1fr]">
        <div className="flex min-h-0 flex-col md:border-r">
          <div className="flex shrink-0 flex-col gap-3 border-b p-4">
            <h2 className="text-lg font-semibold">Contactos</h2>
            <div className="relative">
              <Search
                aria-hidden="true"
                className="pointer-events-none absolute left-3 top-1/2 size-4 -translate-y-1/2 text-muted-foreground"
              />
              <Input
                aria-label="Buscar contactos"
                className="pl-9"
                maxLength={128}
                onChange={(event) => setQuery(event.target.value)}
                placeholder="Nombre, teléfono o correo"
                value={query}
              />
            </div>
          </div>
          <div className="flex min-h-0 flex-1 flex-col overflow-y-auto">
            {loading ? (
              <div className="flex flex-col gap-3 p-4">
                {[0, 1, 2].map((row) => (
                  <div className="flex flex-col gap-2" key={row}>
                    <Skeleton className="h-4 w-2/3" />
                    <Skeleton className="h-3 w-1/2" />
                  </div>
                ))}
              </div>
            ) : null}
            {!loading && contacts.length === 0 ? (
              <Empty>
                <EmptyHeader>
                  <EmptyMedia variant="icon">
                    <ContactIcon />
                  </EmptyMedia>
                  <EmptyTitle>
                    {query ? "Sin coincidencias" : "Todavía no hay contactos"}
                  </EmptyTitle>
                  <EmptyDescription>
                    {query
                      ? "Prueba con otro nombre, teléfono o correo."
                      : "Cada conversación de WhatsApp crea aquí su contacto."}
                  </EmptyDescription>
                </EmptyHeader>
              </Empty>
            ) : null}
            {contacts.map((contact) => (
              <button
                className={cn(
                  "flex w-full flex-col items-start gap-1 border-b p-4 text-left text-sm leading-tight last:border-b-0",
                  "hover:bg-muted/60",
                  selected?.id === contact.id && "bg-muted",
                )}
                key={contact.id}
                onClick={() => void open(contact.id)}
                type="button"
              >
                <span className="w-full truncate font-medium">{contactLabel(contact)}</span>
                {contact.phoneNumber && contact.displayName ? (
                  <span className="text-muted-foreground">{contact.phoneNumber}</span>
                ) : null}
                {contact.tags.length > 0 ? (
                  <span className="mt-1 flex flex-wrap gap-1">
                    {contact.tags.map((tag) => (
                      <Badge key={tag.id} variant="secondary">
                        {tag.name}
                      </Badge>
                    ))}
                  </span>
                ) : null}
              </button>
            ))}
            {cursor !== null || loadingMore ? (
              <div
                className="flex shrink-0 items-center justify-center gap-2 p-4 text-xs text-muted-foreground"
                ref={sentinel}
              >
                {loadingMore ? (
                  <>
                    <Spinner />
                    Cargando contactos…
                  </>
                ) : null}
              </div>
            ) : null}
          </div>
        </div>
        <div className="min-h-0 overflow-y-auto p-4 sm:p-6">
          {selected ? (
            <>
              <header className="mb-6">
                <h1 className="text-2xl font-semibold tracking-tight">
                  {contactLabel(selected)}
                </h1>
                <p className="mt-1 text-sm text-muted-foreground">
                  Ficha del contacto en tu organización
                </p>
              </header>
              <ContactProfileCard
                canManage={canManage}
                contact={selected}
                onAddTag={(name) => run(() => addContactTag(selected.id, name))}
                onRemoveTag={(tagId) => run(() => removeContactTag(selected.id, tagId))}
                onSave={(input) => run(() => updateContact(selected.id, input))}
              />
            </>
          ) : (
            <Empty>
              <EmptyHeader>
                <EmptyMedia variant="icon">
                  <ContactIcon />
                </EmptyMedia>
                <EmptyTitle>Elige un contacto</EmptyTitle>
                <EmptyDescription>
                  Su ficha, etiquetas e identidades del canal aparecerán aquí.
                </EmptyDescription>
              </EmptyHeader>
            </Empty>
          )}
        </div>
      </div>
    </div>
  );
}
