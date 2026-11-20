import type { SchemeNode } from "@hub/contract/scheme";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/data-table";
import { AppLink } from "@/components/app-link";
import { placeDest, SCHEME_LOOK } from "./labels";

type Props = { nodes: readonly SchemeNode[]; multi: boolean };

/** A part's name: a link to the page that fixes it only when it is not working, so a healthy Hub adds no tab stop. */
function PartName({ n }: { n: SchemeNode }) {
  if (n.state === "ok" || n.place === null || n.place === "overview") return <span className="font-medium">{n.label}</span>;
  return (
    <AppLink className="font-medium text-foreground" inProject={n.project} to={placeDest(n.place)}>
      {n.label}
    </AppLink>
  );
}

function State({ n }: { n: SchemeNode }) {
  const { word, Icon, tone } = SCHEME_LOOK[n.state];
  return (
    <span className="inline-flex items-center gap-1.5">
      <Icon aria-hidden="true" className={`size-3.5 shrink-0 ${tone}`} />
      {word}
    </span>
  );
}

/** The fix: the source's own command line as text (copying is the Settings panes' job, not Overview's). */
function Fix({ n }: { n: SchemeNode }) {
  if (!n.fix) return null;
  return <code className="block min-w-0 whitespace-pre-wrap rounded-sm bg-muted px-1.5 py-0.5 text-xs [overflow-wrap:anywhere]">{n.fix}</code>;
}

/**
 * The parts table (P63 O1), Overview's summary: every part of the Hub, worst first, one row each: the part, its project (with two
 * or more), its standing in a word and an icon, what is wrong, and the fix line. From 640px a table; below it two lines a part.
 */
export function SchemeTable({ nodes, multi }: Props) {
  return (
    <>
      <DataTable aria-label="Parts" className="max-md:hidden">
        <TableHeader>
          <TableRow>
            <TableHead className="w-1/4">Part</TableHead>
            {multi && <TableHead className="w-1/8">Project</TableHead>}
            <TableHead className="w-1/8">Status</TableHead>
            <TableHead>What is wrong</TableHead>
            <TableHead className="w-1/4">Fix</TableHead>
          </TableRow>
        </TableHeader>
        <TableBody>
          {nodes.map((n) => (
            <TableRow data-part={n.id} data-state={n.state} key={n.id}>
              <TableCell>
                <PartName n={n} />
              </TableCell>
              {multi && <TableCell className="text-muted-foreground">{n.project ?? "every project"}</TableCell>}
              <TableCell>
                <State n={n} />
              </TableCell>
              <TableCell className="break-words text-muted-foreground">{n.detail}</TableCell>
              <TableCell>
                <Fix n={n} />
              </TableCell>
            </TableRow>
          ))}
        </TableBody>
      </DataTable>
      <ul aria-label="Parts" className="flex flex-col divide-y md:hidden">
        {nodes.map((n) => (
          <li className="flex min-w-0 flex-col gap-1 py-2 text-sm" data-part={n.id} data-state={n.state} key={n.id}>
            <p className="flex flex-wrap items-baseline justify-between gap-x-2">
              <PartName n={n} />
              <State n={n} />
            </p>
            {(n.detail || (multi && n.project)) && <p className="break-words text-muted-foreground text-xs">{[multi ? n.project : null, n.detail].filter(Boolean).join(" · ")}</p>}
            <Fix n={n} />
          </li>
        ))}
      </ul>
    </>
  );
}
