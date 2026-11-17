import { AppLink } from "@/components/app-link";
import type { NavItem } from "@/hooks/use-section-nav";
import { cn } from "@hub/ui/cn";
import { NavIcon } from "./nav-icon";

/** Phones (hidden from 640px by CSS): the sections as a bottom tab bar, 56px high with the safe area added. Six labels share 360px, so the type is 11px: "Connections" must fit whole (`a-layout.spec.ts` measures it). */
export function TabBar({ items }: { items: NavItem[] }) {
  return (
    <nav aria-label="Sections" className="fixed inset-x-0 bottom-0 z-20 flex h-(--tab-bar) md:hidden border-t bg-background pb-[env(safe-area-inset-bottom)] box-content">
      {items.map((i) => (
        <AppLink
          aria-current={i.active ? "page" : undefined}
          bare
          className={cn(
            "relative flex min-w-0 flex-1 flex-col items-center justify-center gap-0.5 text-[11px] tracking-tighter outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset [&>svg]:size-5",
            i.active ? "font-medium text-foreground" : "text-muted-foreground",
          )}
          key={i.id}
          to={i.to}
        >
          {i.active && <span aria-hidden="true" className="absolute inset-x-4 top-0 h-0.5 rounded-full bg-primary" />}
          <NavIcon name={i.icon} />
          {i.title}
        </AppLink>
      ))}
    </nav>
  );
}
