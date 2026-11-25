"use client";

import { SendIcon } from "lucide-react";
import { createContext, type ReactNode, useContext, useRef, useState } from "react";
import type { LeadReviewDto } from "@hub/contract/lead-pass";
import { ActionButton } from "@hub/ui/product/action-button";
import { Sheet, SheetDescription, SheetHeader, SheetPanel, SheetPopup, SheetTitle } from "@hub/ui/sheet";
import { toastManager } from "@hub/ui/toast";
import { useLeadPass, useLeadReview } from "@/lib/data/inbound";
import { ReadyList, readyRows, sentLine } from "@/features/mail/leads/review";
import { SendingLine } from "./sending-line";

// Send all ready (P147 3m item 5, the owner: «Мне не нравится неочевидно сделанная отправка массовая. Надо упростить.»). One
// primary button on top of Mail ▸ Needs you and Leads, "Send all ready (N)", N the replies the day's passes drafted that would go
// now (ticked: no placeholder, nothing held, not a new sender). It opens one sheet (`ReadyList`); its Send N closes it, and the
// list header shows "Sending 12 of 35 · Stop" while the run sends one at a time; the rows turn Sent as it goes. A list selection's
// Send N opens the same sheet with only those rows. Under it nothing changed (the review's ticket, the run, the cap).

type Ctx = { project: string; batchId: number | null; review: LeadReviewDto | undefined; ready: number; open: (only?: readonly number[]) => void };
const SendReady = createContext<Ctx | null>(null);

/** The day's list and the sheet, for one project; null outside a provider (another screen). */
export const useSendReady = (): Ctx | null => useContext(SendReady);

/** The selection's Send N: the picked drafts that are in today's list and can go now. */
export function selectedReady(ctx: Ctx | null, draftIds: readonly number[]): number[] {
  if (!ctx?.review) return [];
  const ready = new Set(readyRows(ctx.review).map((r) => r.draftId));
  return draftIds.filter((id) => ready.has(id));
}

export function SendReadyProvider({ project, children }: { project: string; children: ReactNode }) {
  const pass = useLeadPass(project);
  const batchId = pass.data?.review.batchId ?? null;
  const review = useLeadReview(project, batchId).data;
  const [sheet, setSheet] = useState<{ only: ReadonlySet<number> | null } | null>(null);
  const ctx: Ctx = { project, batchId, review, ready: review ? readyRows(review).length : 0, open: (only) => setSheet({ only: only ? new Set(only) : null }) };
  const title = useRef<HTMLHeadingElement>(null);
  return (
    <SendReady.Provider value={ctx}>
      {children}
      <Sheet onOpenChange={(o) => !o && setSheet(null)} open={sheet !== null && review !== undefined}>
        <SheetPopup className="max-w-2xl" data-testid="send-ready-sheet" initialFocus={title} side="right">
          <SheetHeader>
            <SheetTitle className="outline-none" ref={title} tabIndex={-1}>
              {sheet?.only ? `Send ${sheet.only.size} selected` : "Today’s replies"}
            </SheetTitle>
            <SheetDescription>Nothing goes before Send. Tick off what should wait.</SheetDescription>
          </SheetHeader>
          <SheetPanel>
            {sheet && review && (
              <ReadyList
                d={review}
                key={`${review.batchId}:${sheet.only ? [...sheet.only].join(",") : "all"}`}
                only={sheet.only}
                onSent={(t) => {
                  setSheet(null);
                  if (t.held.length || !t.items.length) toastManager.add({ title: t.items.length ? `${t.items.length} sending` : "Nothing sent", description: sentLine(t), type: t.items.length ? "success" : "warning" });
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

/** "Send all ready (N)": the primary button on top of the list; nothing to send, nothing shown. */
export function SendReadyButton() {
  const ctx = useSendReady();
  const r = ctx?.review;
  if (!ctx || !r || r.rows.length + r.proposals.length === 0) return null;
  return (
    <ActionButton data-testid="send-ready" onClick={() => ctx.open()} size="s" variant="primary">
      <SendIcon aria-hidden="true" />
      Send all ready ({ctx.ready})
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
