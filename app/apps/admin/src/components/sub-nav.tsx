"use client";

import { cn } from "@hub/ui/cn";
import { useRoute } from "@/hooks/use-route";
import { routeDest, sectionList } from "@/routes/paths";
import { childrenOf, sectionById, type SectionId } from "@/routes/sections";
import { AppLink } from "./app-link";

const LINK = "inline-flex h-11 shrink-0 items-center rounded-md px-3 text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring lg:h-8";

/**
 * The sub-nav of a section with child pages (P63 N1), in the header line of each of its pages on every width: the landing first,
 * then the children in table order, one `AppLink` each, `aria-current` on the page on screen. It is how a child is reached on the
 * rail and the phone, where the nav draws parents only; 44px high below 1024px.
 */
export function SubNav({ section }: { section: SectionId }) {
  const route = useRoute();
  const parent = sectionById(section);
  if (!parent) return null;
  const pages = [{ key: parent.route, title: parent.title, to: sectionList(section) }, ...childrenOf(section).map((c) => ({ key: c.route, title: c.title, to: routeDest(c.route) }))];
  return (
    <nav aria-label={`${parent.title} pages`} className="-mx-1 flex min-w-0 gap-1 overflow-x-auto">
      {pages.map((p) => {
        const here = route.route === p.key;
        return (
          <AppLink aria-current={here ? "page" : undefined} bare className={cn(LINK, here ? "bg-accent font-medium text-foreground" : "text-muted-foreground hover:text-foreground")} key={p.key} to={p.to}>
            {p.title}
          </AppLink>
        );
      })}
    </nav>
  );
}
