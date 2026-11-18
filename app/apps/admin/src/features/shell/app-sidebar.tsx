"use client";

import { PanelLeftIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { BrandHeader } from "@hub/ui/product/brand-header";
import { ThemeSegmented, ThemeToggle } from "@hub/ui/product/theme";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@hub/ui/sidebar";
import { AppLink } from "@/components/app-link";
import { KeyHelp } from "@/components/key-help";
import { TerminalToggle } from "@/features/terminal/terminal";
import { NavIcon } from "./nav-icon";
import { ProjectSwitcher } from "./project-switcher";
import type { ShellNavItem } from "./shell";

type Keys = { open: boolean; onOpenChange: (open: boolean) => void; enabled: boolean; onEnabled: (on: boolean) => void };
export type Brand = { name: string; logoSrc: string | null };
type Props = { items: ShellNavItem[]; projects: string[]; project: string | null; onProject: (p: string) => void; brand: Brand; keys: Keys };

/**
 * The left column: the instance's brand on top, the project switcher under it only with two or more projects, the sections
 * (a dot on the one that fixes the project's worst fact), and in the footer the theme switcher, the terminal and the sidebar toggle. Wide
 * screens show it open; 640-1279 it is a 56px rail (labels as tooltips, the theme as one toggle) unless pinned open.
 */
export function AppSidebar({ items, projects, project, onProject, brand, keys }: Props) {
  const { toggleSidebar, state } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader className="gap-1">
        <BrandHeader logoSrc={brand.logoSrc} name={brand.name} />
        {project && projects.length > 1 && <ProjectSwitcher onChange={onProject} projects={projects} value={project} />}
      </SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Sections">
              <SidebarMenu>
                {items.map((i) => (
                  <SidebarMenuItem key={i.id}>
                    <SidebarMenuButton className="relative h-(--control-m) gap-3 px-3 group-data-[collapsible=icon]:size-(--control-m)! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!" isActive={i.active} render={<AppLink aria-current={i.active ? "page" : undefined} bare to={i.to} />} tooltip={i.dot ? `${i.title}: needs you` : i.title}>
                      <NavIcon name={i.icon} />
                      <span className="min-w-0 truncate">{i.title}</span>
                      {i.dot && (
                        <span className="ms-auto flex items-center group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:end-1.5 group-data-[collapsible=icon]:top-1.5" data-testid={`dot-${i.id}`}>
                          <span aria-hidden="true" className="size-2 rounded-full bg-warning" />
                          <span className="sr-only">needs you</span>
                        </span>
                      )}
                    </SidebarMenuButton>
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <ThemeSegmented className="group-data-[collapsible=icon]:hidden" />
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <ThemeToggle className="hidden group-data-[collapsible=icon]:inline-flex" />
          <TerminalToggle />
          <ActionButton aria-label={state === "expanded" ? "Collapse the sidebar" : "Expand the sidebar"} icon onClick={toggleSidebar} size="s" variant="quiet">
            <PanelLeftIcon aria-hidden="true" />
          </ActionButton>
          <KeyHelp {...keys} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
