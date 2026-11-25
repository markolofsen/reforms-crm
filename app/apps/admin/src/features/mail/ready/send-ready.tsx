"use client";

import { SendIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import type { LeadReviewTicketDto } from "@hub/contract/lead-pass";
import { EmptyState, ListSkeleton, QueryView } from "@/components/state-views";
import { ActionButton } from "@hub/ui/product/action-button";
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "@hub/ui/sheet";
import { toastManager } from "@hub/ui/toast";
import { useLeadPass, useLeadReview } from "@/lib/data/inbound";
import { ReadyList, sentLine } from "@/features/mail/leads/review";
import { SendingLine } from "./sending-line";

// Send all ready (P147 3m item 5, the owner: «Мне не нравится неочевидно сделанная отправка массовая. Надо упростить.»). One
// primary button on top of Mail ▸ Needs you and Leads, "Send all ready (N)", N the day's pass drafts still waiting (the pass's own
// count; the sheet, which reads Mail, ticks only those that go now: no placeholder, nothing held, not a new sender). It opens one
// sheet (`ReadyList`); its Send N closes it, and the
// list header shows "Sending 12 of 35 · Stop" while the run sends one at a time; the rows turn Sent as it goes. A list selection's
// Send N opens the same sheet with only those rows. Under it nothing changed (the review's ticket, the run, the cap).

type Ctx = { project: string; batchId: number | null; /** The day's drafts still waiting and its proposals (the pass's own counts, no Mail read). */ waiting: { drafts: number; proposals: number }; open: (only?: readonly number[]) => void };
const SendReady = createContext<Ctx | null>(null);

/** The day's list and the sheet, for one project; null outside a provider (another screen). */
export const useSendReady = (): Ctx | null => useContext(SendReady);

/** The selection's Send N: the picked drafts that belong to today's list (its batch); the sheet shows which of them can go. */
export function selectedReady(ctx: Ctx | null, drafts: readonly { id: number; batchId: number | null }[]): number[] {
  if (!ctx || ctx.batchId === null) return [];
  return drafts.filter((d) => d.batchId === ctx.batchId).map((d) => d.id);
}

/**
 * The review is read only while the sheet is open: each read asks Mail for every draft's text and stores the hash it served (the
 * click sends exactly that text). Mounting the list, or each mail the run sends, must not read Mail again.
 */
function SheetBody({ project, batchId, only, onSent }: { project: string; batchId: number; only: ReadonlySet<number> | null; onSent: (t: LeadReviewTicketDto) => void }) {
  const q = useLeadReview(project, batchId);
  return (
    <QueryView loading={<ListSkeleton label="Reading the drafts from Mail" />} query={q} what="today's replies">
      {(d) => (d.rows.length + d.proposals.length === 0 ? <EmptyState title="Nothing to send">The day’s passes wrote no draft and proposed nothing.</EmptyState> : <ReadyList d={d} key={`${d.batchId}:${only ? [...only].join(",") : "all"}`} only={only} onSent={onSent} project={project} />)}
    </QueryView>
  );
}

export function SendReadyProvider({ project, children }: { project: string; children: ReactNode }) {
  const pass = useLeadPass(project).data;
  const batchId = pass?.review.batchId ?? null;
  const [sheet, setSheet] = useState<{ only: ReadonlySet<number> | null } | null>(null);
  const ctx: Ctx = { project, batchId, waiting: { drafts: pass?.review.drafts ?? 0, proposals: pass?.review.proposals ?? 0 }, open: (only) => setSheet({ only: only ? new Set(only) : null }) };
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <SendReady.Provider value={ctx}>
      {children}
      <Sheet onOpenChange={(o) => !o && setSheet(null)} open={sheet !== null && batchId !== null}>
        <SheetPopup className="max-w-2xl" data-testid="send-ready-sheet" initialFocus={title} side="right">
          <SheetHeader>
            <SheetTitle className="outline-none" ref={title} tabIndex={-1}>
              {sheet?.only ? `Send ${sheet.only.size} selected` : "Today’s replies"}
            </SheetTitle>
            <SheetDescription>Nothing goes before Send. Tick off what should wait.</SheetDescription>
          </SheetHeader>
          <SheetPanel>
            {sheet && batchId !== null && (
              <SheetBody
                batchId={batchId}
                only={sheet.only}
                onSent={(t) => {
                  setSheet(null);
                  if (t.held.length || t.applied.notMoved.length || !t.items.length) toastManager.add({ title: t.items.length ? `${t.items.length} sending` : "Nothing sent", description: sentLine(t), type: t.items.length ? "success" : "warning" });
                }}
                project={project}
              />
            )}
          </SheetPanel>
        </SheetPopup>
      </Sheet>
    </SendReady.Provider>
  );
}

/** "Send all ready (N)": the primary button on top of the list, N the day's drafts still waiting; nothing waiting, nothing shown. */
export function SendReadyButton() {
  const ctx = useSendReady();
  if (!ctx || ctx.batchId === null || ctx.waiting.drafts + ctx.waiting.proposals === 0) return null;
  return (
    <ActionButton data-testid="send-ready" onClick={() => ctx.open()} size="s" variant="primary">
      <SendIcon aria-hidden="true" />
      Send all ready ({ctx.waiting.drafts})
    </ActionButton>
  );
}

/** The top of Needs you and Leads: Send all ready and, while it runs, the run's line. */
export function SendReadyBar() {
  const ctx = useSendReady();
  if (!ctx || ctx.batchId === null) return null;
  return (
    <div className="flex min-w-0 flex-wrap items-center gap-x-3 gap-y-1 border-b px-3 py-2" data-testid="send-ready-bar">
      <SendReadyButton />
      <SendingLine batchId={ctx.batchId} bare project={ctx.project} />
    </div>
  );
}
