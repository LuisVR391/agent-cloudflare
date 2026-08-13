import { Check, Copy, Link2, Users } from "lucide-react";
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
  DropdownMenu,
  DropdownMenuContent,
  DropdownMenuRadioGroup,
  DropdownMenuRadioItem,
  DropdownMenuTrigger,
} from "@/components/ui/dropdown-menu";
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
  createTeamInvitation,
  listTeamInvitations,
  listTeamMembers,
  revokeTeamInvitation,
  type TeamInvitation,
  type TeamMember,
  type TeamRole,
} from "@/lib/api";

export const roleLabels: Record<TeamRole, string> = {
  owner: "Propietario",
  manager: "Gerente",
  operator: "Operador",
};

const membershipLabels: Record<TeamMember["status"], string> = {
  active: "Activa",
  suspended: "Suspendida",
  revoked: "Revocada",
};

const invitationLabels: Record<TeamInvitation["status"], string> = {
  pending: "Pendiente",
  accepting: "En curso",
  accepted: "Aceptada",
  revoked: "Revocada",
  expired: "Vencida",
};

function formatDate(value: string): string {
  return new Date(value).toLocaleDateString(undefined, {
    day: "numeric",
    month: "long",
    year: "numeric",
  });
}

/**
 * Una invitación vencida sigue guardada como pendiente hasta que alguien la
 * usa: el estado se persiste cuando un intento la toca, no por un proceso que
 * recorra la tabla. La interfaz lo deriva de la fecha para no anunciar como
 * vigente algo que ya no lo está.
 */
function invitationState(invitation: TeamInvitation): TeamInvitation["status"] {
  return invitation.status === "pending" &&
    Date.parse(invitation.expiresAt) <= Date.now()
    ? "expired"
    : invitation.status;
}

