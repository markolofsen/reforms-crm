"use client";

import { ExternalLinkIcon, Link2Icon } from "lucide-react";
import { useMemo, useState } from "react";
import type { OpenLink } from "@hub/contract/local";
import type { ProjectLinksDto } from "@hub/contract/project";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuTrigger } from "@hub/ui/menu";
import { SidebarMenuButton } from "@hub/ui/sidebar";
import { cn } from "@hub/ui/cn";
import { Kbd } from "@hub/ui/kbd";
import { Link } from "@hub/ui/link";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@hub/ui/tooltip";
import { useHotkeys, type KeyMap } from "@hub/ui/use-hotkey";
import { shortcutsOn } from "@/hooks/use-shortcuts";
import { anchorProps, webLink } from "@/lib/external";
import { useOpenLink } from "@/components/links/open-link";

type Props = { links: ProjectLinksDto };
type QuickLink = ProjectLinksDto["links"][number];

/** An empty project should not spend a shell row on a menu that can only say "No links declared". */
export function hasQuickLinks(links: ProjectLinksDto | null | undefined): links is ProjectLinksDto {
  return (links?.links.length ?? 0) > 0;
}

function linkIcon(link: QuickLink) {
  return link.kind === "https" ? <ExternalLinkIcon aria-hidden="true" /> : <Link2Icon aria-hidden="true" />;
}

/**
 * P131 verdict 4: `project.md` holds the web address; how it opens is decided here, on this Mac: a Notion page in the app when
 * it is installed (else the browser), any other page in a new tab. Null for a link the project could not resolve.
 */
function useQuickLink(link: QuickLink): OpenLink | null {
  const known = useOpenLink(link.href);
  return link.href ? (known ?? webLink(link.href)) : null;
}

function LinkItem({ link, nested }: { link: QuickLink; nested: boolean }) {
  const icon = linkIcon(link);
  const open = useQuickLink(link);
  const indent = cn(nested && "ps-7");
  if (!open)
    return (
      <MenuItem className={indent} disabled>
        {icon}
        <span className="truncate">{link.label}</span>
      </MenuItem>
    );
  return (
    <MenuLinkItem className={indent} render={<Link bare {...anchorProps(open)} />}>
      {icon}
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate">{link.label}</span>} />
        <TooltipPopup>{link.target}</TooltipPopup>
      </Tooltip>
    </MenuLinkItem>
  );
}

/**
 * Every group open at once (P134 verdict 9): the group's name as a plain heading, then its links, a link declared under another
 * one indented beneath it. No disclosure at any level; the menu's own keys move (arrows) and close (Esc).
 */
function LinkGroups({ links }: Props) {
  const groups = [...new Set(links.links.map((link) => link.group))];
  if (groups.length === 0) return <MenuItem disabled>No links declared for this project</MenuItem>;
  return (
    <>
      {links.notion.state !== "ready" && <MenuItem disabled>{links.notion.message ?? "Notion links are not ready"}</MenuItem>}
      {groups.map((group, index) => {
        const rows = links.links.filter((link) => link.group === group);
        const parents = rows.filter((link) => link.under === null);
        return (
          <MenuGroup key={group}>
            {index > 0 && <MenuSeparator />}
            <MenuGroupLabel>{group}</MenuGroupLabel>
            {parents.flatMap((parent) => [
              <LinkItem key={`${group}:${parent.label}`} link={parent} nested={false} />,
              ...rows.filter((link) => link.under?.toLowerCase() === parent.label.toLowerCase()).map((child) => <LinkItem key={`${group}:${child.label}`} link={child} nested />),
            ])}
          </MenuGroup>
        );
      })}
    </>
  );
}

const HELP = [["G L", "open Quick links"]] as const;

/**
 * Quick links in the sidebar (P134 verdict 9): one row, its icon, its name and `G L`; a click opens a menu to the right of the
 * sidebar with every group expanded. The same in the rail and the open sidebar; it scrolls past about twelve rows.
 */
export function QuickLinksMenu({ links }: Props) {
  const [open, setOpen] = useState(false);
  const keys = useMemo<KeyMap>(() => ({ "g l": (e) => { e.preventDefault(); setOpen(true); } }), []);
  useHotkeys(keys, shortcutsOn, HELP, { capture: true });
  return (
    <Menu onOpenChange={setOpen} open={open}>
      <MenuTrigger
        aria-keyshortcuts="G L"
        className="w-full"
        render={<SidebarMenuButton className="relative h-(--control-m) gap-3 px-3 group-data-[collapsible=icon]:size-(--control-m)! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!" tooltip="Quick links" />}
      >
        <Link2Icon aria-hidden="true" />
        <span className="min-w-0 flex-1 truncate text-start group-data-[collapsible=icon]:sr-only">Quick links</span>
        <Kbd className="group-data-[collapsible=icon]:hidden" aria-hidden="true">G L</Kbd>
      </MenuTrigger>
      <MenuPopup align="start" className="max-h-[min(30rem,80svh)] min-w-60 overflow-y-auto" side="right">
        <LinkGroups links={links} />
      </MenuPopup>
    </Menu>
  );
}

/** The phone's More menu uses the same rows without creating a second link model. */
export function QuickLinksMenuItems({ links }: Props) {
  return <LinkGroups links={links} />;
}
