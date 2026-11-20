import { CopyIcon } from "lucide-react";
import type { AgentToolRow } from "@hub/contract/agent-tools";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { needsAttention, STATE_LOOK } from "./labels";

/** The fix of a row that needs a fix or a look: the one command line, and a button that copies it. Never a form: the hub does, the panel shows. */
function FixLine({ row, onCopy }: { row: AgentToolRow; onCopy: (fix: string) => void }) {
  if (!row.fix) return null;
  const fix = row.fix;
  return (
    <span className="mt-1 flex min-w-0 flex-wrap items-center gap-2" data-testid="agent-tool-fix">
      <code className="min-w-0 break-all rounded-sm bg-muted px-1.5 py-0.5 text-xs">{fix}</code>
      <ActionButton aria-label={`Copy the fix for ${row.title}`} onClick={() => onCopy(fix)} size="s" variant="quiet">
        <CopyIcon aria-hidden="true" />
        Copy
      </ActionButton>
    </span>
  );
}

type Props = { /** The table's accessible name. */ title: string; rows: readonly AgentToolRow[]; onCopy: (fix: string) => void };

function State({ r }: { r: AgentToolRow }) {
  const { word, Icon, tone } = STATE_LOOK[r.state];
  return (
    <span className={`inline-flex items-center gap-1 ${tone}`}>
      <Icon aria-hidden="true" className="size-3.5 shrink-0" />
      {word}
    </span>
  );
}

/**
 * Checks as a table: what, the state (an icon and a word), and the detail; a row that needs a fix or a look adds its fix line.
 * Below 640px each check is two lines (the name and the state; the detail and the fix), never three squeezed columns
 * (`admin-principles.md` rule 5).
 */
export function ToolTable({ title, rows, onCopy }: Props) {
  return (
    <>
      <DataTable aria-label={title} className="max-md:hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="w-2/5">Check</TableHead>
            <TableHead className="w-1/5">State</TableHead>
            <TableHead>Detail</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {rows.map((r) => (
            <TableRow data-state={r.state} data-tool={r.id} key={`${r.cli}:${r.id}`}>
              <TableCell className="font-medium">{r.title}</TableCell>
              <TableCell>
                <State r={r} />
              </TableCell>
              <TableCell className="text-muted-foreground">
                {r.detail}
                {needsAttention(r) && <FixLine onCopy={onCopy} row={r} />}
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      <ul aria-label={title} className="flex flex-col divide-y md:hidden">
        {rows.map((r) => (
          <li className="flex min-w-0 flex-col gap-1 py-2 text-sm" data-state={r.state} key={`${r.cli}:${r.id}`}>
            <p className="flex min-w-0 items-baseline justify-between gap-3">
              <span className="min-w-0 break-words font-medium">{r.title}</span>
              <State r={r} />
            </p>
            {r.detail && <p className="break-words text-muted-foreground text-xs">{r.detail}</p>}
            {needsAttention(r) && <FixLine onCopy={onCopy} row={r} />}
          </li>
        ))}
      </ul>
    </>
  );
}
