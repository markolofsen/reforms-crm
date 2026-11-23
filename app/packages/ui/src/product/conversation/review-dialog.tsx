"use client";

import { AlertDialog } from "@base-ui/react/alert-dialog";
import { AlertTriangleIcon, OctagonXIcon } from "lucide-react";
import { useEffect, useRef, type ReactNode } from "react";
import { cn } from "../../cn";
import { SheetBackdrop, SheetDescription, SheetFooter, SheetPortal, SheetTitle } from "../../ui/sheet";
import { ActionButton } from "../action-button";

/**
 * A problem the dialog lists. A `blocker` keeps the confirm off until it is gone, and carries the fix as its own button when
 * there is one ("Move the Hub's leftover drafts to Trash", "Read it again"); a `warning` is read and accepted by the confirm.
 */
export type ReviewSeverity = "blocker" | "warning";
export type ReviewAction = { label: string; onClick: () => void; pending?: boolean };
export type ReviewItem = { key: string; severity: ReviewSeverity; text: string; /** The rule or check it comes from, in words ("Already written to recently"). */ rule?: string | null; action?: ReviewAction | null };

/** Blockers first, each group in the order given (a stable sort: the caller's order is the reading order). */
export function orderItems(items: readonly ReviewItem[]): ReviewItem[] {
  return [...items.filter((i) => i.severity === "blocker"), ...items.filter((i) => i.severity === "warning")];
}

export type ReviewGate = { blockers: number; warnings: number; canConfirm: boolean; reason: string | null };

/**
 * Whether the one confirm may run, and why not in words: never while a blocker remains, while the items are still being
 * gathered (`loading`) or while the confirm itself runs (`pending`). Warnings never block: reading them and pressing is the consent.
 */
export function reviewGate(items: readonly ReviewItem[], o: { loading?: boolean; pending?: boolean } = {}): ReviewGate {
  const blockers = items.filter((i) => i.severity === "blocker").length;
  const warnings = items.length - blockers;
  const reason = blockers > 0 ? (blockers === 1 ? "Fix the problem above first." : `Fix the ${blockers} problems above first.`) : o.loading ? "Still reading what goes out." : null;
  return { blockers, warnings, canConfirm: reason === null && !o.pending, reason };
}

/** After the dialog opens, a confirm is ignored for this long: a held Shift+Enter must not press Send in the dialog it opened. */
export const REVIEW_DWELL_MS = 400;

type Props = {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** A calm first line ("Goes to the test list only"): a fact of the setting, never a warning. */
  lead?: ReactNode;
  /** What goes where: recipients, subject, the account. */
  summary?: ReactNode;
  items: readonly ReviewItem[];
  /** The items are still being gathered (a read of Mail): said in words, and the confirm waits. */
  loading?: string | null;
  confirmLabel: string;
  /** The label while the confirm runs ("Sending"). */
  pendingLabel?: string;
  onConfirm: () => void;
  pending?: boolean;
  /** Why the confirm failed, in words; the dialog stays open so it can be fixed or cancelled. */
  error?: ReactNode;
  cancelLabel?: string;
  /** `danger` for a confirm that takes something away (Unlink); `primary` otherwise. */
  tone?: "primary" | "danger";
  /** An icon before the confirm label (Send's). */
  confirmIcon?: ReactNode;
  now?: () => number;
};

/**
 * The one review step before a decision that cannot be taken back (P105): every problem in one scroll, blockers first, then one
 * pair of buttons. No per-item "Understood" and no separate switch: reading the list and pressing the confirm is the consent.
 * Esc and Cancel close it and do nothing. Focus starts on Cancel while a blocker remains (or the read runs), on the confirm
 * otherwise (`accessibility.md`). Used by Mail's Send, Send all Checked, a messenger Send, Unlink and Hide.
 * Built from Base UI's alert dialog with the coss sheet's backdrop, title and footer (the same dialog parts; no coss
 * `alert-dialog` copy is in the package yet).
 */
