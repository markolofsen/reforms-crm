import type { ListFilterOption } from "@hub/ui/product/list/toolbar";
import { ListFilterMenu } from "@hub/ui/product/list/toolbar";

type Props = {
  /** The views of the list; the one on screen names the title. */
  options: readonly ListFilterOption[];
  value: string;
  /** The phone's menu only (below 640px there is no sidebar to choose a view from). */
  onChange: (value: string) => void;
  name: string;
  tooltip: string;
};

/**
 * The list's title (P134 verdict 1): the sidebar's children are the one door to a view, so from 640px the header line only says
 * which view is on screen, "Needs you · 2", plain text and no tab stop. A phone has no sidebar (its tab bar names sections only),
 * so below 640px the same title is the View menu. Both are in the markup and CSS picks one: the server cannot know the width.
 */
export function ListViewTitle({ options, value, onChange, name, tooltip }: Props) {
  const on = options.find((o) => o.value === value);
  const count = on?.count;
  return (
    <>
      <h3 className="hidden min-w-0 shrink-0 items-baseline gap-1 truncate font-semibold text-sm md:flex" data-testid="list-title">
        <span className="truncate">{on?.triggerLabel ?? on?.label ?? value}</span>
        {count !== undefined && count !== null && <span className="font-normal text-muted-foreground tabular-nums">
            {/* The space is for the text (a reader, a copy, a test read "Needs you · 2"); the flex gap draws it. */}
            {" "}· {count}
          </span>}
      </h3>
      <div className="min-w-0 shrink-0 md:hidden">
        <ListFilterMenu name={name} onChange={onChange} options={options} tooltip={tooltip} value={value} />
      </div>
    </>
  );
}
