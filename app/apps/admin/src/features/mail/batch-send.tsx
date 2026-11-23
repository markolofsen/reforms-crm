"use client";

import { useMutation, useQuery, useQueryClient } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import { useEffect, useRef, useState } from "react";
import type { BatchRunDto, BatchSendPlanDto } from "@hub/contract/sending";
import { Alert, AlertDescription, AlertTitle } from "@hub/ui/alert";
import { ActionButton } from "@hub/ui/product/action-button";
import { ApiFailure, refreshData, sentence } from "@/lib/api/client";
import { reviewApi } from "@/lib/api/review";
import { batchSendApi } from "@/lib/api/send";
import { toastManager } from "@hub/ui/toast";
import { keys } from "@/lib/cache/keys";

// Send all Checked of one batch (P85b, decision 0011 amendment of 2026-11-20 point 4). Never automatic: a click reads every
// Checked draft of the batch from Mail through the send door's checks (a dry run, nothing sent); one confirmation in place names
// the count and every recipient and lists who is held and why; the second click starts one run on the server, which sends one
// draft at a time, spaced, through the same door. The run's progress is read while it runs (like WhatsApp's pairing: a process
// on the server, not rows), and Stop leaves the drafts not yet tried Checked.

/** While a run is going, its progress is read this often (the `sends` live topic also moves on each mail). */
export const BATCH_RUN_POLL_MS = 2000;

type Step = { k: "idle" } | { k: "reading" } | { k: "confirm"; plan: BatchSendPlanDto } | { k: "refused"; reasons: string[] } | { k: "failed"; message: string };

const plural = (n: number, one: string, many = `${one}s`) => `${n} ${n === 1 ? one : many}`;
const minutes = (n: number, spacing: number) => Math.max(1, Math.round(((n - 1) * spacing) / 60));
const STATUS: Record<BatchRunDto["items"][number]["status"], string> = { waiting: "Waiting", sending: "Sending", sent: "Sent", refused: "Not sent", failed: "Failed", stopped: "Stopped" };

export function BatchSend({ project, batchId, checked, open, brief }: { project: string; batchId: number; checked: number; /** Drafts of the batch still open (to review, Checked, on hold): the warnings line only while there are some. */ open: number; /** The owner's words that asked for the batch, shown in full (P87). */ brief: string | null }) {
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
  // P87 (finding 6): every amber result of the batch's open drafts understood in one click; red ones stay one by one on each card.
  const warnings = useMutation({
    mutationFn: () => reviewApi.acknowledgeWarnings(project, batchId),
    onSuccess: (r) => {
      toastManager.add({ title: r.results === 0 ? "No warning left to acknowledge" : `Understood ${plural(r.results, "warning")} on ${plural(r.drafts, "draft")}`, type: "success" });
      return refreshData(qc);
    },
    onError: (e) => toastManager.add({ title: "Not acknowledged", description: sentence(e), type: "error" }),
  });
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
      {!running && open > 0 && (
        <div className="flex flex-wrap items-center gap-3">
          <p className="min-w-0 flex-1 text-muted-foreground text-sm">In a batch, warnings must be acknowledged too, not only red checks. Red checks stay one by one on each card.</p>
          <ActionButton aria-disabled={warnings.isPending} className="aria-disabled:opacity-64 max-sm:h-(--control-l)" onClick={() => !warnings.isPending && warnings.mutate()} size="s" variant="quiet">
            {warnings.isPending ? "Acknowledging" : "Understood all warnings"}
          </ActionButton>
        </div>
      )}
      {r && <RunView onStop={() => stop.mutate()} run={r} stopping={stop.isPending} />}
      {step.k === "confirm" && <Confirm busy={start.isPending} onCancel={() => setStep({ k: "idle" })} onSend={() => start.mutate(step.plan)} plan={step.plan} />}
      {step.k === "refused" && <Notice onClose={() => setStep({ k: "idle" })} reasons={step.reasons} title={`Not started: ${plural(step.reasons.length, "reason")}`} />}
      {step.k === "failed" && <Notice onClose={() => setStep({ k: "idle" })} reasons={[step.message]} title="The batch send could not start" />}
      {!running && step.k !== "confirm" && (
        <div className="flex flex-wrap items-center gap-3">
          <ActionButton aria-disabled={checked === 0 || step.k === "reading"} className="aria-disabled:opacity-64 max-sm:h-(--control-l)" onClick={() => checked > 0 && step.k !== "reading" && plan.mutate()} size="m" variant="secondary">
            <SendIcon aria-hidden="true" />
            {step.k === "reading" ? "Reading Mail" : "Send all Checked"}
          </ActionButton>
          <p className="text-muted-foreground text-sm">{checked === 0 ? "No draft of this batch is Checked yet." : `${plural(checked, "Checked draft")} in this batch; you confirm the list before anything is sent.`}</p>
        </div>
      )}
    </section>
  );
}