export function ReviewDialog({ open, onOpenChange, title, lead, summary, items, loading = null, confirmLabel, pendingLabel, onConfirm, pending = false, error, cancelLabel = "Cancel", tone = "primary", confirmIcon, now = Date.now }: Props) {
  const ordered = orderItems(items);
  const gate = reviewGate(items, { loading: loading !== null, pending });
  const cancelRef = useRef<HTMLButtonElement>(null);
  const confirmRef = useRef<HTMLButtonElement>(null);
  const openedAt = useRef(0);
  useEffect(() => {
    if (open) openedAt.current = now();
  }, [open, now]);
  const confirm = () => {
    if (!gate.canConfirm || now() - openedAt.current < REVIEW_DWELL_MS) return;
    onConfirm();
  };
  return (
    <AlertDialog.Root onOpenChange={(next) => !pending && onOpenChange(next)} open={open}>
      <SheetPortal>
        <SheetBackdrop />
        <AlertDialog.Viewport className="fixed inset-0 z-50 grid place-items-center p-4">
          <AlertDialog.Popup
            className="flex max-h-[calc(100dvh-2rem)] w-full max-w-lg min-w-0 flex-col overflow-hidden rounded-2xl border bg-popover text-popover-foreground shadow-lg/5 outline-none transition-[opacity,scale] duration-200 data-ending-style:scale-98 data-ending-style:opacity-0 data-starting-style:scale-98 data-starting-style:opacity-0 motion-reduce:transition-none"
            data-testid="review-dialog"
            initialFocus={() => (gate.canConfirm ? confirmRef.current : cancelRef.current)}
          >
            <div className="flex flex-col gap-2 px-6 pt-6 pb-3">
              <SheetTitle className="text-lg">{title}</SheetTitle>
              {lead && <SheetDescription data-testid="review-lead">{lead}</SheetDescription>}
            </div>
            <div className="flex min-h-0 flex-col gap-3 overflow-y-auto px-6 pb-4">
              {summary && <div className="break-words text-sm">{summary}</div>}
              {loading && (
                <p className="text-muted-foreground text-sm" role="status">
                  {loading}
                </p>
              )}
              {ordered.length > 0 && (
                <ul aria-label="Before you decide" className="flex flex-col gap-2">
                  {ordered.map((i) => (
                    <li className={cn("flex items-start gap-3 rounded-lg border p-3 text-sm", i.severity === "blocker" ? "border-destructive/32 bg-destructive/8" : "border-warning/32 bg-warning/8")} data-severity={i.severity} key={i.key}>
                      {i.severity === "blocker" ? <OctagonXIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" /> : <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />}
                      <span className="flex min-w-0 flex-1 flex-col gap-2">
                        <span className="break-words">
                          <b className="font-medium">{i.severity === "blocker" ? "Must be fixed: " : "Read: "}</b>
                          {i.text}
                          {i.rule && <span className="text-muted-foreground"> ({i.rule})</span>}
                        </span>
                        {i.action && (
                          <span>
                            <ActionButton disabled={i.action.pending || pending} onClick={i.action.onClick} size="s" variant="secondary">
                              {i.action.label}
                            </ActionButton>
                          </span>
                        )}
                      </span>
                    </li>
                  ))}
                </ul>
              )}
              {error && (
                <div className="break-words text-destructive-foreground text-sm" role="alert">
                  {error}
                </div>
              )}
            </div>
            <SheetFooter>
              <AlertDialog.Close disabled={pending} ref={cancelRef} render={<ActionButton size="m" variant="quiet" />}>
                {cancelLabel}
              </AlertDialog.Close>
              <span className="flex flex-col items-stretch gap-1 sm:items-end">
                <ActionButton aria-describedby={gate.reason ? "review-dialog-reason" : undefined} aria-disabled={!gate.canConfirm} className="aria-disabled:opacity-64" data-testid="review-confirm" loading={pending} onClick={confirm} ref={confirmRef} size="m" variant={tone}>
                  {confirmIcon}
                  {pending && pendingLabel ? pendingLabel : confirmLabel}
                </ActionButton>
                {gate.reason && (
                  <span className="text-muted-foreground text-xs" id="review-dialog-reason">
                    {gate.reason}
                  </span>
                )}
              </span>
            </SheetFooter>
          </AlertDialog.Popup>
        </AlertDialog.Viewport>
      </SheetPortal>
    </AlertDialog.Root>
  );
}
