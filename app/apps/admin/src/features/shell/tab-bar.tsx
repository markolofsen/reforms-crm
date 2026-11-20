import { EllipsisIcon } from "lucide-react";
import { Menu, MenuLinkItem, MenuPopup, MenuTrigger } from "@hub/ui/menu";
import { cn } from "@hub/ui/cn";
import { AppLink } from "@/components/app-link";
import { NavIcon } from "./nav-icon";
import type { ShellNavItem } from "./shell";

const TAB = "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] tracking-tighter outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&>svg]:size-5";
const tone = (active: boolean) => (active ? "font-medium text-foreground" : "text-muted-foreground");

function Mark({ active, dot, id }: { active: boolean; dot: boolean; id: string }) {
  return (
    <>
      {active && <span aria-hidden="true" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />}
      {dot && (
        <span className="absolute top-1.5 end-[calc(50%-0.875rem)]" data-testid={`tab-dot-${id}`}>
          <span aria-hidden="true" className="block size-2 rounded-full bg-warning" />
          <span className="sr-only">needs you</span>
        </span>
      )}
    </>
  );
}

/**
 * The More item (P63 N1): a coss `Menu` of the sections whose phone place is "more" (Knowledge, Help, P70), with a dot when
 * one of them has one. Five items share 360px (72px each).
 */
function MoreMenu({ items }: { items: ShellNavItem[] }) {
  const active = items.some((i) => i.active);
  const dot = items.some((i) => i.dot);
  return (
    <Menu>
      <MenuTrigger aria-label={dot ? "More sections: one needs you" : "More sections"} className={cn(TAB, tone(active))} data-testid="tab-more">
        <Mark active={active} dot={dot} id="more" />
        <EllipsisIcon aria-hidden="true" />
        More
      </MenuTrigger>
      <MenuPopup align="end" side="top">
        {items.map((i) => (
          <MenuLinkItem aria-current={i.active ? "page" : undefined} key={i.id} render={<AppLink bare to={i.to} />}>
            <NavIcon name={i.icon} />
            {i.title}
            {i.dot && <span className="sr-only">: needs you</span>}
            {i.dot && <span aria-hidden="true" className="ms-auto size-2 rounded-full bg-warning" />}
          </MenuLinkItem>
        ))}
      </MenuPopup>
    </Menu>
  );
}

/** Phones (hidden from 640px by CSS): the sections of the bar (Overview, Mail, Activity, Settings), then More, as a bottom tab bar 56px high with the safe area added. Child pages are not here: the sub-nav in a page's header line holds them. */
export function TabBar({ items }: { items: ShellNavItem[] }) {
  const bar = items.filter((i) => i.phone === "bar");
  const more = items.filter((i) => i.phone === "more");
  return (
    <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-20 flex h-(--tab-bar) md:hidden border-t bg-background pb-[env(safe-area-inset-bottom)] box-content">
      {bar.map((i) => (
        <AppLink aria-current={i.active ? "page" : undefined} bare className={cn(TAB, tone(i.active))} key={i.id} to={i.to}>
          <Mark active={i.active} dot={i.dot} id={i.id} />
          <NavIcon name={i.icon} />
          {i.title}
        </AppLink>
      ))}
      {more.length > 0 && <MoreMenu items={more} />}
    </nav>
  );
}
