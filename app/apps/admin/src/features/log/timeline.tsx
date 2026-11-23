import { clientKey } from "@hub/contract/client-key";
import { ChevronDownIcon } from "lucide-react";
import { useId, useState, type ReactNode } from "react";
import type { ActivityRowDto } from "@hub/contract/activity";
import { cn } from "@hub/ui/cn";
import { Tooltip, TooltipPopup, TooltipTrigger } from "@hub/ui/tooltip";
import { ActionButton } from "@hub/ui/product/action-button";
import { DataTable, TableBody, TableCell, TableHead, TableHeader, TableRow } from "@hub/ui/product/list/data-table";
import { AppLink } from "@/components/app-link";
import { agentRef } from "@/lib/focus";
import { hhmm } from "@/lib/format";
import { dest, type Dest } from "@/routes/paths";
import { daySections, groupCells, lineRef, type GroupCells, type RowGroup } from "./groups";
import { reasonParts } from "./labels";

/**
 * The client's name; when the line points at one draft, a link into that draft's card. From 640px its own cell, so it truncates
 * (the full name in its title); on a phone it shares the cell with the outcome and wraps anywhere. The shared `Link` is
 * `inline-flex w-fit`, which kept a long address from wrapping, so at 1280 with the dock open it ran over "What happened" (P88).
 */
const WHO = "inline [overflow-wrap:anywhere] sm:block sm:w-full sm:truncate";
/** Where a row leads (P128 X0, F30): a messenger row to its chat, a Mail draft's row to the client's conversation, else nowhere. */
type RowTarget = { chatId: number | null; draftId: number | null; clientId: number | null };
const targetOf = (t: RowTarget): Dest | null =>
  t.chatId !== null ? dest("messengers.conversation", { id: t.chatId }) : t.draftId !== null && t.clientId !== null ? dest("mail.conversation", { key: clientKey({ id: t.clientId }) }) : null;
function Who({ target, name }: { target: RowTarget; name: string }) {
  const to = targetOf(target);
  const trigger = to === null ? (
    <span className={WHO}>{name}</span>
  ) : (
    <AppLink className={cn(WHO, "text-foreground text-sm")} to={to}>
      {name}
      <span className="sr-only"> (open the conversation)</span>
    </AppLink>
  );
  return (
    <Tooltip>
      <TooltipTrigger aria-label={name} render={trigger} />
      <TooltipPopup>{name}</TooltipPopup>
    </Tooltip>
  );
}

/** The phrase, the skill when the event named one, and under it the agent's own words, muted. */
function Why({ why, detail, skill, provider }: { why: string; detail: string | null; skill: string | null; provider?: ActivityRowDto["provider"] }) {
  const providerLabel = provider === "hub_llm" ? "Hub LLM" : provider === "runtime_agent" ? "Runtime agent" : null;
  return (
    <>
      {why}
      {providerLabel && <span className="text-muted-foreground">{why ? ` · ${providerLabel}` : providerLabel}</span>}
      {skill && <span className="text-muted-foreground">{why ? ` · ${skill}` : skill}</span>}
      {detail && <span className="block break-words text-muted-foreground text-xs">{detail}</span>}
    </>
  );
}

/** A folded line's count: it opens the entries under the line, the only disclosure a log row has (`admin-principles.md` rule 5). */
function Count({ c, open, id, onToggle }: { c: GroupCells; open: boolean; id: string; onToggle: () => void }) {
  if (c.count < 2) return null;
  return (
    <ActionButton aria-controls={open ? id : undefined} aria-expanded={open} className="group ms-1 gap-1 px-2 tabular-nums" onClick={onToggle} size="s" variant="quiet">
      ×{c.count}
      <span className="sr-only"> times, each time</span>
      <ChevronDownIcon aria-hidden="true" className="transition-transform group-aria-expanded:rotate-180 motion-reduce:transition-none" />
    </ActionButton>
  );
}

