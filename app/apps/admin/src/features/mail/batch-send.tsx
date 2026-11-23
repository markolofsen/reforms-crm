"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BatchRunDto, BatchSendPlanDto } from "@hub/contract/sending";
import { ReviewDialog, type ReviewItem } from "@hub/ui/product/review-dialog";
import { ActionButton } from "@hub/ui/product/action-button";
import { ApiFailure, refreshData, sentence } from "@/lib/api/client";
import { batchSendApi } from "@/lib/api/send";
import { keys } from "@/lib/cache/keys";

// Send all Checked of one batch (P85b, decision 0011 amendment of 2026-11-20 point 4). Never automatic: a click reads every
// Checked draft of the batch from Mail through the send door's checks (a dry run, nothing sent); the review dialog (P105) names
// the count and every recipient and lists who is held and why; its Send starts one run on the server, which sends one
// draft at a time, spaced, through the same door. The run's progress is read while it runs (like WhatsApp's pairing: a process
// on the server, not rows), and Stop leaves the drafts not yet tried Checked.

/** While a run is going, its progress is read this often (the `sends` live topic also moves on each mail). */
export const BATCH_RUN_POLL_MS = 2000;

type Step = { k: "idle" } | { k: "reading" } | { k: "confirm"; plan: BatchSendPlanDto } | { k: "refused"; reasons: string[] } | { k: "failed"; message: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutes = (n: number, spacing: number) => Math.max(1, Math.round(((n - 1) * spacing) / 60));
const STATUS: Record<BatchRunDto["items"][number]["status"], string> = { waiting: "Waiting", sending: "Sending", sent: "Sent", refused: "Not sent", failed: "Failed", stopped: "Stopped" };

export function BatchSend({ project, batchId, checked, brief }: { project: string; batchId: number; checked: number; /** The owner's words that asked for the batch, shown in full (P87). */ brief: string | null }) {
  const qc = useQueryClient();
  const [step, setStep] = useState<Step>({ k: "idle" });
  const run = useQuery({
    queryKey: keys.batchRun(project, batchId),
    queryFn: () => batchSendApi.run(project, batchId),
    refetchInterval: (q) => (q.state.data?.run?.state === "running" ? BATCH_RUN_POLL_MS : false),
  });
  const failed = (e: unknown) => setStep(e instanceof ApiFailure && e.refused.length > 0 ? { k: "refused", reasons: e.refused } : { k: "failed", message: sentence(e) });
  const plan = useMutation({ mutationFn: () => batchSendApi.plan(project, batchId), onMutate: () => setStep({ k: "reading" }), onSuccess: (p) => setStep({ k: "confirm", plan: p }), onError: failed });
  const start = useMutation({
    mutationFn: (p: BatchSendPlanDto) => batchSendApi.start(project, batchId, p),
    onSuccess: (r) => {
      qc.setQueryData(keys.batchRun(project, batchId), r);
      setStep({ k: "idle" });
    },
    onError: failed,
  });
  const stop = useMutation({ mutationFn: () => batchSendApi.stop(project, batchId), onSuccess: (r) => qc.setQueryData(keys.batchRun(project, batchId), r) });
  // Each mail sent changes the drafts (Sent detection) and the history: read them again when the run moves on, and once at its end.
  const r = run.data?.run ?? null;
  const done = r ? r.items.filter((i) => i.status !== "waiting" && i.status !== "sending").length : 0;
  const seen = useRef(-1);
  useEffect(() => {
    // P87 (B4): with the Mail reads too, so a sent card reads Mail again instead of showing its draft as deleted.
    if (seen.current !== -1 && seen.current !== done) void refreshData(qc, { mail: true });
    seen.current = done;
  }, [done, qc]);

  const running = r?.state === "running";
  return (
    <section aria-label="Send all Checked" className="flex flex-col gap-3 border-t p-3">
      {brief && (
        <p className="break-words text-sm">
          <span className="text-muted-foreground">Asked for: </span>
          {brief}
        </p>
      )}
      {r && <RunView onStop={() => stop.mutate()} run={r} stopping={stop.isPending} />}
      <BatchReview onClose={() => !start.isPending && setStep({ k: "idle" })} onSend={(p) => start.mutate(p)} pending={start.isPending} step={step} />
      {!running && (
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton aria-disabled={checked === 0 || step.k === "reading"} className="aria-disabled:opacity-64" onClick={() => checked > 0 && step.k !== "reading" && plan.mutate()} size="m" variant="secondary">
            <SendIcon aria-hidden="true" />
            {step.k === "reading" ? "Reading Mail" : "Send all Checked"}
          </ActionButton>
          <p className="text-muted-foreground text-sm">{checked === 0 ? "No draft of this batch is Checked yet (More ▸ Check for Send all Checked, or C, on its card)." : `${plural(checked, "Checked draft")} in this batch; you review the list once before anything is sent.`}</p>
        </div>
      )}
    </section>
  );
}

/**
 * Send all Checked, reviewed once (P105 S3): who gets what in the summary, every held draft as a warning (it is left out, the
 * others go), a refusal as a blocker; one Send for the whole list. The run then sends one draft at a time through the same door.
 */
function BatchReview({ step, pending, onSend, onClose }: { step: Step; pending: boolean; onSend: (p: BatchSendPlanDto) => void; onClose: () => void }) {
  const plan = step.k === "confirm" ? step.plan : null;
  const n = plan?.items.length ?? 0;
  const items: ReviewItem[] = [
    ...(plan?.held ?? []).map((h): ReviewItem => ({ key: `held-${h.draftId}`, severity: "warning", text: `${h.name} is held, not in this send: ${h.reasons.join("; ")}` })),
    ...(step.k === "refused" ? step.reasons : step.k === "failed" ? [step.message] : []).map((r, i): ReviewItem => ({ key: `refused-${i}`, severity: "blocker", text: r })),
    ...(plan && n === 0 ? [{ key: "nothing", severity: "blocker" as const, text: "Nothing in this batch can be sent now." }] : []),
  ];
  return (
    <ReviewDialog
      confirmIcon={<SendIcon aria-hidden="true" />}
      confirmLabel={`Send ${plural(n, "mail")}`}
      items={items}
      lead={plan ? `One every ${plan.spacingSeconds} s${n > 1 ? `, about ${plural(minutes(n, plan.spacingSeconds), "minute")}` : ""}. Batch mails today: ${plan.cap.used} of ${plan.cap.limit}.` : undefined}
      onConfirm={() => plan && onSend(plan)}
      onOpenChange={(next) => !next && onClose()}
      open={step.k === "confirm" || step.k === "refused" || step.k === "failed"}
      pending={pending}
      pendingLabel="Starting"
      summary={
        n > 0 ? (
          <ul aria-label="Recipients" className="flex flex-col gap-1">
            {plan?.items.map((i) => (
              <li key={i.draftId}>
                <span className="font-medium">{i.name}</span> · {[...i.to, ...i.cc].join(", ")} · <span className="text-muted-foreground">{i.subject}</span>
              </li>
            ))}
          </ul>
        ) : undefined
      }
      title="Send all Checked?"
    />
  );
}

function RunView({ run, stopping, onStop }: { run: BatchRunDto; stopping: boolean; onStop: () => void }) {
  const sent = run.items.filter((i) => i.status === "sent").length;
  const title = run.state === "running" ? `Sending: ${sent} of ${run.items.length} sent` : `${run.state === "stopped" ? "Stopped" : "Finished"}: ${sent} of ${run.items.length} sent`;
  return (
    <div aria-live="polite" className="flex flex-col gap-2 rounded-lg border p-3">
      <h3 className="font-medium text-sm">{title}</h3>
      <ul aria-label="Batch send progress" className="flex flex-col gap-1 text-sm">
        {run.items.map((i) => (
          <li key={i.draftId}>
            <span className="font-medium">{STATUS[i.status]}</span> · {i.name} · {i.to.join(", ")}
            {i.reasons.length > 0 && <span className="text-muted-foreground"> · {i.reasons.join("; ")}</span>}
          </li>
        ))}
      </ul>
      {run.state === "running" && (
        <div>
          <ActionButton aria-disabled={stopping} className="aria-disabled:opacity-64" onClick={() => !stopping && onStop()} size="m" variant="secondary">
            {stopping ? "Stopping" : "Stop"}
          </ActionButton>
        </div>
      )}
    </div>
  );
}
