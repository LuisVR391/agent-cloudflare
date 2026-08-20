import { Bot } from "lucide-react";
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
import { Checkbox } from "@/components/ui/checkbox";
import {
  Empty,
  EmptyDescription,
  EmptyHeader,
  EmptyMedia,
  EmptyTitle,
} from "@/components/ui/empty";
import {
  Field,
  FieldContent,
  FieldDescription,
  FieldLabel,
  FieldLegend,
  FieldSet,
} from "@/components/ui/field";
import { Input } from "@/components/ui/input";
import {
  Sheet,
  SheetContent,
  SheetDescription,
  SheetHeader,
  SheetTitle,
} from "@/components/ui/sheet";
import { Skeleton } from "@/components/ui/skeleton";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { Textarea } from "@/components/ui/textarea";
import {
  createAgent,
  createAgentVersion,
  fetchAgentTools,
  getAgent,
  listAgents,
  replaceAgentVersion,
  setAgentPublication,
  updateAgent,
  type AgentDetail,
  type AgentSummary,
  type AgentToolDefinition,
  type AgentVersion,
} from "@/lib/api";

type VersionDraft = {
  instructions: string;
  model: string;
  playbook: string;
  /** Las claves marcadas, no un texto: el catálogo es cerrado y se elige de él. */
  tools: string[];
  knowledgeScopes: string;
  changeReason: string;
};

const emptyVersionDraft: VersionDraft = {
  instructions: "",
  model: "",
  playbook: "",
  tools: [],
  knowledgeScopes: "",
  changeReason: "",
};

/**
 * El alcance de conocimiento sigue escribiéndose separado por comas: su catálogo
 * no existe todavía y el backend lo deduplica.
 */
function parseList(value: string): string[] {
  return value
    .split(",")
    .map((item) => item.trim())
    .filter((item) => item !== "");
}

function toDraft(version: AgentVersion): VersionDraft {
  return {
    instructions: version.instructions,
    model: version.model,
    playbook: version.playbook ?? "",
    tools: version.tools,
    knowledgeScopes: version.knowledgeScopes.join(", "),
    changeReason: version.changeReason ?? "",
  };
}

const versionStatusLabels: Record<AgentVersion["status"], string> = {
  draft: "Borrador",
  published: "Publicada",
  archived: "Archivada",
};

const publicationLabels = {
  published: "Publicó",
  unpublished: "Desactivó",
  rolled_back: "Revirtió",
} as const;

function formatMoment(value: string): string {
  return new Date(value).toLocaleString("es-MX", {
    dateStyle: "medium",
    timeStyle: "short",
  });
}

/**
 * Configuración de agentes de la organización activa. Un agente es
 * configuración reutilizable; una versión es una revisión inmutable de esa
 * configuración, y solo una está publicada a la vez.
 *
 * Publicar todavía **no** cambia el comportamiento de ninguna conversación: la
 * ejecución llega en el corte siguiente. La pantalla lo dice en vez de dejar
 * suponer lo contrario.
 */
