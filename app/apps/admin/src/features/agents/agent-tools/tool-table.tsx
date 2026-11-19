import { CopyIcon } from "lucide-react";
import type { AgentToolRow } from "@hub/contract/agent-tools";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { STATE_LOOK } from "./labels";

/** A red row's fix: the one command line, and a button that copies it. Never a form: the hub does, the panel shows. */
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

/** One CLI's checks as a table: what, the state (an icon and a word), and the detail; a red row adds its fix line. */
export function ToolTable({ title, rows, onCopy }: { title: string; rows: readonly AgentToolRow[]; onCopy: (fix: string) => void }) {
  return (
    <DataTable aria-label={title}>
      <TableHeader>
        <TableRow>
          <TableHead className="w-2/5">{title}</TableHead>
          <TableHead className="w-1/5">State</TableHead>
          <TableHead>Detail</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((r) => {
          const { word, Icon, tone } = STATE_LOOK[r.state];
          return (
            <TableRow data-state={r.state} data-tool={r.id} key={r.id}>
              <TableCell className="font-medium">{r.title}</TableCell>
              <TableCell>
                <span className={`inline-flex items-center gap-1 ${tone}`}>
                  <Icon aria-hidden="true" className="size-3.5 shrink-0" />
                  {word}
                </span>
              </TableCell>
              <TableCell className="text-muted-foreground">
                {r.detail}
                {r.state === "fail" && <FixLine onCopy={onCopy} row={r} />}
              </TableCell>
            </TableRow>
          );
        })}
      </TableBody>
    </DataTable>
  );
}
