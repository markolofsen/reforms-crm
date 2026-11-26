"use client";

import { SectionLayout } from "@hub/ui/product/shell/section-layout";
import { SectionNav } from "@hub/ui/product/shell/section-nav";
import type { ReactNode } from "react";
import { usePlace } from "@/hooks/use-project";
import { useRoute } from "@/hooks/use-route";
import { dest, sectionList } from "@/routes/paths";
import { childrenOf, sectionById, type SectionId } from "@/routes/sections";
import { ROUTE_TABLE } from "@/routes/table";
import { AppLink } from "./app-link";
import { NavDot, useLitRoutes } from "./nav-dot";

/**
 * The menu column of a section with child pages (P125 L4, admin-principles rule 13): the landing first, named by its own title
 * (Settings opens on Sending), then the children in table order, `aria-current` on the page on screen and the dot of a page that
 * needs the owner. A column beside the page at every width (compact below 960px of the layout's width). It replaces
 * the header tabs of the old `SubNav` (deleted with P125 L5, when Messengers' Settings became a group here).
 */
export function SectionMenu({ section, children }: { section: SectionId; children: ReactNode }) {
  const route = useRoute();
  const lit = useLitRoutes(usePlace().project);
  const parent = sectionById(section);
  if (!parent) return <>{children}</>;
  const pages = [{ key: parent.route, title: ROUTE_TABLE[parent.route].title, to: sectionList(section) }, ...childrenOf(section).map((c) => ({ key: c.route, title: c.title, to: dest(c.route) }))];
  const here = pages.find((p) => p.key === route.route) ?? pages[0];
  const groupOf = (key: string) => key === "settings.mail" || key === "settings.messengers" ? "Channels" : key === "settings.agent" ? "Agent" : key === "settings.page" || key === "settings.checks" ? "Sending" : "System";
  const order = ["Channels", "Agent", "Sending", "System"];
  const ordered = section === "settings" ? [...pages].sort((a, b) => order.indexOf(groupOf(a.key)) - order.indexOf(groupOf(b.key))) : pages;
  const items = ordered.map((p) => ({
    id: p.key,
    label: p.title,
    ...(section === "settings" ? { group: groupOf(p.key) } : {}),
    current: p.key === here?.key,
    render: (content: ReactNode, className: string) => (
      <AppLink aria-current={p.key === here?.key ? "page" : undefined} bare className={className} to={p.to}>
        {lit.has(p.key) && <NavDot at="lead" id={`section-${p.key}`} />}
        {content}
      </AppLink>
    ),
  }));
  return (
    <SectionLayout nav={<SectionNav items={items} label={`${parent.title} pages`} />} navLabel={`${parent.title} pages`}>
      {children}
    </SectionLayout>
  );
}
