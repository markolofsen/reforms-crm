import type { KnowledgeEntryDto } from "@hub/contract/knowledge";
import { Badge } from "@hub/ui/badge";
import { cn } from "@hub/ui/cn";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { LocalActionButton } from "@/components/local-action";
import { agentRef } from "@/lib/focus";
import { useState } from "react";
import { EntryText, toggleProps } from "./entry-text";
import { groupEntries, type EntrySection } from "./groups";
import { STATUS_LOOK, forText, type Facets } from "./labels";

/** `headings` false (a topic chosen in the menu, P125 L2 verdict 4): the rows without their heading rows. */
type Props = { project: string; entries: readonly KnowledgeEntryDto[]; facets: Facets; headings?: boolean };
type Cols = { project: string; showFor: boolean; showStatus: boolean; brands: boolean };

/** A status that is not the normal one, as a badge; nothing for an approved entry. */
function Status({ e }: { e: KnowledgeEntryDto }) {
  const look = STATUS_LOOK[e.status];
  return look.badge ? <Badge variant={look.badge}>{look.word}</Badge> : null;
}

/** The entry's Open (P61): the file in its own app, at the row's end; it renders nothing where this machine cannot open. */
function Open({ project, e }: { project: string; e: KnowledgeEntryDto }) {
  return (
    <LocalActionButton action="file.open" args={{ project, key: e.key }}>
      <span>
        Open<span className="sr-only"> {e.title}</span>
      </span>
    </LocalActionButton>
  );
}

/**
 * A row he can point at (P72): focusable (one Tab stop each, with the inset ring of `accessibility.md` rule 3), and its key is
 * its ref (`knowledge:<index path>`), so a click on the row or a Tab onto it tells the agent which entry he means.
 */
const POINTABLE = "outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring";

const day = (v: string | null): string => (v ? v.slice(0, 10) : "");
/** The date is quiet; it speaks up only when the entry has run out or is about to. */
const dayTone = (e: KnowledgeEntryDto): string => (e.status === "expired" ? "text-destructive-foreground" : e.status === "expiring" ? "text-warning-foreground" : "text-muted-foreground");

/** A heading's indent by its level (static strings, `stylesheets-and-class-lists.md` rule 1); deeper levels share the last. */
const INDENT = ["", "ps-6", "ps-10"] as const;
const indent = (depth: number): string => INDENT[Math.min(depth, INDENT.length - 1)] ?? "";
const PHONE_LEVEL = ["h2", "h3", "h4"] as const;

/** A heading's words: the topic (or brand) and how many rows of the view sit under it. Not a ref, not a control (P74). */
function HeadText({ s }: { s: EntrySection }) {
  return (
    <span className="flex items-baseline gap-2 font-medium text-foreground text-sm">
      <span className="min-w-0 break-words">{s.label}</span>
      <span className="font-normal text-muted-foreground tabular-nums">{s.count}</span>
    </span>
  );
}

function EntryRow({ e, c, span }: { e: KnowledgeEntryDto; c: Cols; span: number }) {
  const [open, setOpen] = useState(false);
  return (
    <>
    <TableRow className={cn(POINTABLE, "cursor-pointer")} data-entry={e.key} data-status={e.status} tabIndex={0} {...agentRef(e.key)} {...toggleProps(open, () => setOpen((v) => !v))}>
      <TableCell className="break-words font-medium" data-agent-label="">
        {e.title}
      </TableCell>
      {c.showFor && <TableCell className={cn("break-words", e.audiences.length === 0 ? "text-warning-foreground" : "text-muted-foreground")}>{forText(e, c.brands)}</TableCell>}
      {c.showStatus && (
        <TableCell>
          <Status e={e} />
        </TableCell>
      )}
      <TableCell className={cn("tabular-nums", dayTone(e))}>
        {/* The table's cells wrap by design; a date never splits at its dashes. */}
        <span className="whitespace-nowrap">{day(e.validUntil)}</span>
      </TableCell>
      <TableCell className="text-end">
        <Open e={e} project={c.project} />
      </TableCell>
    </TableRow>
    {open && (
      <TableRow data-entry-text={e.key}>
        <TableCell className="whitespace-normal bg-muted/20" colSpan={span}>
          <EntryText entryKey={e.key} project={c.project} title={e.title} />
        </TableCell>
      </TableRow>
    )}
    </>
  );
}

