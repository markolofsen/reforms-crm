"use client";

import { PanelLeftIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { AppLink } from "@/components/app-link";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@hub/ui/sidebar";
import type { NavItem } from "@/hooks/use-section-nav";
import { NavIcon } from "./nav-icon";
import { ProjectSwitcher } from "./project-switcher";
import { KeyHelp } from "@/components/key-help";
import { StatusFooter, type StatusInput } from "./status-footer";

type Keys = { open: boolean; onOpenChange: (open: boolean) => void; enabled: boolean; onEnabled: (on: boolean) => void };
type Props = { items: NavItem[]; projects: string[]; project: string | null; onProject: (p: string) => void; status: StatusInput; keys: Keys };

/**
 * The left column: project switcher on top, the sections, the status area in the footer. Wide screens show it open;
 * 1024-1279 it is a 56px rail (labels as tooltips) unless pinned open with the toggle, which remembers the choice.
 */
export function AppSidebar({ items, projects, project, onProject, status, keys }: Props) {
  const { toggleSidebar, state } = useSidebar();
  return (
    <Sidebar collapsible="icon">
      <SidebarHeader>{project && <ProjectSwitcher onChange={onProject} projects={projects} value={project} />}</SidebarHeader>
      <SidebarContent>
        <SidebarGroup>
          <SidebarGroupContent>
            <nav aria-label="Sections">
            <SidebarMenu>
              {items.map((i) => (
                <SidebarMenuItem key={i.id}>
                  <SidebarMenuButton className="h-(--control-m) gap-3 px-3 group-data-[collapsible=icon]:size-(--control-m)!" isActive={i.active} render={<AppLink aria-current={i.active ? "page" : undefined} bare to={i.to} />} tooltip={i.title}>
                    <NavIcon name={i.icon} />
                    <span>{i.title}</span>
                  </SidebarMenuButton>
                </SidebarMenuItem>
              ))}
            </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
      </SidebarContent>
      <SidebarFooter>
        <StatusFooter {...status} />
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <ActionButton aria-label={state === "expanded" ? "Collapse the sidebar" : "Expand the sidebar"} icon onClick={toggleSidebar} size="s" variant="quiet">
            <PanelLeftIcon aria-hidden="true" />
          </ActionButton>
          <KeyHelp {...keys} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
