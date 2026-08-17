import {
  Bot,
  CalendarDays,
  CircleGauge,
  Contact,
  Inbox,
  KanbanSquare,
  ListTodo,
  MessageCircleMore,
  Scissors,
  Settings2,
  Users,
} from "lucide-react";
import type { ComponentProps } from "react";
import { Link, useLocation } from "react-router";

import { NavUser } from "@/components/nav-user";
import {
  Sidebar,
  SidebarContent,
  SidebarFooter,
  SidebarGroup,
  SidebarGroupContent,
  SidebarGroupLabel,
  SidebarHeader,
  SidebarMenu,
  SidebarMenuBadge,
  SidebarMenuButton,
  SidebarMenuItem,
} from "@/components/ui/sidebar";
import type { PanelContext } from "@/components/panel-shell";

/**
 * Las secciones disponibles son rutas reales para que la URL, el estado activo
 * del menú y la ruta de navegación deriven de la misma fuente. Las planeadas no
 * tienen ruta: se anuncian deshabilitadas y no pueden abrirse.
 */
export const panelSections = [
  { label: "Resumen", icon: CircleGauge, path: "/app" },
  { label: "Conversaciones", icon: Inbox, path: "/app/conversaciones" },
  { label: "Contactos", icon: Contact, path: "/app/contactos" },
  { label: "Servicios", icon: Scissors, path: "/app/servicios" },
  { label: "Pipeline", icon: KanbanSquare, path: "/app/pipeline" },
  { label: "Tareas", icon: ListTodo, path: "/app/tareas" },
  { label: "Agenda", icon: CalendarDays, path: "/app/agenda" },
  { label: "Agentes", icon: Bot, path: "/app/agentes" },
  { label: "Equipo", icon: Users, path: "/app/equipo" },
  { label: "Configuración", icon: Settings2, path: null },
] as const;

export type PanelSection = (typeof panelSections)[number];

export function activeSection(pathname: string): PanelSection {
  const match = panelSections.find(
    (section) => section.path !== null && section.path !== "/app" && pathname.startsWith(section.path),
  );
  return match ?? panelSections[0];
}

export function AppSidebar({
  context,
  onSignOut,
  ...props
}: ComponentProps<typeof Sidebar> & {
  context: PanelContext;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const current = activeSection(pathname);
  const organization = context.activeOrganization;

  return (
    <Sidebar collapsible="icon" variant="inset" {...props}>
      <SidebarHeader>
        <SidebarMenu>
          <SidebarMenuItem>
            <SidebarMenuButton asChild size="lg" tooltip={organization.organizationName}>
              <Link to="/app">
                <span className="flex aspect-square size-8 items-center justify-center rounded-lg bg-sidebar-primary text-sidebar-primary-foreground">
                  <MessageCircleMore className="size-4" aria-hidden="true" />
                </span>
                <span className="grid flex-1 text-left text-sm leading-tight">
                  <span className="truncate font-medium">{organization.organizationName}</span>
                  <span className="truncate text-xs capitalize">{organization.role}</span>
                </span>
              </Link>
            </SidebarMenuButton>
          </SidebarMenuItem>
        </SidebarMenu>
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupLabel>Panel</SidebarGroupLabel>
          <SidebarGroupContent>
            <SidebarMenu>
              {panelSections.map(({ label, icon: Icon, path }) => (
                <SidebarMenuItem key={label}>
                  {path === null ? (
                    <>
                      <SidebarMenuButton disabled tooltip={`${label} · planeado`}>
                        <Icon />
                        <span>{label}</span>
                      </SidebarMenuButton>
                      <SidebarMenuBadge>Planeado</SidebarMenuBadge>
                    </>
                  ) : (
                    <SidebarMenuButton asChild isActive={current.label === label} tooltip={label}>
                      <Link to={path}>
                        <Icon />
                        <span>{label}</span>
                      </Link>
                    </SidebarMenuButton>
                  )}
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <NavUser onSignOut={onSignOut} user={context.user} />
      </SidebarFooter>
    </Sidebar>
  );
}
