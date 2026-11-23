import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../../cn";

/**
 * One item of a section's own menu (P125 L1): a label, an optional count, one optional level of nesting (a sub-topic under its
 * topic), an optional group heading. `render` draws the link itself (the app's `AppLink`: this package knows no router), given
 * the item's content and its class list; `current` marks the selection (`aria-current="page"`).
 */
export type SectionNavItem = {
  id: string;
  label: string;
  count?: number | null;
  current: boolean;
  /** 1: indented under the item before it (one level only). */
  depth?: 0 | 1;
  /** A small heading over a run of items ("Brands", "Kinds"). */
  group?: string;
  render: (content: ReactNode, className: string) => ReactNode;
};

/** Items in runs under their group heading, in the order given; an item without a group joins the run before it (or an unnamed first one). */
export function navGroups(items: readonly SectionNavItem[]): { group: string | null; items: SectionNavItem[] }[] {
  const out: { group: string | null; items: SectionNavItem[] }[] = [];
  for (const item of items) {
    const last = out.at(-1);
    if (item.group !== undefined && item.group !== last?.group) out.push({ group: item.group, items: [item] });
    else if (last) last.items.push(item);
    else out.push({ group: null, items: [item] });
  }
  return out;
}

/** Arrow Up and Down move between the items, Home and End to the first and the last; Tab leaves the menu as usual. */
function onKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowDown", "ArrowUp", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>("li > a[href], li > button")];
  const at = all.findIndex((el) => el === document.activeElement);
  const next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : Math.min(Math.max(at + (e.key === "ArrowDown" ? 1 : -1), 0), all.length - 1);
  const target = all[next];
  if (!target) return;
  e.preventDefault();
  target.focus();
}

const ITEM = "flex min-h-(--control-s) min-w-0 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-[current=page]:bg-accent aria-[current=page]:font-medium";

/**
 * The menu of a section (P125 verdicts 2, 3): a flat list of links with counts, grouped under small headings, one nesting level.
 * The same component in the menu column (`SectionLayout`) and in a narrow sheet. Its selection is the address, never local state.
 */
export function SectionNav({ label, items }: { label: string; items: readonly SectionNavItem[] }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the links hold the focus; the nav only hears their arrow keys (roving between items)
    <nav aria-label={label} className="flex min-w-0 flex-col gap-3 p-2" data-slot="section-nav" onKeyDown={onKeys}>
      {navGroups(items).map((g, i) => (
        <div className="flex min-w-0 flex-col gap-0.5" key={g.group ?? `group-${i}`}>
          {g.group && <h3 className="px-2 pb-1 font-heading font-medium text-muted-foreground text-xs">{g.group}</h3>}
          <ul className="flex min-w-0 flex-col gap-0.5">
            {g.items.map((item) => (
              <li key={item.id}>
                {item.render(
                  <>
                    <span className="min-w-0 flex-1 truncate">{item.label}</span>
                    {item.count != null && <span className="shrink-0 text-muted-foreground text-xs tabular-nums">{item.count}</span>}
                  </>,
                  cn(ITEM, item.depth === 1 && "ps-6"),
                )}
              </li>
            ))}
          </ul>
        </div>
      ))}
    </nav>
  );
}