function Confirm({ plan, busy, onSend, onCancel }: { plan: BatchSendPlanDto; busy: boolean; onSend: () => void; onCancel: () => void }) {
  const n = plan.items.length;
  return (
    <div aria-live="polite" className="flex flex-col gap-2 rounded-lg border p-3">
      <h3 className="font-medium text-sm">{n === 0 ? "Nothing in this batch can be sent now" : `Send ${plural(n, "mail")}, one every ${plan.spacingSeconds} s${n > 1 ? ` (about ${plural(minutes(n, plan.spacingSeconds), "minute")})` : ""}`}</h3>
      {n > 0 && (
        <ul aria-label="Recipients" className="flex flex-col gap-1 text-sm">
          {plan.items.map((i) => (
            <li key={i.draftId}>
              <span className="font-medium">{i.name}</span> · {[...i.to, ...i.cc].join(", ")} · <span className="text-muted-foreground">{i.subject}</span>
            </li>
          ))}
        </ul>
      )}
      {plan.held.length > 0 && (
        <div className="text-sm">
          <p className="font-medium">Held, not in this send ({plan.held.length})</p>
          <ul aria-label="Held" className="list-disc ps-5">
            {plan.held.map((h) => (
              <li key={h.draftId}>
                {h.name}: {h.reasons.join("; ")}
              </li>
            ))}
          </ul>
        </div>
      )}
      <p className="text-muted-foreground text-xs">
        Batch mails today: {plan.cap.used} of {plan.cap.limit}. Each mail goes through the same checks as one Send; Stop sending and Stop below halt it between two mails.
      </p>
      <div className="flex flex-wrap gap-2">
        {n > 0 && (
          <ActionButton aria-disabled={busy} className="aria-disabled:opacity-64 max-sm:h-(--control-l)" onClick={() => !busy && onSend()} size="m" variant="primary">
            <SendIcon aria-hidden="true" />
            {busy ? "Starting" : `Send ${plural(n, "mail")}`}
          </ActionButton>
        )}
        <ActionButton className="max-sm:h-(--control-l)" onClick={onCancel} size="m" variant="secondary">
          Cancel
        </ActionButton>
      </div>
    </div>
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
          <ActionButton aria-disabled={stopping} className="aria-disabled:opacity-64 max-sm:h-(--control-l)" onClick={() => !stopping && onStop()} size="m" variant="secondary">
            {stopping ? "Stopping" : "Stop"}
          </ActionButton>
        </div>
      )}
    </div>
  );
}

function Notice({ title, reasons, onClose }: { title: string; reasons: string[]; onClose: () => void }) {
  return (
    <Alert variant="warning">
      <AlertTitle>{title}</AlertTitle>
      <AlertDescription>
        <ul className="list-disc ps-5">{reasons.map((x) => <li key={x}>{x}</li>)}</ul>
        <ActionButton className="mt-2" onClick={onClose} size="s" variant="secondary">
          Close
        </ActionButton>
      </AlertDescription>
    </Alert>
  );
}
