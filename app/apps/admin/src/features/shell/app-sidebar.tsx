"use client";

import { PanelLeftIcon } from "lucide-react";
import type { ProjectLinksDto } from "@hub/contract/responses";
import { ActionButton } from "@hub/ui/product/action-button";
import { BrandHeader } from "@hub/ui/product/brand-header";
import { ThemeSegmented, ThemeToggle } from "@hub/ui/product/theme";
import { Sidebar, SidebarContent, SidebarFooter, SidebarGroup, SidebarGroupContent, SidebarHeader, SidebarMenu, SidebarMenuButton, SidebarMenuItem, SidebarMenuSub, SidebarMenuSubButton, SidebarMenuSubItem, useSidebar } from "@hub/ui/sidebar";
import { useHotkey } from "@hub/ui/use-hotkey";
import { AppLink } from "@/components/app-link";
import { KeyHelp } from "@/components/key-help";
import { NavDot } from "@/components/nav-dot";
import { SoundToggle } from "@/features/agent-feed/sound-toggle";
import { CoreLine } from "@/features/settings/mac/core-line";
import { NavIcon } from "./nav-icon";
import { ProjectSwitcher } from "./project-switcher";
import { hasQuickLinks, QuickLinksMenu } from "@/features/quick-links/menu";
import type { ShellNavItem } from "./shell";

type Keys = { open: boolean; onOpenChange: (open: boolean) => void; enabled: boolean; onEnabled: (on: boolean) => void };
export type Brand = { name: string; logoSrc: string | null };
type Props = { items: ShellNavItem[]; projects: string[]; project: string | null; onProject: (p: string) => void; brand: Brand; keys: Keys; links?: ProjectLinksDto | null };

/**
 * The left column: the instance's brand on top, the project switcher under it only with two or more projects, the sections
 * (a dot on each that needs the owner; parents only, P75: a section's child pages are its sub-nav's, in the page's header line),
 * and in the footer the agent's last five rows (P59), the core version line
 * (P68, a link to /health), the theme switcher, the agent sounds' switch and the sidebar toggle (the terminal is the strip on the right edge). Wide
 * screens show it open; 640-1279 it is a 56px rail (labels as tooltips, the theme as one toggle) unless pinned open.
 */
export function AppSidebar({ items, projects, project, onProject, brand, keys, links }: Props) {
  const { toggleSidebar, state } = useSidebar();
  useHotkey("mod+b", toggleSidebar, keys.enabled);
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
                    <SidebarMenuButton className="relative h-(--control-m) gap-3 px-3 group-data-[collapsible=icon]:size-(--control-m)! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!" isActive={i.active} render={<AppLink aria-current={i.active && !i.children.some((c) => c.active) && !i.subs?.some((c) => c.active) ? "page" : undefined} bare to={i.to} />} tooltip={i.dot ? `${i.title}: needs you` : i.title}>
                      <NavIcon name={i.icon} />
                      <span className="min-w-0 truncate group-data-[collapsible=icon]:sr-only">{i.title}</span>
                      {i.count !== undefined && (
                        <span className="ms-auto shrink-0 rounded-full bg-primary px-1.5 font-medium text-primary-foreground text-xs tabular-nums group-data-[collapsible=icon]:absolute group-data-[collapsible=icon]:top-0.5 group-data-[collapsible=icon]:end-0.5 group-data-[collapsible=icon]:px-1" data-testid={`nav-count-${i.id}`}>
                          {i.count}
                          <span className="sr-only"> need you</span>
                        </span>
                      )}
                      {i.dot && <NavDot at="rail" id={i.id} />}
                    </SidebarMenuButton>
                    {i.subs && i.subs.length > 0 && (
                      <SidebarMenuSub aria-label={`${i.title} channels`}>
                        {i.subs.map((c) => (
                          <SidebarMenuSubItem key={c.id}>
                            <SidebarMenuSubButton isActive={c.active} render={<AppLink aria-current={c.active ? "page" : undefined} bare to={c.to} />}>
                              <span className="min-w-0 truncate">{c.title}</span>
                              {c.count > 0 && (
                                <span className="ms-auto shrink-0 text-muted-foreground text-xs tabular-nums" data-testid={`nav-count-${i.id}-${c.id}`}>
                                  {c.count}
                                  <span className="sr-only"> need you</span>
                                </span>
                              )}
                            </SidebarMenuSubButton>
                          </SidebarMenuSubItem>
                        ))}
                      </SidebarMenuSub>
                    )}
                  </SidebarMenuItem>
                ))}
              </SidebarMenu>
            </nav>
          </SidebarGroupContent>
        </SidebarGroup>
        {hasQuickLinks(links) && (
          <SidebarGroup>
            <SidebarGroupContent>
              <SidebarMenu>
                <SidebarMenuItem>
                  <QuickLinksMenu links={links} />
                </SidebarMenuItem>
              </SidebarMenu>
            </SidebarGroupContent>
          </SidebarGroup>
        )}
      </SidebarContent>
      <SidebarFooter>
        <CoreLine />
        <ThemeSegmented className="group-data-[collapsible=icon]:hidden" />
        <div className="flex items-center gap-1 group-data-[collapsible=icon]:flex-col">
          <ThemeToggle className="hidden group-data-[collapsible=icon]:inline-flex" />
          <SoundToggle />
          <ActionButton aria-keyshortcuts="Meta+B Control+B" aria-label={state === "expanded" ? "Collapse the sidebar" : "Expand the sidebar"} icon onClick={toggleSidebar} size="s" tooltip={{ content: state === "expanded" ? "Collapse the sidebar" : "Expand the sidebar", hotkey: "Meta/Ctrl + B" }} variant="quiet">
            <PanelLeftIcon aria-hidden="true" />
          </ActionButton>
          <KeyHelp {...keys} />
        </div>
      </SidebarFooter>
    </Sidebar>
  );
}
