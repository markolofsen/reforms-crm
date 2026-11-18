import { ChevronDownIcon } from "lucide-react";
import type { ReactNode } from "react";
import { cn } from "@hub/ui/cn";
import { ActionButton } from "@hub/ui/product/action-button";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";

type Props = { title: string; summary: ReactNode; children?: ReactNode; open?: boolean; tone?: "plain" | "problem" };

const TITLE = "w-28 shrink-0 text-start font-medium text-sm sm:w-36";
const TONE = { plain: "text-muted-foreground", problem: "text-warning-foreground" } as const;

/**
 * One fact of the project as one line: its name and a summary. When there is more to read, the line is a disclosure,
 * closed unless `open` (a problem opens its own line, `admin-principles.md` rule 9). The summary says a problem in words.
 */
export function FactLine({ title, summary, children, open = false, tone = "plain" }: Props) {
  // In the button the summary is cut to one line (its panel holds the rest); a line with nothing more wraps instead.
  const text = <span className={cn("min-w-0 flex-1 truncate text-start text-sm", TONE[tone])}>{summary}</span>;
  if (children === undefined) {
    return (
      <li className="flex min-h-(--control-m) items-center gap-3 px-4 py-2">
        <span className={TITLE}>{title}</span>
        <span className={cn("min-w-0 flex-1 break-words text-sm", TONE[tone])}>{summary}</span>
      </li>
    );
  }
  return (
    <li>
      <Collapsible defaultOpen={open}>
        <CollapsibleTrigger className="group w-full justify-start gap-3 font-normal" render={<ActionButton size="m" variant="quiet" />}>
          <span className={TITLE}>{title}</span>
          {text}
          <ChevronDownIcon aria-hidden="true" className="shrink-0 transition-transform group-data-panel-open:rotate-180 motion-reduce:transition-none" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <div className="flex flex-col gap-2 px-4 pt-1 pb-3 text-sm sm:ps-43">{children}</div>
        </CollapsiblePanel>
      </Collapsible>
    </li>
  );
}
