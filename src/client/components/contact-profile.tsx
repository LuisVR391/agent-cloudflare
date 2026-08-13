import { Check, Loader2, Plus, Tag, X } from "lucide-react";
import { useEffect, useState, type FormEvent } from "react";

import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Field, FieldGroup, FieldLabel } from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import { Separator } from "@/components/ui/separator";
import type { ContactProfile as Contact, ContactTag } from "@/lib/api";

/**
 * El color de la etiqueta es un token semántico, no una clase: aquí se traduce
 * a una variante del componente para que el tema siga decidiendo el color
 * (ADR-0009).
 */
const tagVariants: Record<ContactTag["color"], "default" | "secondary" | "destructive" | "outline"> = {
  neutral: "secondary",
  info: "default",
  success: "default",
  warning: "outline",
  danger: "destructive",
};

const providerLabels: Record<Contact["identities"][number]["provider"], string> = {
  whatsapp: "WhatsApp",
};

/** El formulario envía solo lo que cambió; una cadena vacía borra el campo. */
function changedFields(contact: Contact, draft: {
  displayName: string;
  phoneNumber: string;
  email: string;
}) {
  const normalize = (value: string) => value.trim() || null;
  const changes: {
    displayName?: string | null;
    phoneNumber?: string | null;
    email?: string | null;
  } = {};
  if (normalize(draft.displayName) !== contact.displayName) {
    changes.displayName = normalize(draft.displayName);
  }
  if (normalize(draft.phoneNumber) !== contact.phoneNumber) {
    changes.phoneNumber = normalize(draft.phoneNumber);
  }
  if (normalize(draft.email) !== contact.email) {
    changes.email = normalize(draft.email);
  }
  return changes;
}

export function ContactProfileCard({
  contact,
  canManage,
  onSave,
  onAddTag,
  onRemoveTag,
}: {
  contact: Contact;
  canManage: boolean;
  onSave: (input: {
    expectedVersion: number;
    displayName?: string | null;
    phoneNumber?: string | null;
    email?: string | null;
  }) => Promise<void>;
  onAddTag: (name: string) => Promise<void>;
  onRemoveTag: (tagId: string) => Promise<void>;
}) {
  const [draft, setDraft] = useState({
    displayName: contact.displayName ?? "",
    phoneNumber: contact.phoneNumber ?? "",
    email: contact.email ?? "",
  });
  const [tagName, setTagName] = useState("");
  const [saving, setSaving] = useState(false);
  const [saved, setSaved] = useState(false);

  // Abrir otra ficha reutiliza el componente, así que el borrador se rehace
  // cuando cambia el contacto o cuando el servidor devuelve una versión nueva.
  useEffect(() => {
    setDraft({
      displayName: contact.displayName ?? "",
      phoneNumber: contact.phoneNumber ?? "",
      email: contact.email ?? "",
    });
    setSaved(false);
  }, [contact.id, contact.version]);

  const changes = changedFields(contact, draft);
  const dirty = Object.keys(changes).length > 0;

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!dirty || saving) return;
    setSaving(true);
    try {
      await onSave({ expectedVersion: contact.version, ...changes });
      setSaved(true);
    } finally {
      setSaving(false);
    }
  }

  async function submitTag(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    const name = tagName.trim();
    if (!name) return;
    setTagName("");
    await onAddTag(name);
  }

  return (
    <div className="flex flex-col gap-6">
      <form onSubmit={submit}>
        <FieldGroup>
          <Field>
            <FieldLabel htmlFor="contact-display-name">Nombre</FieldLabel>
            <Input
              disabled={!canManage}
              id="contact-display-name"
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, displayName: event.target.value }))
              }
              placeholder="Sin nombre todavía"
              value={draft.displayName}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="contact-phone">Teléfono</FieldLabel>
            <Input
              disabled={!canManage}
              id="contact-phone"
              inputMode="tel"
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, phoneNumber: event.target.value }))
              }
              placeholder="Sin teléfono"
              value={draft.phoneNumber}
            />
          </Field>
          <Field>
            <FieldLabel htmlFor="contact-email">Correo</FieldLabel>
            <Input
              disabled={!canManage}
              id="contact-email"
              onChange={(event) =>
                setDraft((previous) => ({ ...previous, email: event.target.value }))
              }
              placeholder="Sin correo"
              type="email"
              value={draft.email}
            />
          </Field>
          {canManage ? (
            <div className="flex items-center gap-3">
              <Button disabled={!dirty || saving} type="submit">
                {saving ? <Loader2 className="animate-spin" /> : null}
                Guardar ficha
              </Button>
              {saved && !dirty ? (
                <span className="flex items-center gap-1 text-sm text-muted-foreground">
                  <Check className="size-4" aria-hidden="true" /> Guardado
                </span>
              ) : null}
            </div>
          ) : null}
        </FieldGroup>
      </form>

      <Separator />

      <section>
        <h3 className="flex items-center gap-2 text-sm font-medium">
          <Tag className="size-4" aria-hidden="true" /> Etiquetas
        </h3>
        <div className="mt-3 flex flex-wrap gap-2">
          {contact.tags.length === 0 ? (
            <p className="text-sm text-muted-foreground">Sin etiquetas.</p>
          ) : (
            contact.tags.map((tag) => (
              <Badge className="gap-1" key={tag.id} variant={tagVariants[tag.color]}>
                {tag.name}
                {canManage ? (
                  <button
                    aria-label={`Quitar etiqueta ${tag.name}`}
                    onClick={() => void onRemoveTag(tag.id)}
                    type="button"
                  >
                    <X className="size-3" aria-hidden="true" />
                  </button>
                ) : null}
              </Badge>
            ))
          )}
        </div>
        {canManage ? (
          <form className="mt-3 flex gap-2" onSubmit={submitTag}>
            <Input
              aria-label="Nueva etiqueta"
              maxLength={64}
              onChange={(event) => setTagName(event.target.value)}
              placeholder="Añadir etiqueta"
              value={tagName}
            />
            <Button disabled={!tagName.trim()} type="submit" variant="outline">
              <Plus aria-hidden="true" /> Añadir
            </Button>
          </form>
        ) : null}
      </section>

      <Separator />

      <section>
        <h3 className="text-sm font-medium">Identidades del canal</h3>
        <ul className="mt-3 flex flex-col gap-2 text-sm text-muted-foreground">
          {contact.identities.length === 0 ? (
            <li>Sin identidades registradas.</li>
          ) : (
            contact.identities.map((identity) => (
              <li className="flex items-center justify-between gap-3" key={identity.id}>
                <span>{providerLabels[identity.provider]}</span>
                <span className="truncate font-mono text-xs">{identity.externalId}</span>
              </li>
            ))
          )}
        </ul>
      </section>
    </div>
  );
}
