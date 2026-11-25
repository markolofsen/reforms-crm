import type { KeyboardEvent, ReactNode } from "react";
import { cn } from "../../cn";
import { SegmentedControl, SegmentedControlItem } from "../../ui/segmented-control";

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

/**
 * The two forms of a section's menu (owner 2026-11-25): `column`, the menu column beside the page; `tabs`, the same links as one row
 * on top of the page, scrolling sideways in its own strip, where the layout's own box is too narrow for the column (`SectionLayout`).
 */
export type SectionNavForm = "tabs" | "column";

/** Arrow Up and Down (Left and Right in tabs) move between the items, Home and End to the first and the last; Tab leaves as usual. */
function onKeys(e: KeyboardEvent<HTMLElement>) {
  const keys = ["ArrowDown", "ArrowUp", "ArrowLeft", "ArrowRight", "Home", "End"];
  if (!keys.includes(e.key)) return;
  const all = [...e.currentTarget.querySelectorAll<HTMLElement>("li > a[href], li > button, [data-slot=segmented-control] > a[href]")];
  const at = all.findIndex((el) => el === document.activeElement);
  const step = e.key === "ArrowDown" || e.key === "ArrowRight" ? 1 : -1;
  const next = e.key === "Home" ? 0 : e.key === "End" ? all.length - 1 : Math.min(Math.max(at + step, 0), all.length - 1);
  const target = all[next];
  if (!target) return;
  e.preventDefault();
  target.focus();
}

const ITEM = "flex min-h-(--control-s) min-w-0 items-center gap-2 rounded-md px-2 text-sm outline-none hover:bg-accent focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-inset aria-[current=page]:bg-accent aria-[current=page]:font-medium";

const content = (item: SectionNavItem) => (
  <>
    <span className="min-w-0 truncate">{item.label}</span>
    {item.count != null && <span className="shrink-0 font-normal text-muted-foreground text-xs tabular-nums">{item.count}</span>}
  </>
);

/** The tabs form: the links as one segmented row (the Watch header's look), the current one by `aria-current`; group headings drop. */
function SectionTabs({ label, items }: { label: string; items: readonly SectionNavItem[] }) {
  return (
    // eslint-disable-next-line jsx-a11y/no-noninteractive-element-interactions -- the links hold the focus; the nav only hears their arrow keys (roving between items)
    <nav aria-label={label} className="scroll-strip min-w-0" data-form="tabs" data-slot="section-nav" onKeyDown={onKeys}>
      <SegmentedControl size="sm">
        {items.map((item) => (
          <SegmentedControlItem key={item.id} render={(props) => <>{item.render(content(item), cn(props.className, "min-h-(--control-s) px-2.5 text-sm sm:text-sm"))}</>} />
        ))}
      </SegmentedControl>
    </nav>
  );
}

/**
 * The menu of a section (P125 verdicts 2, 3): a flat list of links with counts, grouped under small headings, one nesting level,
 * or (`form="tabs"`) the same links as one row of tabs. Its selection is the address, never local state.
 */
export function SectionNav({ label, items, form = "column" }: { label: string; items: readonly SectionNavItem[]; form?: SectionNavForm }) {
  if (form === "tabs") return <SectionTabs items={items} label={label} />;
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