export function AgentDirectory() {
  const panel = useOutletContext<PanelContext>();
  const permissions = panel.activeOrganization.permissions;
  const canRead = permissions.includes("agents.read");
  const canManage = permissions.includes("agents.manage");

  const [agents, setAgents] = useState<AgentSummary[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [selected, setSelected] = useState<AgentDetail | null>(null);
  const [name, setName] = useState("");
  const [purpose, setPurpose] = useState("");
  const [reason, setReason] = useState("");
  const [draft, setDraft] = useState<VersionDraft>(emptyVersionDraft);
  const [editingVersionId, setEditingVersionId] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  // `null` mientras no se sabe qué herramientas existen: ni cargadas ni fallidas.
  const [toolCatalog, setToolCatalog] = useState<AgentToolDefinition[] | null>(null);
  const [toolCatalogError, setToolCatalogError] = useState<string | null>(null);

  // Quien gestiona ve también los archivados, para poder reactivarlos.
  const scope = canManage ? "all" : "active";

  useEffect(() => {
    if (!canRead) {
      setAgents([]);
      return;
    }
    void (async () => {
      try {
        setAgents(await listAgents(scope));
      } catch (caught) {
        setAgents([]);
        setError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar los agentes.",
        );
      }
    })();
  }, [canRead, scope]);

  // El catálogo es del producto, no de la organización, pero consultarlo exige
  // `agents.read`: sin ese permiso la pantalla ya no pide nada al servidor.
  useEffect(() => {
    if (!canRead) return;
    void (async () => {
      try {
        setToolCatalog(await fetchAgentTools());
      } catch (caught) {
        setToolCatalogError(
          caught instanceof Error
            ? caught.message
            : "No fue posible cargar las herramientas.",
        );
      }
    })();
  }, [canRead]);

  /**
   * Toda acción recarga la lista y el detalle abierto: la versión del agente
   * cambia con cada escritura y el siguiente `expectedVersion` debe ser el
   * vigente.
   */
  async function run(action: () => Promise<AgentDetail | void>, fallback: string) {
    setBusy(true);
    setError(null);
    try {
      const detail = await action();
      if (detail) setSelected(detail);
      setAgents(await listAgents(scope));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : fallback);
    } finally {
      setBusy(false);
    }
  }

  async function open(agent: AgentSummary) {
    setError(null);
    setReason("");
    setDraft(emptyVersionDraft);
    setEditingVersionId(null);
    try {
      setSelected(await getAgent(agent.id));
    } catch (caught) {
      setError(
        caught instanceof Error ? caught.message : "No fue posible cargar el agente.",
      );
    }
  }

  async function submitAgent(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    await run(async () => {
      await createAgent({ name, purpose: purpose.trim() || null });
      setName("");
      setPurpose("");
    }, "No fue posible crear el agente.");
  }

  async function submitVersion(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (!selected || toolCatalog === null) return;
    // Solo viaja lo que el catálogo vigente reconoce: una clave declarada por una
    // versión antigua se sigue leyendo, pero no se vuelve a declarar.
    const offered = new Set(toolCatalog.map((tool) => tool.key));
    const content = {
      instructions: draft.instructions,
      model: draft.model,
      playbook: draft.playbook.trim() || null,
      tools: draft.tools.filter((key) => offered.has(key)),
      knowledgeScopes: parseList(draft.knowledgeScopes),
      changeReason: draft.changeReason.trim() || null,
    };
    await run(async () => {
      const detail = editingVersionId
        ? await replaceAgentVersion(selected.id, editingVersionId, {
            ...content,
            expectedVersion: selected.version,
          })
        : await createAgentVersion(selected.id, {
            ...content,
            expectedVersion: selected.version,
          });
      setDraft(emptyVersionDraft);
      setEditingVersionId(null);
      return detail;
    }, "No fue posible guardar la versión.");
  }

  const publish = (versionId: string | null) => {
    if (!selected) return;
    void run(
      () =>
        setAgentPublication(selected.id, {
          expectedVersion: selected.version,
          versionId,
          reason,
        }).then((detail) => {
          setReason("");
          return detail;
        }),
      "No fue posible cambiar la publicación.",
    );
  };

  if (!canRead) {
    return (
      <Empty>
        <EmptyHeader>
          <EmptyMedia variant="icon">
            <Bot />
          </EmptyMedia>
          <EmptyTitle>No tienes acceso a los agentes</EmptyTitle>
          <EmptyDescription>
            Pide a quien administra tu organización que te conceda la lectura de
            los agentes.
          </EmptyDescription>
        </EmptyHeader>
      </Empty>
    );
  }

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <div className="mx-auto flex max-w-3xl flex-col gap-6">
        <header>
          <h1 className="text-2xl font-semibold tracking-tight">Agentes</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Cómo responde {panel.activeOrganization.organizationName}, en versiones
            que se publican y se revierten. Publicar no cambia ninguna
            conversación en curso: quién atiende cada una se decide en
            Conversaciones, y ahí un agente asignado responde con la versión
            publicada y con las herramientas que esa versión declara.
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
            <CardTitle>Configurados</CardTitle>
            <CardDescription>
              Un agente no se borra: se archiva, para que sus versiones y su
              historial sigan explicando con qué configuración se respondió.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-3">
            {agents === null ? (
              [0, 1].map((row) => (
                <div className="flex flex-col gap-2" key={row}>
                  <Skeleton className="h-4 w-1/3" />
                  <Skeleton className="h-3 w-1/2" />
                </div>
              ))
            ) : agents.length === 0 ? (
              <p className="text-sm text-muted-foreground">
                Todavía no hay agentes configurados. Crea el primero para
                describir cómo debería responder tu empresa.
              </p>
            ) : (
              agents.map((agent) => (
                <div
                  className="flex flex-wrap items-center justify-between gap-2 border-b pb-3 last:border-b-0 last:pb-0"
                  key={agent.id}
                >
                  <div className="min-w-0">
                    <p className="truncate font-medium">{agent.name}</p>
                    <p className="truncate text-sm text-muted-foreground">
                      {agent.purpose ?? "Sin propósito declarado"}
                    </p>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge
                      variant={
                        agent.publishedVersionNumber === null ? "outline" : "secondary"
                      }
                    >
                      {agent.publishedVersionNumber === null
                        ? "Sin versión publicada"
                        : `v${agent.publishedVersionNumber} publicada`}
                    </Badge>
                    {agent.status === "archived" ? (
                      <Badge variant="outline">Archivado</Badge>
                    ) : null}
                    <Button
                      onClick={() => void open(agent)}
                      size="sm"
                      variant="outline"
                    >
                      Versiones
                    </Button>
                    {canManage ? (
                      <Button
                        onClick={() =>
                          void run(
                            async () => {
                              await updateAgent(agent.id, {
                                expectedVersion: agent.version,
                                status:
                                  agent.status === "active" ? "archived" : "active",
                              });
                            },
                            "No fue posible actualizar el agente.",
                          )
                        }
                        size="sm"
                        variant="outline"
                      >
                        {agent.status === "active" ? "Archivar" : "Reactivar"}
                      </Button>
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
              <CardTitle>Agregar un agente</CardTitle>
              <CardDescription>
                El propósito es para tu equipo, no una instrucción al modelo: lo
                que define el comportamiento vive en la versión.
              </CardDescription>
            </CardHeader>
            <CardContent>
              <form className="flex flex-col gap-4" onSubmit={submitAgent}>
                <Field>
                  <FieldLabel htmlFor="agent-name">Nombre</FieldLabel>
                  <Input
                    id="agent-name"
                    onChange={(event) => setName(event.target.value)}
                    required
                    value={name}
                  />
                  <FieldDescription>
                    Único dentro de la organización, incluso si el agente se
                    archiva.
                  </FieldDescription>
                </Field>
                <Field>
                  <FieldLabel htmlFor="agent-purpose">Propósito</FieldLabel>
                  <Input
                    id="agent-purpose"
                    onChange={(event) => setPurpose(event.target.value)}
                    value={purpose}
                  />
                </Field>
                <div>
                  <Button disabled={busy} type="submit">
                    Crear agente
                  </Button>
                </div>
              </form>
            </CardContent>
          </Card>
        ) : null}
      </div>

      <AgentSheet
        agent={selected}
        busy={busy}
        canManage={canManage}
        draft={draft}
        editingVersionId={editingVersionId}
        onClose={() => setSelected(null)}
        onDraftChange={setDraft}
        onEditVersion={(version) => {
          setEditingVersionId(version.id);
          setDraft(toDraft(version));
        }}
        onDeriveVersion={(version) => {
          if (!selected) return;
          void run(
            () =>
              createAgentVersion(selected.id, {
                expectedVersion: selected.version,
                fromVersionId: version.id,
                changeReason: `Derivada de la v${version.versionNumber}`,
              }),
            "No fue posible duplicar la versión.",
          );
        }}
        onPublish={publish}
        onReasonChange={setReason}
        onSubmitVersion={submitVersion}
        reason={reason}
        toolCatalog={toolCatalog}
        toolCatalogError={toolCatalogError}
      />
    </div>
  );
}

function AgentSheet({
  agent,
  busy,
  canManage,
  draft,
  editingVersionId,
  onClose,
  onDeriveVersion,
  onDraftChange,
  onEditVersion,
  onPublish,
  onReasonChange,
  onSubmitVersion,
  reason,
  toolCatalog,
  toolCatalogError,
}: {
  agent: AgentDetail | null;
  busy: boolean;
  canManage: boolean;
  draft: VersionDraft;
  editingVersionId: string | null;
  onClose: () => void;
  onDeriveVersion: (version: AgentVersion) => void;
  onDraftChange: (draft: VersionDraft) => void;
  onEditVersion: (version: AgentVersion) => void;
  onPublish: (versionId: string | null) => void;
  onReasonChange: (reason: string) => void;
  onSubmitVersion: (event: FormEvent<HTMLFormElement>) => void;
  reason: string;
  toolCatalog: AgentToolDefinition[] | null;
  toolCatalogError: string | null;
}) {
  const [tab, setTab] = useState("versions");

  if (agent === null) return null;

  const toolLabels = new Map(
    (toolCatalog ?? []).map((tool) => [tool.key, tool.label] as const),
  );

  /** Marcar y desmarcar reconstruye el conjunto en el orden del catálogo. */
  function toggleTool(key: string, checked: boolean) {
    const next = new Set(draft.tools);
    if (checked) next.add(key);
    else next.delete(key);
    onDraftChange({
      ...draft,
      tools: (toolCatalog ?? [])
        .filter((tool) => next.has(tool.key))
        .map((tool) => tool.key),
    });
  }

  return (
    <Sheet onOpenChange={(next) => (next ? undefined : onClose())} open>
      <SheetContent className="w-full gap-0 overflow-y-auto sm:max-w-xl">
        <SheetHeader>
          <SheetTitle>{agent.name}</SheetTitle>
          <SheetDescription>
            Una versión publicada no vuelve a editarse. Cambiar el comportamiento
            crea una revisión nueva, y revertir reactiva una anterior sin copiar
            su contenido.
          </SheetDescription>
        </SheetHeader>

        <div className="flex flex-col gap-4 px-4 pb-6">
          <Tabs onValueChange={setTab} value={tab}>
            <TabsList>
              <TabsTrigger value="versions">Versiones</TabsTrigger>
              <TabsTrigger value="history">Historial</TabsTrigger>
            </TabsList>
          </Tabs>

          {tab === "versions" ? (
            <>
              {canManage ? (
                <Field>
                  <FieldLabel htmlFor="publication-reason">
                    Motivo del cambio de publicación
                  </FieldLabel>
                  <Input
                    id="publication-reason"
                    onChange={(event) => onReasonChange(event.target.value)}
                    value={reason}
                  />
                  <FieldDescription>
                    Obligatorio: el historial conserva por qué cambió lo que
                    responde tu empresa.
                  </FieldDescription>
                </Field>
              ) : null}

              {canManage && agent.publishedVersionId !== null ? (
                <div>
                  <Button
                    disabled={busy || reason.trim() === ""}
                    onClick={() => onPublish(null)}
                    size="sm"
                    variant="outline"
                  >
                    Desactivar la publicación
                  </Button>
                </div>
              ) : null}

              {agent.versions.length === 0 ? (
                <p className="text-sm text-muted-foreground">
                  Este agente todavía no tiene ninguna versión.
                </p>
              ) : (
                agent.versions.map((version) => (
                  <div
                    className="flex flex-col gap-2 border-b pb-3 last:border-b-0"
                    key={version.id}
                  >
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-medium">v{version.versionNumber}</span>
                      <Badge
                        variant={
                          version.status === "published" ? "secondary" : "outline"
                        }
                      >
                        {versionStatusLabels[version.status]}
                      </Badge>
                      <span className="text-sm text-muted-foreground">
                        {version.model}
                      </span>
                    </div>
                    <p className="text-sm text-muted-foreground">
                      {version.changeReason ?? "Sin motivo declarado"} ·{" "}
                      {version.createdByName ?? "Autor desconocido"}
                    </p>
                    {version.tools.length === 0 ? null : (
                      <div className="flex flex-wrap gap-1">
                        {/*
                          Una versión publicada es inmutable: si el catálogo dejó
                          de ofrecer una clave, su declaración se sigue leyendo
                          tal cual, aunque ya no pueda volver a marcarse.
                        */}
                        {version.tools.map((key) => (
                          <Badge
                            key={key}
                            variant={toolLabels.has(key) ? "secondary" : "outline"}
                          >
                            {toolLabels.get(key) ?? `${key} · fuera del catálogo`}
                          </Badge>
                        ))}
                      </div>
                    )}
                    {canManage ? (
                      <div className="flex flex-wrap gap-2">
                        {version.status === "published" ? null : (
                          <Button
                            disabled={busy || reason.trim() === ""}
                            onClick={() => onPublish(version.id)}
                            size="sm"
                          >
                            {agent.publishedVersionNumber !== null &&
                            version.versionNumber < agent.publishedVersionNumber
                              ? "Revertir a esta"
                              : "Publicar"}
                          </Button>
                        )}
                        {version.status === "draft" ? (
                          <Button
                            disabled={busy}
                            onClick={() => onEditVersion(version)}
                            size="sm"
                            variant="outline"
                          >
                            Editar
                          </Button>
                        ) : null}
                        <Button
                          disabled={busy}
                          onClick={() => onDeriveVersion(version)}
                          size="sm"
                          variant="outline"
                        >
                          Duplicar
                        </Button>
                      </div>
                    ) : null}
                  </div>
                ))
              )}

              {canManage ? (
                <form className="flex flex-col gap-4" onSubmit={onSubmitVersion}>
                  <h3 className="text-sm font-medium">
                    {editingVersionId ? "Editar el borrador" : "Nueva versión"}
                  </h3>
                  <Field>
                    <FieldLabel htmlFor="version-instructions">
                      Instrucciones
                    </FieldLabel>
                    <Textarea
                      id="version-instructions"
                      onChange={(event) =>
                        onDraftChange({ ...draft, instructions: event.target.value })
                      }
                      required
                      value={draft.instructions}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="version-model">Modelo previsto</FieldLabel>
                    <Input
                      id="version-model"
                      onChange={(event) =>
                        onDraftChange({ ...draft, model: event.target.value })
                      }
                      required
                      value={draft.model}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="version-playbook">Playbook</FieldLabel>
                    <Textarea
                      id="version-playbook"
                      onChange={(event) =>
                        onDraftChange({ ...draft, playbook: event.target.value })
                      }
                      value={draft.playbook}
                    />
                  </Field>
                  <FieldSet>
                    <FieldLegend variant="label">
                      Herramientas declaradas
                    </FieldLegend>
                    <FieldDescription>
                      Lo que esta versión puede consultar al responder. El backend
                      vuelve a comprobar cada marca antes de anunciarla al modelo.
                    </FieldDescription>
                    {toolCatalogError !== null ? (
                      <FieldDescription>
                        {toolCatalogError} Sin el catálogo no se puede declarar
                        qué consulta esta versión.
                      </FieldDescription>
                    ) : toolCatalog === null ? (
                      <div className="flex flex-col gap-2">
                        <Skeleton className="h-4 w-2/3" />
                        <Skeleton className="h-4 w-1/2" />
                      </div>
                    ) : toolCatalog.length === 0 ? (
                      <FieldDescription>
                        Todavía no hay herramientas disponibles: esta versión
                        responderá solo con lo que digan sus instrucciones.
                      </FieldDescription>
                    ) : (
                      toolCatalog.map((tool) => (
                        <Field key={tool.key} orientation="horizontal">
                          <Checkbox
                            checked={draft.tools.includes(tool.key)}
                            id={`version-tool-${tool.key}`}
                            onCheckedChange={(checked) =>
                              toggleTool(tool.key, checked === true)
                            }
                          />
                          <FieldContent>
                            <FieldLabel
                              className="font-normal"
                              htmlFor={`version-tool-${tool.key}`}
                            >
                              {tool.label}
                            </FieldLabel>
                            <FieldDescription>{tool.description}</FieldDescription>
                          </FieldContent>
                        </Field>
                      ))
                    )}
                  </FieldSet>
                  <Field>
                    <FieldLabel htmlFor="version-knowledge">
                      Alcance de conocimiento
                    </FieldLabel>
                    <Input
                      id="version-knowledge"
                      onChange={(event) =>
                        onDraftChange({
                          ...draft,
                          knowledgeScopes: event.target.value,
                        })
                      }
                      value={draft.knowledgeScopes}
                    />
                  </Field>
                  <Field>
                    <FieldLabel htmlFor="version-reason">
                      Motivo del cambio
                    </FieldLabel>
                    <Input
                      id="version-reason"
                      onChange={(event) =>
                        onDraftChange({ ...draft, changeReason: event.target.value })
                      }
                      value={draft.changeReason}
                    />
                  </Field>
                  <div>
                    {/*
                      Guardar reemplaza el contenido entero, así que sin catálogo
                      no se guarda: vaciaría la declaración sin decirlo.
                    */}
                    <Button disabled={busy || toolCatalog === null} type="submit">
                      {editingVersionId ? "Guardar el borrador" : "Crear versión"}
                    </Button>
                  </div>
                </form>
              ) : null}
            </>
          ) : agent.publications.length === 0 ? (
            <p className="text-sm text-muted-foreground">
              Todavía no se ha publicado ninguna versión de este agente.
            </p>
          ) : (
            agent.publications.map((entry) => (
              <div
                className="flex flex-col gap-1 border-b pb-3 last:border-b-0"
                key={entry.id}
              >
                <p className="text-sm font-medium">
                  {publicationLabels[entry.action]}{" "}
                  {entry.nextVersionNumber === null
                    ? "la publicación"
                    : `la v${entry.nextVersionNumber}`}
                  {entry.previousVersionNumber === null
                    ? ""
                    : `, antes la v${entry.previousVersionNumber}`}
                </p>
                <p className="text-sm text-muted-foreground">{entry.reason}</p>
                <p className="text-xs text-muted-foreground">
                  {entry.actorName ?? "Autor desconocido"} ·{" "}
                  {formatMoment(entry.occurredAt)}
                </p>
              </div>
            ))
          )}
        </div>
      </SheetContent>
    </Sheet>
  );
}
