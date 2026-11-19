"use client";

import { ChevronDownIcon } from "lucide-react";
import { cn } from "@hub/ui/cn";
import { Menu, MenuLinkItem, MenuPopup, MenuTrigger } from "@hub/ui/menu";
import { ActionButton } from "@hub/ui/product/action-button";
import { useRoute } from "@/hooks/use-route";
import { routeDest, sectionList } from "@/routes/paths";
import { childrenOf, sectionById, type SectionId } from "@/routes/sections";
import { ROUTE_TABLE } from "@/routes/table";
import { AppLink } from "./app-link";

const LINK = "inline-flex h-11 shrink-0 items-center rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-8";

/**
 * The sub-nav of a section with child pages (P63 N1; Settings since P70), in the header line of each of its pages: the landing
 * first, named by its own title (Settings opens on Sending), then the children in table order, `aria-current` on the page on
 * screen. It is how a child is reached on the rail and the phone, where the nav draws parents only. From 640px one `AppLink`
 * each; below it the five panes do not fit beside a 360px screen's edge (measured, P70 S1), so a coss `Menu` names the pane on
 * screen and lists the others: one tab stop. Both forms are in the markup and CSS picks one (`state-and-data.md` rule 11).
 */
export function SubNav({ section }: { section: SectionId }) {
  const route = useRoute();
  const parent = sectionById(section);
  if (!parent) return null;
  const pages = [{ key: parent.route, title: ROUTE_TABLE[parent.route].title, to: sectionList(section) }, ...childrenOf(section).map((c) => ({ key: c.route, title: c.title, to: routeDest(c.route) }))];
  const here = pages.find((p) => p.key === route.route) ?? pages[0];
  return (
    <nav aria-label={`${parent.title} pages`} className="flex min-w-0">
      <div className="-mx-1 flex min-w-0 gap-1 max-md:hidden">
        {pages.map((p) => {
          const on = p.key === here?.key;
          return (
            <AppLink aria-current={on ? "page" : undefined} bare className={cn(LINK, on ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")} key={p.key} to={p.to}>
              {p.title}
            </AppLink>
          );
        })}
      </div>
      <div className="md:hidden">
        <Menu>
          <MenuTrigger aria-label={`${parent.title} pages: ${here?.title ?? ""}`} render={<ActionButton size="m" variant="quiet" />}>
            {here?.title}
            <ChevronDownIcon aria-hidden="true" />
          </MenuTrigger>
          <MenuPopup align="start">
            {pages.map((p) => (
              <MenuLinkItem aria-current={p.key === here?.key ? "page" : undefined} key={p.key} render={<AppLink bare to={p.to} />}>
                {p.title}
              </MenuLinkItem>
            ))}
          </MenuPopup>
        </Menu>
      </div>
    </nav>
  );
}
