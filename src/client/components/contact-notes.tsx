import { NotebookPen } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Alert, AlertDescription, AlertTitle } from "@/components/ui/alert";
import { Button } from "@/components/ui/button";
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
import { createContactNote, listContactNotes, type ContactNote } from "@/lib/api";

/** Fecha corta con hora: una nota se ubica por cuándo se escribió. */
function formatMoment(value: string): string {
  return new Date(value).toLocaleString(undefined, {
    day: "numeric",
    month: "short",
    hour: "2-digit",
    minute: "2-digit",
  });
}

/**
 * Notas del contacto: lo que el equipo entendió, frente al mensaje, que es lo
 * que el contacto dijo. Se listan de la más reciente a la más antigua e
 * incluyen las escritas desde cualquier conversación, no solo desde esta.
 *
 * `conversationId` ancla lo que se escriba aquí al hilo de origen. Sin él, la
 * nota es de ficha.
 */
export function ContactNotes({
  contactId,
  conversationId,
  canManage,
}: {
  contactId: string;
  conversationId?: string;
  canManage: boolean;
}) {
  const [notes, setNotes] = useState<ContactNote[] | null>(null);
  const [body, setBody] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setNotes(null);
    setError(null);
    void listContactNotes(contactId)
      .then(setNotes)
      .catch((caught: unknown) =>
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las notas.",
        ),
      );
  }, [contactId]);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const text = body.trim();
    if (!text || saving) return;
    setSaving(true);
    setError(null);
    try {
      await createContactNote({ contactId, conversationId, body: text });
      // Se relee la lista completa en vez de insertar la nota devuelta: el
      // servidor decide el orden y quién figura como autor.
      setNotes(await listContactNotes(contactId));
      setBody("");
    } catch (caught) {
      setError(
        caught instanceof Error
          ? caught.message
          : "No fue posible guardar la nota.",
      );
    } finally {
      setSaving(false);
    }
  }

  return (
    <section className="flex flex-col gap-3">
      <h3 className="flex items-center gap-2 text-sm font-medium">
        <NotebookPen className="size-4" aria-hidden="true" /> Notas
      </h3>

      {error ? (
        <Alert variant="destructive">
          <AlertTitle>No pudimos completar la acción</AlertTitle>
          <AlertDescription>{error}</AlertDescription>
        </Alert>
      ) : null}

      {notes === null && !error ? (
        <div className="flex flex-col gap-2">
          <Skeleton className="h-12 w-full" />
          <Skeleton className="h-12 w-2/3" />
        </div>
      ) : null}

      {notes?.length === 0 ? (
        <p className="text-sm text-muted-foreground">
          Todavía no hay notas de este contacto.
        </p>
      ) : null}

      {notes && notes.length > 0 ? (
        <ul aria-label="Notas del contacto" className="flex flex-col gap-3">
          {notes.map((note) => (
            <li className="border-b pb-3 last:border-b-0" key={note.id}>
              <p className="text-sm whitespace-pre-wrap">{note.body}</p>
              <p className="mt-1 text-xs text-muted-foreground">
                {note.authorName ?? "Autor retirado del equipo"} ·{" "}
                {formatMoment(note.createdAt)}
                {note.conversationId ? " · desde una conversación" : null}
              </p>
            </li>
          ))}
        </ul>
      ) : null}

      {canManage ? (
        <form className="flex flex-col gap-2" onSubmit={submit}>
          <Field>
            <FieldLabel htmlFor="contact-note-body">Nueva nota</FieldLabel>
            <textarea
              className="border-input placeholder:text-muted-foreground focus-visible:border-ring focus-visible:ring-ring/50 min-h-20 w-full rounded-md border bg-transparent px-3 py-2 text-sm shadow-xs outline-none focus-visible:ring-[3px] disabled:opacity-50"
              id="contact-note-body"
              maxLength={4000}
              onChange={(event) => setBody(event.target.value)}
              placeholder="Lo que conviene recordar de esta persona"
              value={body}
            />
            <FieldDescription>
              Queda en la ficha del contacto, no se envía a la conversación.
            </FieldDescription>
          </Field>
          <Button
            className="self-start"
            disabled={!body.trim() || saving}
            type="submit"
          >
            {saving ? "Guardando…" : "Guardar nota"}
          </Button>
        </form>
      ) : null}
    </section>
  );
}

/**
 * Notas abiertas desde la conversación. Vive en un panel lateral para que
 * anotar no saque a la persona del hilo que está atendiendo, y lo que se
 * escriba conserva esta conversación como origen.
 */
export function NoteSheet({
  contactId,
  conversationId,
  canManage,
}: {
  contactId: string;
  conversationId: string;
  canManage: boolean;
}) {
  const [open, setOpen] = useState(false);

  return (
    <Sheet onOpenChange={setOpen} open={open}>
      <SheetTrigger asChild>
        <Button variant="outline">
          <NotebookPen aria-hidden="true" />
          Notas
        </Button>
      </SheetTrigger>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-md">
        <SheetHeader>
          <SheetTitle>Notas del contacto</SheetTitle>
          <SheetDescription>
            Lo que anotes aquí queda en su ficha y recuerda que se supo en esta
            conversación.
          </SheetDescription>
        </SheetHeader>
        <div className="px-4 pb-6">
          {/* Carga bajo demanda: montar el contenido solo con el panel abierto
              evita pedir las notas de cada conversación que se mira. */}
          {open ? (
            <ContactNotes
              canManage={canManage}
              contactId={contactId}
              conversationId={conversationId}
            />
          ) : null}
        </div>
      </SheetContent>
    </Sheet>
  );
}