/** One heading and its rows, its own `tbody` (as Activity's sessions); the heading spans every column. */
function SectionBody({ s, c }: { s: EntrySection; c: Cols }) {
  const span = 3 + (c.showFor ? 1 : 0) + (c.showStatus ? 1 : 0);
  return (
    <TableBody data-topic={s.id}>
      {s.label !== "" && (
        <TableRow data-topic-head="">
          <TableHead className={cn("whitespace-normal", s.depth === 0 && "bg-muted/40", indent(s.depth))} colSpan={span} scope="colgroup">
            <HeadText s={s} />
          </TableHead>
        </TableRow>
      )}
      {s.entries.map((e) => (
        <EntryRow c={c} e={e} key={`${s.id}|${e.key}`} span={span} />
      ))}
    </TableBody>
  );
}

function PhoneRow({ e, c }: { e: KnowledgeEntryDto; c: Cols }) {
  const [open, setOpen] = useState(false);
  const meta = [c.showFor ? forText(e, c.brands) : null, e.validUntil ? `until ${day(e.validUntil)}` : null].filter(Boolean).join(" · ");
  return (
    <li className={cn("flex min-w-0 flex-col gap-1 py-2 text-sm", POINTABLE)} data-entry={e.key} data-status={e.status} tabIndex={0} {...agentRef(e.key)} {...toggleProps(open, () => setOpen((v) => !v))}>
      <p className="flex min-w-0 items-center gap-2">
        <span className="min-w-0 flex-1 break-words font-medium" data-agent-label="">
          {e.title}
        </span>
        <Open e={e} project={c.project} />
      </p>
      {(meta || STATUS_LOOK[e.status].badge) && (
        <p className={cn("flex flex-wrap items-center gap-x-2 break-words text-xs", dayTone(e))}>
          <Status e={e} />
          <span className="tabular-nums">{meta}</span>
        </p>
      )}
      {open && <EntryText entryKey={e.key} project={c.project} title={e.title} />}
    </li>
  );
}

/**
 * Below 640px: the same headings (a real heading per level) over the same two-line rows. The first heading has no space above
 * it, so the first entry stays within `FIRST_ROW_MAX_PHONE` (`admin-principles.md` rule 3; 207 px with it on saas, 2026-11-20).
 */
function PhoneSection({ s, c, first }: { s: EntrySection; c: Cols; first: boolean }) {
  const H = PHONE_LEVEL[Math.min(s.depth, PHONE_LEVEL.length - 1)] ?? "h4";
  return (
    <li data-topic={s.id}>
      {s.label !== "" && (
        <H className={cn(first ? "pb-1" : "pt-3 pb-1", indent(s.depth))} data-topic-head="">
          <HeadText s={s} />
        </H>
      )}
      {s.entries.length > 0 && <ul className="flex flex-col divide-y">{s.entries.map((e) => <PhoneRow c={c} e={e} key={`${s.id}|${e.key}`} />)}</ul>}
    </li>
  );
}

/**
 * Every entry of the knowledge base, one row each (P70), under a heading per topic (P74: the folder, else the category; the
 * brand on top only when the brands differ; each heading with its count, never a disclosure): its title, who can find it, its
 * status, the day it is valid until, and its Open. A column whose value is the same on every entry is left out and said once
 * above the table (UX pass 2026-11-20): For only when the audiences differ (brands only when they differ), Status only when an
 * entry is not approved, and then only on that row. From 640px a table; below it two lines a row (the title and Open; then the
 * rest), so no column hides behind a click (`admin-principles.md` rule 5).
 */
export function EntryTable({ project, entries, facets, headings = true }: Props) {
  const c: Cols = { project, showFor: facets.sameAudiences === null || facets.brandsDiffer, showStatus: !facets.allApproved, brands: facets.brandsDiffer };
  const sections: readonly EntrySection[] = headings ? groupEntries(entries, facets.brandsDiffer) : [{ id: "", label: "", depth: 0, count: entries.length, entries }];
  return (
    <>
      <DataTable aria-label="Knowledge entries" className="max-md:hidden" data-testid="knowledge-table">
        <TableHeader>
          <TableRow>
            <TableHead>Title</TableHead>
            {c.showFor && <TableHead className="w-1/5">For</TableHead>}
            {c.showStatus && <TableHead className="w-3/20">Status</TableHead>}
            <TableHead className="w-1/8">Valid until</TableHead>
            <TableHead className="w-1/10">
              <span className="sr-only">Open</span>
            </TableHead>
          </TableRow>
        </TableHeader>
        {sections.map((s) => (
          <SectionBody c={c} key={s.id} s={s} />
        ))}
      </DataTable>
      <ul aria-label="Knowledge entries" className="flex flex-col md:hidden">
        {sections.map((s, i) => (
          <PhoneSection c={c} first={i === 0} key={s.id} s={s} />
        ))}
      </ul>
    </>
  );
}
