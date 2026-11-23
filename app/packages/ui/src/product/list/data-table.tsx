import type React from "react";
import { cn } from "../../cn";

export { TableBody, TableCaption, TableCell, TableHead, TableHeader, TableRow } from "../../ui/table";

/**
 * The coss `Table` parts with the product's `grid` look: no header band, hairline rows, 36px rows from 1024px and 44px below,
 * and a header that sticks inside the pane's scroll container. The coss `Table` wraps the table in an `overflow-x-auto` box,
 * which would make that box the sticky header's scroller, so this one renders the `<table>` itself; widths are percents on
 * the header cells (`README.md` rule 6) and the layout is fixed, so a long word wraps instead of scrolling the page.
 */
export function DataTable({ className, ...props }: React.ComponentProps<"table">) {
  return (
    <table
      className={cn(
        "w-full table-fixed border-collapse text-sm",
        "[&_thead_th]:sticky [&_thead_th]:top-0 [&_thead_th]:z-10 [&_thead_th]:bg-background [&_thead_th]:font-medium [&_thead_th]:text-muted-foreground [&_thead_th]:text-xs",
        "[&_tr]:border-b [&_td]:h-11 [&_th]:h-11 lg:[&_td]:h-9 lg:[&_th]:h-9 [&_td]:py-1.5 [&_td]:align-middle [&_td]:break-words [&_td]:whitespace-normal [&_td]:leading-snug",
        className,
      )}
      data-look="grid"
      data-slot="data-table"
      {...props}
    />
  );
}
