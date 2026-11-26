"use client";

import { BotIcon } from "lucide-react";
import { LEAD_PASS_DECISION_LABELS, LEAD_PASS_DISPLAY_LABELS, type LeadPassDecision } from "@hub/config/lead-pass";
import type { LeadPassDto } from "@hub/contract/lead-pass";
import type { LeadRowDto } from "@hub/contract/inbound";
import { Badge } from "@hub/ui/badge";
import { ActionButton } from "@hub/ui/product/action-button";
import { toastManager } from "@hub/ui/toast";
import { sentence } from "@/lib/api/client";
import { useLeadPass, useRedoLead, useRunLeadPass } from "@/lib/data/inbound";
import { SendReadyButton } from "@/features/mail/ready/send-ready";
import { SendingLine } from "@/features/mail/ready/sending-line";
import { formatTime } from "@/lib/format";

// The daily lead pass in Mail ▸ Leads (P147 L6, decision 0055): the banner over the list (Review today's replies, Run lead pass
// now, the pass line), each row's decision chip, and the card's decision with Redo. The pass's decisions are the agent's notes:
// nothing here sends; the review's one click is the owner's.

const isLeadDecision = (d: string): d is LeadPassDecision => d in LEAD_PASS_DECISION_LABELS;
const decisionLabel = (d: string): string => (isLeadDecision(d) ? LEAD_PASS_DECISION_LABELS[d] : d);

/** The pass line: "Lead pass 09:32 · 4 drafted · 2 proposed · 1 for you · next 26 Nov 09:30", or why it is off or stopped. */
export function passLine(d: LeadPassDto): string {
  const parts = [d.pass.running ? "Lead pass running" : d.pass.last ? `Lead pass ${formatTime(d.pass.last.finishedAt ?? d.pass.last.startedAt)}` : "No lead pass yet"];
  const last = d.pass.last;
  if (!d.pass.running && last) parts.push(last.listed === 0 ? "nothing new to process" : `${last.listed} eligible · ${last.replied + last.clients} drafts · ${last.handedOver} need a decision · ${last.failed} failed`);
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
  const d = q.data;
  if (!d) return null;
  const off = d.pass.runNowOff;
  return (
    <div className="flex min-w-0 flex-col gap-2 border-b px-3 py-2" data-testid="lead-pass-bar">
      <div className="flex flex-wrap items-center gap-2">
        <SendReadyButton />
        <ActionButton disabled={off !== null || run.isPending || d.pass.running} onClick={() => run.mutate()} size="s" tooltip={off ?? undefined} variant="secondary">
          <BotIcon aria-hidden="true" />
          {run.isPending ? "Starting" : d.pass.running ? "Processing leads" : "Process new leads"}
        </ActionButton>
      </div>
      {d.review.batchId !== null && <SendingLine bare batchId={d.review.batchId} project={project} />}
      <p className="text-muted-foreground text-xs tabular-nums" data-testid="lead-pass-line">
        {passLine(d)}
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
        {run.isError ? sentence(run.error) : ""}
      </span>
    </div>
  );
}

/** A row's decision chip (and the reason as its title). */
export function PassChip({ pass, display }: { pass: LeadRowDto["pass"]; display: LeadRowDto["display"] }) {
  return (
    <Badge data-testid="lead-pass-chip" title={pass?.reason ?? undefined} variant={display === "for_you" ? "default" : "outline"}>
      {display === "proposed" && pass ? decisionLabel(pass.decision) : LEAD_PASS_DISPLAY_LABELS[display]}
    </Badge>
  );
}

/** The card's decision: what the pass decided and why, its draft, and Redo (the next pass decides the lead again). */
export function LeadDecision({ project, pageId, pass, display }: { project: string; pageId: string; pass: LeadRowDto["pass"]; display: LeadRowDto["display"] }) {
  const redo = useRedoLead(project, pageId, { onError: (e) => toastManager.add({ title: "Not changed", description: sentence(e), type: "error" }) });
  if (!pass) return <p className="text-muted-foreground text-sm" data-testid="lead-decision">{LEAD_PASS_DISPLAY_LABELS[display]}</p>;
  return (
    <section aria-label="The lead pass decision" className="flex flex-col gap-1 rounded-md border p-3 text-sm" data-testid="lead-decision">
      <p className="flex flex-wrap items-center gap-2">
        <BotIcon aria-hidden="true" className="size-4 text-muted-foreground" />
        <span className="font-medium">{display === "proposed" ? decisionLabel(pass.decision) : LEAD_PASS_DISPLAY_LABELS[display]}</span>
        {pass.at && <span className="text-muted-foreground text-xs">Decision {formatTime(pass.at)}</span>}
      </p>
      {pass.reason && <p className="measure break-words">{pass.reason}</p>}
      {pass.draftId !== null && (display === "drafted" || display === "for_you") && <p className="text-muted-foreground text-xs">Draft {pass.draftId} is unsent. Open it below to review the reply.</p>}
      {display === "draft_gone" && <p className="text-muted-foreground text-xs">The recorded draft is unavailable. Prepare the reply again.</p>}
      {display === "excluded" && <p className="text-muted-foreground text-xs">Excluded from batch review. Prepare the reply again when you want to continue.</p>}
      {display !== "sent" && display !== "spam" && display !== "not_now" && (
        <div>
          <ActionButton data-testid="lead-redo" disabled={redo.isPending} onClick={() => redo.mutate()} size="s" variant="quiet">
            Redo
          </ActionButton>
        </div>
      )}
    </section>
  );
}
