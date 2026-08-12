import { Bot, CheckCircle2, Clock3, MessageCircleMore, Sparkles } from "lucide-react";
import { useOutletContext } from "react-router";

import {
  Card,
  CardContent,
  CardDescription,
  CardHeader,
  CardTitle,
} from "@/components/ui/card";
import type { PanelContext } from "@/components/panel-shell";

export function PanelOverview() {
  const context = useOutletContext<PanelContext>();
  const active = context.activeOrganization;

  return (
    <div className="min-h-0 flex-1 overflow-y-auto p-4 sm:p-6">
      <header>
        <p className="text-sm text-muted-foreground">Panel administrativo</p>
        <h1 className="mt-1 text-3xl font-semibold tracking-tight">
          Hola, {context.user.name.split(" ")[0]}
        </h1>
      </header>
      <section className="mt-6 grid gap-4 md:grid-cols-3">
        {(
          [
            ["Conversaciones abiertas", "—", MessageCircleMore],
            ["Esperando respuesta", "—", Clock3],
            ["Agentes configurados", "—", Bot],
          ] as const
        ).map(([label, value, Icon]) => (
          <Card key={String(label)}>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardDescription>{label}</CardDescription>
              <Icon className="size-4 text-muted-foreground" />
            </CardHeader>
            <CardContent>
              <p className="text-3xl font-semibold">{value}</p>
              <p className="mt-2 text-xs text-muted-foreground">
                Disponible en la etapa correspondiente
              </p>
            </CardContent>
          </Card>
        ))}
      </section>
      <section className="mt-6 grid gap-6 lg:grid-cols-[1.4fr_.6fr]">
        <Card>
          <CardHeader>
            <CardTitle>Base administrativa lista</CardTitle>
            <CardDescription>
              El acceso y el contexto organizacional ya protegen las futuras capacidades.
            </CardDescription>
          </CardHeader>
          <CardContent className="flex flex-col gap-4">
            {[
              "Sesión segura persistida en D1",
              "Organización activa validada en backend",
              `Rol ${active.role} con permisos efectivos`,
            ].map((item) => (
              <div className="flex items-center gap-3 text-sm" key={item}>
                <CheckCircle2 className="size-5 text-primary" />
                {item}
              </div>
            ))}
          </CardContent>
        </Card>
        <Card className="bg-sidebar text-sidebar-foreground">
          <CardHeader>
            <Sparkles className="mb-2 size-5 text-sidebar-primary" />
            <CardTitle>Próxima etapa</CardTitle>
            <CardDescription className="text-sidebar-foreground/60">
              El panel de conversaciones y agentes se habilitará cuando sus issues entren en
              fase activa.
            </CardDescription>
          </CardHeader>
        </Card>
      </section>
    </div>
  );
}