/** One entry of an opened fold: its time (a link into its draft when it names one) and its reason when the line does not say it. */
function Entry({ r, c, id }: { r: ActivityRowDto; c: GroupCells; id: string | undefined }) {
  const p = reasonParts(r);
  const to = targetOf({ chatId: r.chatId, draftId: r.draftId, clientId: r.client?.id ?? null });
  const time = to === null ? hhmm(r.at) : (
    <AppLink to={to}>
      {hhmm(r.at)}
      <span className="sr-only"> (open the conversation)</span>
    </AppLink>
  );
  const why = <Why detail={c.detail === null ? p.detail : null} provider={r.provider} skill={c.skill === null ? r.skill : null} why={c.why === "" ? p.why : ""} />;
  return (
    <TableRow data-entry="" id={id}>
      <TableCell className="ps-6 text-muted-foreground tabular-nums max-sm:hidden">{time}</TableCell>
      <TableCell className="max-sm:ps-4">
        <span className="text-muted-foreground text-xs tabular-nums sm:hidden">
          {time}
          <span className="block">{why}</span>
        </span>
      </TableCell>
      <TableCell className="max-sm:hidden" />
      <TableCell className="max-sm:hidden">{why}</TableCell>
    </TableRow>
  );
}

/**
 * One line: the same client with the same outcome on one day, its count opening the entries under it. From 640px four cells
 * (when, client, what happened, why); below it the client cell holds two lines (client and what happened; when and why) and
 * the other cells are hidden, so the phone reads the same rows of the same table, never a second rendering.
 */
function Line({ g }: { g: RowGroup }) {
  const [open, setOpen] = useState(false);
  const id = useId();
  const c = groupCells(g);
  const ref = lineRef(c, g.rows[0]);
  const count = <Count c={c} id={id} onToggle={() => setOpen((v) => !v)} open={open} />;
  const provider = g.rows.length === 1 ? g.rows[0]?.provider : null;
  const why: ReactNode = <Why detail={c.detail} provider={provider} skill={c.skill} why={c.why} />;
  return (
    <>
      <TableRow data-count={c.count > 1 ? c.count : undefined} data-row="" {...(ref ? agentRef(ref) : {})}>
        <TableCell className="text-muted-foreground tabular-nums max-sm:hidden">{c.when}</TableCell>
        <TableCell>
          <span className="font-medium sm:font-normal" data-agent-label="">
            <Who name={c.who} target={{ chatId: c.chatId, draftId: c.draftId, clientId: g.rows[0]?.client?.id ?? null }} />
          </span>
          <span className="sm:hidden">
            {` ${c.what}`}
            {count}
          </span>
          <span className="block break-words text-muted-foreground text-xs sm:hidden">
            <span className="tabular-nums">{c.when}</span>
            {(c.why || c.skill) && " · "}
            {why}
          </span>
        </TableCell>
        <TableCell className="max-sm:hidden">
          {c.what}
          {count}
        </TableCell>
        <TableCell className="max-sm:hidden">{why}</TableCell>
      </TableRow>
      {open && g.rows.map((r, i) => <Entry c={c} id={i === 0 ? id : undefined} key={r.key} r={r} />)}
    </>
  );
}

/**
 * Activity (P73, decision 0037): one table of what the agent decided, newest first, under a quiet heading per local day
 * ("Today", "Yesterday", "18 Nov"; a row, never a disclosure, a ref or a tab stop), every line in it the client, the outcome
 * and the reason (nothing behind a click). Each day is its own `tbody`. `now` is the clock's (the day words).
 */
export function Timeline({ rows, now }: { rows: readonly ActivityRowDto[]; now: number }) {
  return (
    <DataTable aria-label="Activity">
      <TableHeader>
        <TableRow>
          <TableHead className="w-1/8 max-sm:hidden">When</TableHead>
          <TableHead className="max-sm:w-full sm:w-1/5">Client</TableHead>
          <TableHead className="w-1/5 max-sm:hidden">What happened</TableHead>
          <TableHead className="max-sm:hidden">Why</TableHead>
        </TableRow>
      </TableHeader>
      {daySections(rows, now).map((s) => (
        <TableBody data-day={s.day} key={s.day}>
          <TableRow data-day-head="">
            <TableHead className="sticky top-11 z-5 bg-background font-medium text-foreground text-sm lg:top-9" colSpan={4} scope="colgroup">
              {s.label}
            </TableHead>
          </TableRow>
          {s.groups.map((g) => (
            <Line g={g} key={g.rows[0].key} />
          ))}
        </TableBody>
      ))}
    </DataTable>
  );
}
