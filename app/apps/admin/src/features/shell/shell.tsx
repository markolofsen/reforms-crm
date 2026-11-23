"use client";

import type { Dest } from "@/routes/paths";
import { useMemo, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { Link } from "@hub/ui/link";
import { SidebarInset, SidebarProvider, useSidebar } from "@hub/ui/sidebar";
import { useMediaQuery } from "@hub/ui/use-media-query";
import { cn } from "@hub/ui/cn";
import { useHotkeys, type KeyMap } from "@hub/ui/use-hotkey";
import { shortcutsOn, useShortcutsSwitch } from "@/hooks/use-shortcuts";
import { PaneNarrowContext, useMeasuredNarrow } from "@/hooks/use-pane";
import type { NavItem } from "@/hooks/use-section-nav";
import { useTerminalDocked } from "@/features/terminal/terminal";
import { save, useStored } from "@/lib/storage";
import type { Resolved } from "@/routes/resolve";
import type { ProjectLinksDto } from "@hub/contract/project";
import { AppSidebar, type Brand } from "./app-sidebar";
import { PhoneBar } from "./phone-bar";
import { TabBar } from "./tab-bar";

// The coss provider sets 16rem and 3rem inline; the product's own widths replace them (`--sidebar-width*`, 224px and 56px).
const WIDTHS: CSSProperties & Record<`--${string}`, string> = { "--sidebar-width": "14rem", "--sidebar-width-icon": "3.5rem" };

/** A section of the nav, with a dot when it (or one of its child pages) is a place that needs the owner (`useLitRoutes`). */
/** P96: `count` is the badge of a section (Mail: the clients who wrote and have no draft yet), as Mail's unread badge. */
/** One sidebar child: Mail's views (P103/P104) or Messengers' channels (P125 L5), each with its count. */
export type NavSub = { readonly id: string; readonly title: string; readonly to: Dest; readonly count: number; readonly active: boolean };
/** `subs`: the sidebar children of a section that splits by one axis, each with its count. */
export type ShellNavItem = NavItem & { dot: boolean; count?: number; subs?: readonly NavSub[] };

type Props = {
  items: ShellNavItem[];
  projects: string[];
  project: string | null;
  onProject: (p: string) => void;
  brand: Brand;
  route: Resolved;
  /** The right-hand column beside the screen, outside `#main` (P49 docks the embedded terminal here; it renders nothing when off). */
  dock?: ReactNode;
  links?: ProjectLinksDto | null;
  children: ReactNode;
};

const FRAME_HELP = [["[", "collapse or expand the sidebar"], ["?", "this list"]] as const;

function Frame({ items, projects, project, onProject, brand, route, dock, links, children }: Props) {
  const { toggleSidebar } = useSidebar();
  const [helpOpen, setHelpOpen] = useState(false);
  const [shortcuts, setShortcuts] = useShortcutsSwitch();
  const keys = useMemo<KeyMap>(() => ({ "?": () => setHelpOpen((o) => !o), "[": () => toggleSidebar() }), [toggleSidebar]);
  useHotkeys(keys, shortcutsOn, FRAME_HELP);
  // A phone shows the subject as a screen of its own; its action bar sticks to the bottom, so the tab bar steps aside.
  // The tab bar and the phone's top line are in the markup of every width and `md:hidden` takes them away (the server cannot know the viewport).
  const tabs = route.route !== "mail.conversation" && route.route !== "mail.lead";
  const content = useRef<HTMLDivElement>(null);
  const narrow = useMeasuredNarrow(content);
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
      <AppSidebar brand={brand} items={items} keys={{ open: helpOpen, onOpenChange: setHelpOpen, enabled: shortcuts, onEnabled: setShortcuts }} links={links} onProject={onProject} project={project} projects={projects} />
      <SidebarInset className={cn("flex h-svh min-h-0 min-w-0 flex-col overflow-hidden outline-none", tabs && "max-md:pb-(--tab-bar)")} id="main" tabIndex={-1}>
        {tabs && <PhoneBar brand={brand} onProject={onProject} project={project} projects={projects} />}
        <div className="flex min-h-0 min-w-0 flex-1 flex-col" ref={content}>
          <PaneNarrowContext value={narrow}>{children}</PaneNarrowContext>
        </div>
      </SidebarInset>
      {dock}
      {tabs && <TabBar items={items} links={links} />}
    </>
  );
}

/**
 * The one frame of every screen: sidebar | the screen (its own list and detail) | the terminal dock. No top bar
 * (a phone gets one line: brand, switcher, theme). The sidebar is open from 1280px and a rail below it unless the person
 * pinned it (remembered in `lib/storage`); while the terminal is docked below 1600px it folds to the rail without touching
 * the pin (an expand then holds for this page only). Hydration: the width comes from `useMediaQuery` and the pin from
 * `useStored`, both external stores with a server snapshot, so the first render is the server's and the real values follow.
 */
export function AppShell(props: Props) {
  const wide = useMediaQuery("xl");
  const roomy = useMediaQuery("3xl");
  const pin = useStored("rail");
  const folded = useTerminalDocked() && !roomy;
  const [unfolded, setUnfolded] = useState(false);
  const open = folded ? unfolded : pin === "open" ? true : pin === "closed" ? false : wide;
  return (
    <SidebarProvider className="h-svh min-h-0" onOpenChange={(next) => (folded ? setUnfolded(next) : save("rail", next ? "open" : "closed"))} open={open} style={WIDTHS}>
      <Frame {...props} />
    </SidebarProvider>
  );
}
