import { Outlet, Link, useLocation } from "react-router";

import { AppSidebar, activeSection } from "@/components/app-sidebar";
import {
  Breadcrumb,
  BreadcrumbItem,
  BreadcrumbLink,
  BreadcrumbList,
  BreadcrumbPage,
  BreadcrumbSeparator,
} from "@/components/ui/breadcrumb";
import { Separator } from "@/components/ui/separator";
import { SidebarInset, SidebarProvider, SidebarTrigger } from "@/components/ui/sidebar";
import type { AppContext } from "@/lib/api";

export type PanelContext = AppContext & {
  activeOrganization: NonNullable<AppContext["activeOrganization"]>;
};

/**
 * El shell acota la altura de la ventana y no scrollea: cada sección resuelve
 * su propio desplazamiento. Así el sidebar y la cabecera permanecen visibles
 * aunque el contenido crezca, como ocurre con una conversación larga.
 */
export function PanelShell({
  context,
  onSignOut,
}: {
  context: PanelContext;
  onSignOut: () => void;
}) {
  const { pathname } = useLocation();
  const current = activeSection(pathname);

  return (
    <SidebarProvider className="h-svh overflow-hidden">
      <AppSidebar context={context} onSignOut={onSignOut} />
      <SidebarInset className="min-h-0 overflow-hidden">
        <header className="flex h-14 shrink-0 items-center gap-2 border-b px-4">
          <SidebarTrigger className="-ml-1" />
          <Separator className="mr-2 data-[orientation=vertical]:h-4" orientation="vertical" />
          <Breadcrumb>
            <BreadcrumbList>
              <BreadcrumbItem className="hidden sm:block">
                <BreadcrumbLink asChild>
                  <Link to="/">Agent Cloudflare</Link>
                </BreadcrumbLink>
              </BreadcrumbItem>
              <BreadcrumbSeparator className="hidden sm:block" />
              <BreadcrumbItem>
                <BreadcrumbPage>{current.label}</BreadcrumbPage>
              </BreadcrumbItem>
            </BreadcrumbList>
          </Breadcrumb>
        </header>
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
          <Outlet context={context} />
        </div>
      </SidebarInset>
    </SidebarProvider>
  );
}
