"use client";

import { BotIcon } from "lucide-react";
import { LEAD_PASS_DECISION_LABELS, type LeadPassDecision } from "@hub/config/lead-pass";
import type { LeadPassDto } from "@hub/contract/lead-pass";
import type { LeadRowDto } from "@hub/contract/inbound";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { AppLink } from "@/components/app-link";
import { sentence } from "@/lib/api/client";
import { useLeadPass, useRedoLead, useRunLeadPass, useRunMailPass } from "@/lib/data/inbound";
import { formatTime } from "@/lib/format";
import { dest } from "@/routes/paths";

// The daily lead pass in Mail ▸ Leads (P147 L6, decision 0055): the banner over the list (Review today's replies, Run lead pass
// now, the pass line), each row's decision chip, and the card's decision with Redo. The pass's decisions are the agent's notes:
// nothing here sends; the review's one click is the owner's.

type Pass = NonNullable<LeadRowDto["pass"]>;

/** The chip of a row's decision: what the pass decided, Excluded once the owner unticked it. */
export function passChipText(p: Pass): string {
  return p.excludedAt ? "Excluded" : LEAD_PASS_DECISION_LABELS[p.decision as LeadPassDecision];
}

/** The pass line: "Lead pass 09:32 · 4 drafted · 2 proposed · 1 for you · next 26 Nov 09:30", or why it is off or stopped. */
export function passLine(d: LeadPassDto): string {
  const t = d.today;
  const parts = [d.pass.running ? "Lead pass running" : d.pass.last ? `Lead pass ${formatTime(d.pass.last.finishedAt ?? d.pass.last.startedAt)}` : "No lead pass yet"];
  if (t.drafted) parts.push(`${t.drafted} drafted`);
  if (t.spam + t.notNow) parts.push(`${t.spam + t.notNow} proposed`);
  if (t.forYou) parts.push(`${t.forYou} for you`);
  parts.push(d.pass.next ? `next ${formatTime(d.pass.next)}` : d.pass.schedule === "off" ? "daily pass off (leads.pass)" : "no next pass");
  return parts.join(" · ");
}

/** The mail pass line (P147 3h): "Mail pass 10:04 · 3 drafted · 1 proposed · next 26 Nov 10:00", or why it is off. */
export function mailPassLine(d: LeadPassDto): string {
  const m = d.mail;
  const parts = [m.running ? "Mail pass running" : m.last ? `Mail pass ${formatTime(m.last.finishedAt ?? m.last.startedAt)}` : "No mail pass yet"];
  if (m.today.drafted) parts.push(`${m.today.drafted} drafted`);
  if (m.today.proposed) parts.push(`${m.today.proposed} proposed`);
  if (m.today.forYou) parts.push(`${m.today.forYou} for you`);
  parts.push(m.next ? `next ${formatTime(m.next)}` : m.schedule === "off" ? "daily pass off (mail.pass)" : "no next pass");
  return parts.join(" · ");
}

/** The banner over the Leads list: Review today's replies (N) when the day's batch waits, Run lead pass now, the pass line. */
export function LeadPassBar({ project }: { project: string }) {
  const q = useLeadPass(project);
  const run = useRunLeadPass(project);
  const runMail = useRunMailPass(project);
  const d = q.data;
  if (!d) return null;
  const waiting = d.review.drafts + d.review.proposals;
  const off = d.pass.runNowOff;
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b px-3 py-2" data-testid="lead-pass-bar">
      <div className="flex flex-wrap items-center gap-2">
        {d.review.batchId !== null && waiting > 0 && (
          <AppLink className="font-medium text-sm" data-testid="lead-review-link" to={dest("mail.lead-review", { batch: d.review.batchId })}>
            Review today’s replies ({waiting})
          </AppLink>
        )}
        <ActionButton disabled={off !== null || run.isPending || d.pass.running} onClick={() => run.mutate()} size="s" tooltip={off ?? undefined} variant="secondary">
          <BotIcon aria-hidden="true" />
          {run.isPending ? "Starting" : d.pass.running ? "Lead pass running" : "Run lead pass now"}
        </ActionButton>
        <ActionButton data-testid="mail-pass-run" disabled={d.mail.runNowOff !== null || runMail.isPending || d.mail.running} onClick={() => runMail.mutate()} size="s" tooltip={d.mail.runNowOff ?? undefined} variant="secondary">
          <BotIcon aria-hidden="true" />
          {runMail.isPending ? "Starting" : d.mail.running ? "Mail pass running" : "Run mail pass now"}
        </ActionButton>
      </div>
      <p className="text-muted-foreground text-xs tabular-nums" data-testid="lead-pass-line">
        {passLine(d)}
      </p>
      <p className="text-muted-foreground text-xs tabular-nums" data-testid="mail-pass-line">
        {mailPassLine(d)}
      </p>
      {d.pass.stopped && (
        <p className="text-sm" role="status">
          Needs you: the last pass stopped: {d.pass.stopped}
        </p>
      )}
      {d.mail.stopped && (
        <p className="text-sm" role="status">
          Needs you: the last mail pass stopped: {d.mail.stopped}
        </p>
      )}
      <span className="text-destructive-foreground text-xs" role="alert">
        {run.isError ? sentence(run.error) : runMail.isError ? sentence(runMail.error) : ""}
      </span>
    </div>
  );
}

/** A row's decision chip (and the reason as its title). */
export function PassChip({ pass }: { pass: LeadRowDto["pass"] }) {
  if (!pass) return null;
  return (
    <Badge data-testid="lead-pass-chip" title={pass.reason ?? undefined} variant={pass.decision === "hand_over" ? "default" : "outline"}>
      {passChipText(pass)}
    </Badge>
  );
}

/** The card's decision: what the pass decided and why, its draft, and Redo (the next pass decides the lead again). */
export function LeadDecision({ project, pageId, pass }: { project: string; pageId: string; pass: LeadRowDto["pass"] }) {
  const redo = useRedoLead(project, pageId, { onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }) });
  if (!pass) return null;
  return (
    <section aria-label="The lead pass decision" className="flex flex-col gap-1 rounded-md border p-3 text-sm" data-testid="lead-decision">
      <p className="flex flex-wrap items-center gap-2">
        <BotIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="font-medium">{passChipText(pass)}</span>
        {pass.at && <span className="text-muted-foreground text-xs">{formatTime(pass.at)}</span>}
      </p>
      {pass.reason && <p className="measure break-words">{pass.reason}</p>}
      {pass.draftId !== null && <p className="text-muted-foreground text-xs">Its draft {pass.draftId} waits in today’s review.</p>}
      <div>
        <ActionButton data-testid="lead-redo" disabled={redo.isPending} onClick={() => redo.mutate()} size="s" variant="quiet">
          Redo
        </ActionButton>
      </div>
    </section>
  );
}
