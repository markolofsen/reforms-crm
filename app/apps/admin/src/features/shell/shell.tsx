"use client";

import { useMemo, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "@/components/ui/link";
import { SidebarInset, SidebarProvider, useSidebar } from "@/components/ui/sidebar";
import { shortcutsOn, useHotkeys, useShortcutsSwitch, type KeyMap } from "@/hooks/use-hotkeys";
import { useMediaQuery } from "@/hooks/use-media-query";
import type { NavItem } from "@/hooks/use-section-nav";
import { save, useStored } from "@/lib/storage";
import type { Resolved } from "@/routes/resolve";
import { cn } from "@/lib/utils";
import { AppSidebar } from "./app-sidebar";
import type { StatusInput } from "./status-footer";
import { TabBar } from "./tab-bar";

// The coss provider sets 16rem and 3rem inline; the product's own widths replace them (`--sidebar-width*`, 224px and 56px).
const WIDTHS: CSSProperties & Record<`--${string}`, string> = { "--sidebar-width": "14rem", "--sidebar-width-icon": "3.5rem" };

type Props = { items: NavItem[]; projects: string[]; project: string | null; onProject: (p: string) => void; status: StatusInput; route: Resolved; children: ReactNode };

const FRAME_HELP = [["[", "collapse or expand the sidebar"], ["?", "this list"]] as const;

function Frame({ items, projects, project, onProject, status, route, children }: Props) {
  const { toggleSidebar } = useSidebar();
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcuts, setShortcuts] = useShortcutsSwitch();
  const keys = useMemo<KeyMap>(() => ({ "?": () => setHelpOpen((o) => !o), "[": () => toggleSidebar() }), [toggleSidebar]);
  useHotkeys(keys, shortcutsOn, FRAME_HELP);
  // A phone shows the subject as a screen of its own; its action bar sticks to the bottom, so the tab bar steps aside.
  // The tab bar is in the markup of every width and `md:hidden` takes it away (the server cannot know the viewport).
  const tabs = route.route !== "drafts.item";
  return (
    <>
      {/* The first stop of the page, before the sidebar. Focus moves to the main region; the address does not change (a plain `#main` link would add a fragment and a history entry). */}
      <Link
        bare
        className="sr-only focus:not-sr-only focus:fixed focus:start-2 focus:top-2 focus:z-50 focus:rounded-md focus:bg-background focus:px-3 focus:py-2 focus:underline"
        href="#main"
        onClick={(e) => {
          e.preventDefault();
          document.getElementById("main")?.focus();
        }}
      >
        Skip to content
      </Link>
      <AppSidebar items={items} onProject={onProject} project={project} projects={projects} status={status} keys={{ open: helpOpen, onOpenChange: setHelpOpen, enabled: shortcuts, onEnabled: setShortcuts }} />
      <SidebarInset className={cn("h-svh min-h-0 min-w-0 overflow-hidden outline-none", tabs && "max-md:pb-(--tab-bar)")} id="main" tabIndex={-1}>
        {children}
      </SidebarInset>
      {tabs && <TabBar items={items} />}
    </>
  );
}

/**
 * The one frame of every screen: sidebar | list column | detail pane (the two columns are the screen's own). No top
 * bar. The sidebar is open from 1280px and a rail below it unless the person pinned it (remembered in `lib/storage`).
 * Hydration: the width comes from `useMediaQuery` and the pin from `useStored`, both external stores with a server
 * snapshot, so the first render is the server's and the real values follow.
 */
export function AppShell(props: Props) {
  const wide = useMediaQuery("xl");
  // The pinned choice is a stored value: `null` in the first render (server and browser agree), the person's choice after.
  const pin = useStored("rail");
  const open = pin === "open" ? true : pin === "closed" ? false : wide;
  return (
    <SidebarProvider
      className="h-svh min-h-0"
      onOpenChange={(next) => save("rail", next ? "open" : "closed")}
      open={open}
      style={WIDTHS}
    >
      <Frame {...props} />
    </SidebarProvider>
  );
}
