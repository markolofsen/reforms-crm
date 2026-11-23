"use client";

import { ChevronRightIcon, ExternalLinkIcon, Link2Icon } from "lucide-react";
import type { OpenLink } from "@hub/contract/local";
import type { ProjectLinksDto } from "@hub/contract/project";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { Menu, MenuGroup, MenuGroupLabel, MenuItem, MenuLinkItem, MenuPopup, MenuSeparator, MenuSub, MenuSubPopup, MenuSubTrigger, MenuTrigger } from "@hub/ui/menu";
import { SidebarMenu, SidebarMenuButton, SidebarMenuItem, useSidebar } from "@hub/ui/sidebar";
import { cn } from "@hub/ui/cn";
import { Link } from "@hub/ui/link";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@hub/ui/tooltip";
import { save, useStored } from "@/lib/storage";
import { anchorProps, webLink } from "@/lib/external";
import { useOpenLink } from "@/components/links/open-link";

type Props = { links: ProjectLinksDto };

/** An empty project should not spend a shell row on a menu that can only say "No links declared". */
export function hasQuickLinks(links: ProjectLinksDto | null | undefined): links is ProjectLinksDto {
  return (links?.links.length ?? 0) > 0;
}

function linkIcon(link: ProjectLinksDto["links"][number]) {
  return link.kind === "https" ? <ExternalLinkIcon aria-hidden="true" /> : <Link2Icon aria-hidden="true" />;
}

/**
 * P131 verdict 4: `project.md` holds the web address; how it opens is decided here, on this Mac: a Notion page in the app when
 * it is installed (else the browser), any other page in a new tab. Null for a link the project could not resolve.
 */
function useQuickLink(link: ProjectLinksDto["links"][number]): OpenLink | null {
  const known = useOpenLink(link.href);
  return link.href ? (known ?? webLink(link.href)) : null;
}

function LinkItem({ link }: { link: ProjectLinksDto["links"][number] }) {
  const icon = linkIcon(link);
  const open = useQuickLink(link);
  if (!open) return <MenuItem disabled>{icon}<span className="truncate">{link.label}</span></MenuItem>;
  return (
    <MenuLinkItem render={<Link bare {...anchorProps(open)} />}>
      {icon}
      <Tooltip>
        <TooltipTrigger render={<span className="min-w-0 truncate">{link.label}</span>} />
        <TooltipPopup>{link.target}</TooltipPopup>
      </Tooltip>
    </MenuLinkItem>
  );
}

function SidebarLinkItem({ link, nested = false }: { link: ProjectLinksDto["links"][number]; nested?: boolean }) {
  const icon = linkIcon(link);
  const open = useQuickLink(link);
  if (!open) return <SidebarMenuButton className={cn(nested && "ps-8")} disabled tooltip={link.target}>{icon}<span className="truncate">{link.label}</span></SidebarMenuButton>;
  return (
    <SidebarMenuButton
      className={cn(nested && "ps-8")}
      render={<Link bare {...anchorProps(open)} />}
      tooltip={link.target}
    >
      {icon}
      <span className="truncate">{link.label}</span>
    </SidebarMenuButton>
  );
}

function SidebarLinkGroups({ links }: Props) {
  const groups = [...new Set(links.links.map((link) => link.group))];
  if (groups.length === 0) return <li><p className="px-3 py-2 text-muted-foreground text-xs">No links declared for this project</p></li>;
  return (
    <>
      {links.notion.state !== "ready" && <li><p className="px-3 py-1 text-muted-foreground text-xs">{links.notion.message ?? "Notion links are not ready"}</p></li>}
      {groups.map((group) => <SidebarLinkGroup group={group} key={group} links={links.links.filter((link) => link.group === group)} />)}
    </>
  );
}

function readGroupState(value: string | null): Record<string, boolean> {
  if (!value) return {};
  try {
    const parsed: unknown = JSON.parse(value);
    if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return {};
    const groups: Record<string, boolean> = {};
    for (const [group, open] of Object.entries(parsed)) if (typeof open === "boolean") groups[group] = open;
    return groups;
  } catch {
    return {};
  }
}

