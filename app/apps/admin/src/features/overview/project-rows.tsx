import type { ProjectRowDto } from "@hub/contract/overview";
import { refOf } from "@hub/contract/focus";
import { agentRef } from "@/lib/focus";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { AppLink } from "@/components/app-link";
import { dest } from "@/routes/paths";
import { mailReadText } from "@/features/mail/inbox/mail-read";
import { LEVEL, needsYou, nextDest, statusWord } from "./labels";

type Props = { rows: readonly ProjectRowDto[]; now: number };

/** The project's name, leading into its own Mail. */
function Name({ p }: { p: ProjectRowDto }) {
  return (
    <AppLink className="font-medium text-foreground text-sm" inProject={p.slug} to={dest("mail.list")}>
      {p.name}
    </AppLink>
  );
}

/** The worst fact of the project, leading to the place that fixes it when there is one. */
function NeedsYou({ p }: { p: ProjectRowDto }) {
  const { Icon, tone } = LEVEL[p.status.level];
  const to = nextDest(p.status);
  const text = needsYou(p.status);
  if (p.status.level === "clear") return <span className="text-muted-foreground">{text}</span>;
  return (
    <span className="inline-flex min-w-0 items-start gap-1.5">
      <Icon aria-hidden="true" className={`mt-0.5 size-3.5 shrink-0 ${tone}`} />
      {to ? (
        <AppLink className="text-foreground text-sm" inProject={p.slug} to={to}>
          {text}
        </AppLink>
      ) : (
        text
      )}
    </span>
  );
}

/** From 640px: one row per project (`admin-principles.md` rule 5), every number in its own column. */
export function ProjectTable({ rows, now }: Props) {
  return (
    <DataTable aria-label="Projects" className="max-md:hidden">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/6">Project</TableHead>
          <TableHead className="w-1/10">Status</TableHead>
          <TableHead className="w-1/10">To review</TableHead>
          <TableHead className="w-1/10">Owes reply</TableHead>
          <TableHead className="w-1/10">Sent today</TableHead>
          <TableHead className="w-1/8">Mail read</TableHead>
          <TableHead>Needs you</TableHead>
        </TableRow>
      </TableHeader>
      <TableBody>
        {rows.map((p) => (
          <TableRow data-project={p.slug} key={p.slug} {...agentRef(refOf("project", p.slug))}>
            <TableCell>
              <Name p={p} />
            </TableCell>
            <TableCell>{statusWord(p)}</TableCell>
            <TableCell className="tabular-nums">{p.toReview}</TableCell>
            <TableCell className="tabular-nums">{p.status.numbers.owed}</TableCell>
            <TableCell className="tabular-nums">{p.sentToday}</TableCell>
            <TableCell className="tabular-nums">{mailReadText(p.status.numbers.mailRead, now)}</TableCell>
            <TableCell>
              <NeedsYou p={p} />
            </TableCell>
          </TableRow>
        ))}
      </TableBody>
    </DataTable>
  );
}

/** Below 640px: each project as two lines (name and status; the numbers), then what it needs. */
export function ProjectList({ rows, now }: Props) {
  return (
    <ul aria-label="Projects" className="flex flex-col divide-y md:hidden">
      {rows.map((p) => (
        <li className="flex min-w-0 flex-col gap-1 py-2 text-sm" data-project={p.slug} key={p.slug} {...agentRef(refOf("project", p.slug))}>
          <p className="flex flex-wrap items-baseline gap-x-2">
            <Name p={p} />
            <span className="text-muted-foreground">{statusWord(p)}</span>
          </p>
          <p className="text-muted-foreground text-xs tabular-nums">
            {p.toReview} to review · {p.status.numbers.owed} {p.status.numbers.owed === 1 ? "reply" : "replies"} owed · {p.sentToday} sent today · {mailReadText(p.status.numbers.mailRead, now)}
          </p>
          {p.status.level !== "clear" && <NeedsYou p={p} />}
        </li>
      ))}
    </ul>
  );
}
