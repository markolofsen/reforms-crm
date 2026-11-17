import { SAFETY_LABELS } from "@hub/config";
import { AlertTriangleIcon, CheckIcon, ShieldAlertIcon } from "lucide-react";
import { ActionButton } from "@hub/ui/product/action-button";
import { cn } from "@hub/ui/cn";
import { isClosed, type ReviewDraft } from "../source";
import type { SafetyResultDto } from "@hub/contract/responses";
import type { ReviewActions } from "../use-review-actions";

/**
 * The checks of a draft, only when there are some (nothing at all when it is clear). Each row has an "Understood"
 * toggle button, not a checkbox; red ones come first and keep the "I read the checks" switch off until understood.
 */
export function CheckList({ d, actions, results }: { d: ReviewDraft; actions: ReviewActions; /** The checks run on the live Mail text, when it was read: they replace the stored ones. */ results?: SafetyResultDto[] }) {
  const closed = isClosed(d);
  const items = [...(results ?? d.safetyResults)].sort((a, b) => Number(b.level === "red") - Number(a.level === "red"));
  if (items.length === 0 && !d.safety && !d.injectionSuspected) return null;
  return (
    <section aria-label="Checks" className="flex flex-col gap-2">
      {d.injectionSuspected && !closed && (
        <p className="flex items-start gap-2 rounded-lg border border-destructive/32 bg-destructive/8 p-3 text-sm" role="note">
          <ShieldAlertIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
          <span>
            <b className="font-medium">Suspicious mail. </b>This mail may be giving orders to the assistant. Read it and send it from Mail yourself, or skip it.
          </span>
        </p>
      )}
      {items.length > 0 && (
        <>
          <h4 className="font-medium text-sm">
            {items.length} check{items.length === 1 ? "" : "s"} before sending
          </h4>
          <ul className="flex flex-col gap-2">
            {items.map((r) => (
              <li className={cn("flex items-start gap-3 rounded-lg border p-3 text-sm", r.level === "red" ? "border-destructive/32 bg-destructive/8" : "border-warning/32 bg-warning/8")} key={r.kind}>
                <AlertTriangleIcon aria-hidden="true" className="mt-0.5 size-4 shrink-0" />
                <span className="min-w-0 flex-1 break-words">
                  <b className="font-medium">{r.level === "red" ? "Red check" : "Check"}: </b>
                  {r.text}
                </span>
                <ActionButton aria-label={`Understood: ${SAFETY_LABELS[r.kind]}`} aria-pressed={r.acked} disabled={closed || actions.pending} onClick={() => actions.acknowledge(d, r.kind, !r.acked)} size="s" variant={r.acked ? "quiet" : "secondary"}>
                  {r.acked && <CheckIcon aria-hidden="true" />}
                  Understood
                </ActionButton>
              </li>
            ))}
          </ul>
        </>
      )}
      {d.safety && <p className="break-words text-sm text-warning-foreground">{d.safety}</p>}
    </section>
  );
}