export function TeamDirectory() {
  const panel = useOutletContext<PanelContext>();
  const permissions = panel.activeOrganization.permissions;
  const canRead = permissions.includes("users.read");
  const canManage = permissions.includes("users.manage");

  const [members, setMembers] = useState<TeamMember[]>([]);
  const [invitations, setInvitations] = useState<TeamInvitation[]>([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [email, setEmail] = useState("");
  const [role, setRole] = useState<TeamRole>("operator");
  const [inviting, setInviting] = useState(false);
  const [issuedLink, setIssuedLink] = useState<string | null>(null);
  const [copied, setCopied] = useState(false);

  useEffect(() => {
    if (!canRead) {
      setLoading(false);
      return;
    }
    void (async () => {
      try {
        setMembers(await listTeamMembers());
        if (canManage) setInvitations(await listTeamInvitations());
      } catch (caught) {
        setError(
          caught instanceof Error ? caught.message : "No fue posible cargar el equipo.",
        );
      } finally {
        setLoading(false);
      }
    })();
  }, [canRead, canManage]);

  async function invite(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setInviting(true);
    setError(null);
    setCopied(false);
    try {
      const created = await createTeamInvitation({ email: email.trim(), role });
      setIssuedLink(created.acceptUrl);
      setInvitations(await listTeamInvitations());
      setEmail("");
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible crear la invitación.",
      );
    } finally {
      setInviting(false);
    }
  }

  async function revoke(invitationId: string) {
    setError(null);
    try {
      await revokeTeamInvitation(invitationId);
      setInvitations(await listTeamInvitations());
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible revocar la invitación.",
      );
    }
  }

  async function copyLink(link: string) {
    try {
      await navigator.clipboard.writeText(link);
      setCopied(true);
    } catch {
      // Sin permiso de portapapeles el enlace sigue visible y seleccionable.
      setCopied(false);
    }
  }

  if (!canRead) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Users />
          </EmptyMedia>
          <EmptyTitle>No tienes acceso al equipo</EmptyTitle>
          <EmptyDescription>
            Pide a quien administra tu organización que te conceda la lectura del
            equipo.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Equipo</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Quién puede entrar al panel de {panel.activeOrganization.organizationName} y
            con qué rol.
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
            <CardTitle>Miembros</CardTitle>
            <CardDescription>
              El rol decide qué puede hacer cada persona; el backend lo comprueba en
              cada petición.
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
            ) : (
              members.map((member) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0 last:pb-0"
                  key={member.membershipId}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{member.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {member.email}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    {member.status === "active" ? null : (
                      <Badge variant="outline">
                        {membershipLabels[member.status]}
                      </Badge>
                    )}
                    <Badge variant="secondary">{roleLabels[member.role]}</Badge>
                  </div>
                </div>
              ))
            )}
          </CardContent>
        </Card>

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Invitar a alguien</CardTitle>
              <CardDescription>
                El producto todavía no envía correo, así que el enlace se comparte a
                mano. Vence en tres días y solo sirve una vez.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-4">
              <form className="flex flex-col gap-4" onSubmit={invite}>
                <Field>
                  <FieldLabel htmlFor="invitationEmail">Correo</FieldLabel>
                  <Input
                    autoComplete="off"
                    id="invitationEmail"
                    maxLength={254}
                    onChange={(event) => setEmail(event.target.value)}
                    placeholder="persona@ejemplo.com"
                    required
                    type="email"
                    value={email}
                  />
                  <FieldDescription>
                    Quien acepte deberá escribir este mismo correo.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="invitationRole">Rol</FieldLabel>
                  <DropdownMenu>
                    <DropdownMenuTrigger asChild>
                      <Button
                        className="w-full justify-between sm:w-56"
                        id="invitationRole"
                        type="button"
                        variant="outline"
                      >
                        {roleLabels[role]}
                      </Button>
                    </DropdownMenuTrigger>
                    <DropdownMenuContent align="start">
                      <DropdownMenuRadioGroup
                        onValueChange={(value) => setRole(value as TeamRole)}
                        value={role}
                      >
                        {(Object.keys(roleLabels) as TeamRole[]).map((key) => (
                          <DropdownMenuRadioItem key={key} value={key}>
                            {roleLabels[key]}
                          </DropdownMenuRadioItem>
                        ))}
                      </DropdownMenuRadioGroup>
                    </DropdownMenuContent>
                  </DropdownMenu>
                </Field>
                <Button className="self-start" disabled={inviting} type="submit">
                  {inviting ? "Creando…" : "Crear invitación"}
                </Button>
              </form>

              {issuedLink ? (
                <div className="flex flex-col gap-2 rounded-xl border border-dashed p-4">
                  <p className="flex items-center gap-2 text-sm font-medium">
                    <Link2 aria-hidden="true" className="size-4" />
                    Comparte este enlace ahora
                  </p>
                  <p className="text-sm text-muted-foreground">
                    No volverá a mostrarse: el servidor solo conserva su huella. Si se
                    pierde, crea una invitación nueva.
                  </p>
                  <div className="flex flex-wrap items-center gap-2">
                    <Input
                      aria-label="Enlace de invitación"
                      className="flex-1"
                      onFocus={(event) => event.currentTarget.select()}
                      readOnly
                      value={issuedLink}
                    />
                    <Button
                      onClick={() => void copyLink(issuedLink)}
                      type="button"
                      variant="outline"
                    >
                      {copied ? <Check /> : <Copy />}
                      {copied ? "Copiado" : "Copiar"}
                    </Button>
                  </div>
                </div>
              ) : null}
            </CardContent>
          </Card>
        ) : null}

        {canManage ? (
          <Card>
            <CardHeader>
              <CardTitle>Invitaciones</CardTitle>
              <CardDescription>
                Revocar una deja su enlace sin efecto de inmediato.
              </CardDescription>
            </CardHeader>
            <CardContent className="flex flex-col gap-3">
              {invitations.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  No hay invitaciones registradas.
                </p>
              ) : null}
              {invitations.map((invitation) => {
                const state = invitationState(invitation);
                return (
                  <div
                    className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0 last:pb-0"
                    key={invitation.id}
                  >
                    <div className="min-w-0">
                      <p className="truncate font-medium">{invitation.email}</p>
                      <p className="truncate text-sm text-muted-foreground">
                        {roleLabels[invitation.role]} · vence el{" "}
                        {formatDate(invitation.expiresAt)}
                      </p>
                    </div>
                    <div className="flex items-center gap-2">
                      <Badge
                        variant={state === "pending" ? "secondary" : "outline"}
                      >
                        {invitationLabels[state]}
                      </Badge>
                      {state === "pending" || state === "accepting" ? (
                        <Button
                          onClick={() => void revoke(invitation.id)}
                          size="sm"
                          variant="outline"
                        >
                          Revocar
                        </Button>
                      ) : null}
                    </div>
                  </div>
                );
              })}
            </CardContent>
          </Card>
        ) : null}
      </div>
    </div>
  );
}
