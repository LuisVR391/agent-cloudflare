import { IdCard } from "lucide-react";
import { useEffect, useState } from "react";

import { ContactProfileCard } from "@/components/contact-profile";
import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
  addContactTag,
  getContact,
  removeContactTag,
  updateContact,
  type ContactProfile,
} from "@/lib/api";

/**
 * Ficha del contacto abierta desde la conversación. Vive en un panel lateral
 * para que consultar o corregir el nombre no saque a la persona del hilo que
 * está atendiendo.
 *
 * Carga bajo demanda: el inbox no necesita la ficha hasta que alguien la pide,
 * y el resumen de conversación no la transporta.
 */
export function ContactSheet({
  contactId,
  canManage,
}: {
  contactId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);
  const [contact, setContact] = useState<ContactProfile | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    setContact(null);
    setError(null);
    void getContact(contactId)
      .then(setContact)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error ? caught.message : "No fue posible abrir la ficha.",
        ),
      );
  }, [contactId, open]);

  async function run(action: () => Promise<ContactProfile>) {
    setError(null);
    try {
      setContact(await action());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible guardar la ficha.",
      );
    }
  }

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <IdCard aria-hidden="true" />
          Ficha
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Ficha del contacto</SheetTitle>
          <SheetDescription>
            Nombre, teléfono, correo y etiquetas de esta persona.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {error ? (
            <Alert variant="destructive">
              <AlertTitle>No pudimos completar la acción</AlertTitle>
              <AlertDescription>{error}</AlertDescription>
            </Alert>
          ) : null}
          {!contact && !error ? (
            <div className="flex flex-col gap-3">
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-full" />
              <Skeleton className="h-9 w-2/3" />
            </div>
          ) : null}
          {contact ? (
            <ContactProfileCard
              canManage={canManage}
              contact={contact}
              onAddTag={(name) => run(() => addContactTag(contact.id, name))}
              onRemoveTag={(tagId) => run(() => removeContactTag(contact.id, tagId))}
              onSave={(input) => run(() => updateContact(contact.id, input))}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
