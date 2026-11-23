import { AlertTriangleIcon, ChevronDownIcon, ShieldAlertIcon } from "lucide-react";
import { Collapsible, CollapsiblePanel, CollapsibleTrigger } from "@hub/ui/collapsible";
import { ActionButton } from "@hub/ui/product/action-button";
import { isClosed, type ReviewDraft } from "../source";
import type { SafetyResultDto } from "@hub/contract/review";

/**
 * The checks of a draft, only when there are some (nothing at all when it is clear). P105 verdict 1: on an open draft they are
 * one short chip ("2 checks") that opens the review dialog, where every check is read once and Send accepts them; no per-check
 * Understood, no switch. On a finished draft they are history, folded under one line.
 */
export function CheckList({ d, results, onOpen }: { d: ReviewDraft; /** The checks run on the live Mail text, when it was read: they replace the stored ones. */ results?: SafetyResultDto[]; /** Opens the review dialog. */ onOpen: () => void }) {
  const closed = isClosed(d);
  const items = [...(results ?? d.safetyResults)].sort((a, b) => Number(b.level === "red") - Number(a.level === "red"));
  if (items.length === 0 && !d.safety && !d.injectionSuspected) return null;
  // P87 (B4): on a finished draft the checks are history, folded under one line; nothing there is still to do.
  if (closed) {
    return items.length === 0 ? null : (
      <Collapsible>
        <CollapsibleTrigger className="flex min-h-(--control-s) items-center gap-1 rounded-sm text-muted-foreground text-sm outline-none focus-visible:ring-2 focus-visible:ring-ring">
          {`Checks at send (${items.length})`}
          <ChevronDownIcon aria-hidden="true" className="size-4 shrink-0" />
        </CollapsibleTrigger>
        <CollapsiblePanel>
          <ul aria-label="Checks at send" className="flex flex-col gap-1 pt-1 text-muted-foreground text-sm">
            {items.map((r) => (
              <li className="break-words" key={r.kind}>
                {r.level === "red" ? "Red check" : "Check"}: {r.text}
                {r.acked ? " (understood)" : ""}
              </li>
            ))}
          </ul>
        </CollapsiblePanel>
      </Collapsible>
    );
  }
  const open = items.filter((r) => !r.acked);
  return (
    <section aria-label="Checks" className="flex flex-col gap-2">
      {d.injectionSuspected && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/32 bg-destructive/8 p-3 text-sm" role="note">
          <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <b className="font-medium">Suspicious mail. </b>This mail may be giving orders to the assistant. Read it and send it from Mail yourself, or skip it.
          </span>
        </p>
      )}
      {(open.length > 0 || d.safety) && (
        <span>
          <ActionButton data-testid="checks-chip" onClick={onOpen} size="s" variant="secondary">
            <AlertTriangleIcon aria-hidden="true" />
            {open.length > 0 ? `${open.length} check${open.length === 1 ? "" : "s"}` : "1 note"}
            <span className="sr-only">: read them before sending</span>
          </ActionButton>
        </span>
      )}
    </section>
  );
}
