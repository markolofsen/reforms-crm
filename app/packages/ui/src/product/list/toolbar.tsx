import { ChevronDownIcon } from "lucide-react";
import { Fragment, type ReactNode } from "react";
import { cn } from "../../cn";
import { Menu, MenuGroup, MenuGroupLabel, MenuPopup, MenuRadioGroup, MenuRadioItem, MenuSeparator, MenuTrigger } from "../../ui/menu";
import { ActionButton } from "../action-button";

/** The stable chrome around a scrollable contact list. Controls stay feature-owned; spacing and layering do not drift. */
export function ListToolbar({ ariaLabel, children, className, role, testId }: { ariaLabel: string; children: ReactNode; className?: string; role?: "presentation" | "toolbar" | null; testId?: string }) {
  return (
    <div aria-label={ariaLabel} className={cn("@container sticky top-0 z-10 flex min-w-0 flex-col gap-1.5 border-b bg-background/95 px-3 py-1.5 backdrop-blur sm:px-4", className)} data-testid={testId} role={role === null ? undefined : role ?? "toolbar"}>
      {children}
    </div>
  );
}

/** A single row inside list chrome; use a second row only when search needs the full list width. */
export function ListToolbarRow({ children, className }: { children: ReactNode; className?: string }) {
  return <div className={cn("flex min-w-0 flex-wrap items-center gap-1.5", className)}>{children}</div>;
}

export type ListFilterOption = {
  value: string;
  label: ReactNode;
  triggerLabel?: ReactNode;
  count?: ReactNode;
  group?: string;
};

/**
 * One compact filter menu for list chrome. Domain features provide labels and counts; the trigger and grouped menu stay consistent.
 * `name` is the control's name, read (not shown) before the choice: the trigger's accessible name is "View: Needs you 8", its own
 * content, so it always holds the visible text (WCAG 2.5.3; axe label-content-name-mismatch). `tooltip` says what it filters.
 * `where` (P128 X4, decision 0045 point 21) names the section before the choice, so the trigger is the list's title and its
 * switch at once: "Mail · Needs you 2" (its name "View: Mail · Needs you 2").
 */
export function ListFilterMenu({ name, options, value, onChange, tooltip, where }: { name: string; options: readonly ListFilterOption[]; value: string; onChange: (value: string) => void; tooltip?: string; where?: string }) {
  const selected = options.find((option) => option.value === value);
  const groups = [...new Set(options.map((option) => option.group ?? ""))];
  return (
    <Menu>
      <MenuTrigger render={<ActionButton className="min-w-0 max-w-full shrink-0" size="s" tooltip={tooltip ?? name} variant="secondary" />}>
        <span className="sr-only">{name}: </span>
        {where && <span className="shrink-0 font-semibold" data-slot="list-where">{where} ·</span>}
        <span className="truncate">{selected?.triggerLabel ?? selected?.label ?? value}</span>
        {selected?.count !== undefined && selected.count !== null && <span className="font-normal tabular-nums">{selected.count}</span>}
        <ChevronDownIcon aria-hidden="true" />
      </MenuTrigger>
      <MenuPopup align="start">
        <MenuRadioGroup onValueChange={(next) => onChange(String(next))} value={value}>
          {groups.map((group, index) => (
            <Fragment key={group || "ungrouped"}>
              {index > 0 && <MenuSeparator />}
              <MenuGroup>
                {group && <MenuGroupLabel>{group}</MenuGroupLabel>}
                {options.filter((option) => (option.group ?? "") === group).map((option) => (
                  <MenuRadioItem closeOnClick key={option.value} value={option.value}>
                    {option.label}
                    {option.count !== undefined && option.count !== null && <span className="ms-auto ps-3 text-muted-foreground tabular-nums">{option.count}</span>}
                  </MenuRadioItem>
                ))}
              </MenuGroup>
            </Fragment>
          ))}
        </MenuRadioGroup>
      </MenuPopup>
    </Menu>
  );
}