function SidebarLinkGroup({ group, links }: { group: string; links: ProjectLinksDto["links"] }) {
  const stored = useStored("quick-links-groups");
  const open = readGroupState(stored)[group] ?? false;
  const parents = links.filter((link) => link.under === null);
  const setOpen = (next: boolean) => save("quick-links-groups", JSON.stringify({ ...readGroupState(stored), [group]: next }));
  return (
    <li>
      <Collapsible onOpenChange={setOpen} open={open}>
        <CollapsibleTrigger aria-label={open ? `Collapse ${group}` : `Expand ${group}`} className="group flex min-h-(--control-s) w-full items-center gap-2 px-3 py-1 text-start text-muted-foreground text-xs">
          <ChevronRightIcon aria-hidden="true" className={cn("size-3 transition-transform", open && "rotate-90")} />
          <span className="min-w-0 truncate font-medium">{group}</span>
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <SidebarMenu className="gap-0">
            {parents.flatMap((parent) => [
              <SidebarMenuItem key={`${group}:${parent.label}`}><SidebarLinkItem link={parent} /></SidebarMenuItem>,
              ...links.filter((link) => link.under?.toLowerCase() === parent.label.toLowerCase()).map((child) => <SidebarMenuItem key={`${group}:${child.label}`}><SidebarLinkItem link={child} nested /></SidebarMenuItem>),
            ])}
          </SidebarMenu>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}

function QuickLinksDisclosure({ links }: Props) {
  const remembered = useStored("quick-links");
  const open = remembered === "open";
  return (
    <Collapsible open={open} onOpenChange={(next) => save("quick-links", next ? "open" : "closed")}>
      <CollapsibleTrigger
        aria-label={open ? "Collapse Quick Links" : "Expand Quick Links"}
        className="w-full"
        render={<SidebarMenuButton className="relative h-(--control-m) gap-3 px-3" />}
      >
        <ChevronRightIcon aria-hidden="true" className={cn("transition-transform", open && "rotate-90")} />
        <Link2Icon aria-hidden="true" />
        <span className="min-w-0 truncate">Quick Links</span>
      </CollapsibleTrigger>
      <CollapsiblePanel>
        <SidebarMenu><SidebarLinkGroups links={links} /></SidebarMenu>
      </CollapsiblePanel>
    </Collapsible>
  );
}

function MenuLinkTreeItem({ parent, nested, group }: { parent: ProjectLinksDto["links"][number]; nested: ProjectLinksDto["links"][number][]; group: string }) {
  if (nested.length === 0) return <LinkItem link={parent} />;
  return (
    <MenuSub>
      <MenuSubTrigger>{linkIcon(parent)}<span className="min-w-0 truncate">{parent.label}</span></MenuSubTrigger>
      <MenuSubPopup>
        <LinkItem link={parent} />
        {nested.map((child) => <LinkItem key={`${group}:${child.label}`} link={child} />)}
      </MenuSubPopup>
    </MenuSub>
  );
}

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
            {parents.map((parent) => (
              <MenuLinkTreeItem group={group} key={`${group}:${parent.label}`} nested={rows.filter((link) => link.under?.toLowerCase() === parent.label.toLowerCase())} parent={parent} />
            ))}
          </MenuGroup>
        );
      })}
    </>
  );
}

/** One compact shell entry; the popup is the same interaction in the rail and the expanded sidebar. */
export function QuickLinksMenu({ links }: Props) {
  const { state } = useSidebar();
  if (state === "expanded") return <QuickLinksDisclosure links={links} />;
  return (
    <Menu>
      <MenuTrigger
        aria-label="Quick Links"
        className="w-full"
        render={
          <SidebarMenuButton
            className={cn("relative h-(--control-m) gap-3 px-3 group-data-[collapsible=icon]:size-(--control-m)! group-data-[collapsible=icon]:justify-center group-data-[collapsible=icon]:px-0!")}
            tooltip="Quick Links"
          />
        }
      >
        <Link2Icon aria-hidden="true" />
        <span className="min-w-0 truncate group-data-[collapsible=icon]:sr-only">Quick Links</span>
      </MenuTrigger>
      <MenuPopup align="start" side="right" className="min-w-56">
        <LinkGroups links={links} />
      </MenuPopup>
    </Menu>
  );
}

/** The phone's More menu uses the same rows without creating a second link model. */
export function QuickLinksMenuItems({ links }: Props) {
  return <LinkGroups links={links} />;
}
