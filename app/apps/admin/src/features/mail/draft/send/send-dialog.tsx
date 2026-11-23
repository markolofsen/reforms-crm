"use client";

import { useMutation, useQuery } from "@tanstack/react-query";
import { SendIcon } from "lucide-react";
import type { DraftMailDto } from "@hub/contract/mail";
import type { SendPreviewDto } from "@hub/contract/sending";
import { ReviewDialog, type ReviewItem } from "@hub/ui/product/review-dialog";
import { toastManager } from "@hub/ui/toast";
import { flowProblems, type Go } from "@/components/send/send-flow";
import { sentence } from "@/lib/api/client";
import { reviewApi } from "@/lib/api/review";
import { sendApi } from "@/lib/api/send";
import { keys } from "@/lib/cache/keys";
import type { ReviewDraft } from "@/features/mail/model";
import { differsFromShown, sendLoading, sendProblems, shownResults, type SendFix } from "./send-review";
import type { SendFlow } from "./use-send-flow";

/** `send`: the dialog's button sends. `check`: it only marks the draft Checked for Send all Checked of its batch (P105 verdict 5). */
export type ReviewMode = "send" | "check";

type Props = {
  mode: ReviewMode;
  open: boolean;
  onClose: () => void;
  project: string;
  d: ReviewDraft;
  name: string;
  mail: DraftMailDto | undefined;
  readError: string | null;
  changedUnder: boolean;
  /** Read Mail again (and forget the changed-under mark). */
  onReread: () => void;
  flow: SendFlow;
  go: (o: Go<SendPreviewDto>) => void;
  /** Forget a refused or failed confirm (its reasons are blockers until then). */
  resetFlow: () => void;
};

const plural = (n: number, one: string) => `${n} ${one}${n === 1 ? "" : "s"}`;

/**
 * One Mail Send, reviewed once (P105 verdicts 1 to 3, 6): what goes where, every open check as a warning, every Mail-side problem
 * as a blocker with its fix; one Send. Send acknowledges the checks it listed and marks the draft Checked on the text that was read
 * (decision 0013), then runs the send door's dry run and applies it only when it is what the dialog showed.
 */
export function MailSendDialog({ mode, open, onClose, project, d, name, mail, readError, changedUnder, onReread, flow, go, resetFlow }: Props) {
  const doctor = useQuery({ queryKey: keys.doctor(project), queryFn: () => sendApi.doctor(project), enabled: open });
  const tidy = useMutation({
    mutationFn: () => sendApi.tidy(project, d.id),
    onSuccess: (r) => {
      toastManager.add({ title: r.moved === 0 ? "Nothing of the Hub's to move: the other draft is not one the Hub wrote. Keep one in Mail." : `Moved ${plural(r.moved, "leftover draft")} to Mail's Trash`, type: r.moved === 0 ? "info" : "success" });
      reread();
    },
    onError: (e) => toastManager.add({ title: "Not moved", description: sentence(e), type: "error" }),
  });
  // Acknowledge what the dialog listed and tick Checked on the very text that was read (the server refuses a stale hash).
  const consent = async (hash: string, listed: readonly { kind: Parameters<typeof reviewApi.ack>[2] }[]) => {
    for (const r of listed) await reviewApi.ack(project, d.id, r.kind, true);
    if (!(d.checked && mail?.checkedCurrent)) await reviewApi.setChecked(project, d.id, true, hash);
  };
  const check = useMutation({
    mutationFn: (o: { hash: string; listed: ReturnType<typeof shownResults> }) => consent(o.hash, o.listed),
    onSuccess: () => {
      toastManager.add({ title: `Checked: ${name} goes with Send all Checked`, type: "success" });
      onClose();
    },
  });
  const reread = () => {
    resetFlow();
    check.reset();
    onReread();
  };
  const input = { d, mail, readError, changedUnder, refused: [...flowProblems(flow), ...(check.isError ? [sentence(check.error)] : [])] };
  const action = (fix: SendFix | null): ReviewItem["action"] =>
    fix === "read" ? { label: "Read it again", onClick: reread } : fix === "tidy" ? { label: "Move the Hub's leftover drafts to Trash", onClick: () => tidy.mutate(), pending: tidy.isPending } : null;
  const items: ReviewItem[] = sendProblems(input).map((p) => ({ key: p.key, severity: p.severity, text: p.text, rule: p.rule, action: action(p.fix) }));
  const confirm = () => {
    if (!mail?.found || !mail.hash) return;
    const shown = mail;
    const hash = mail.hash;
    const listed = shownResults(input);
    if (mode === "check") check.mutate({ hash, listed });
    else go({ before: () => consent(hash, listed), accept: (p) => differsFromShown(shown, p) });
  };
  const pending = mode === "check" ? check.isPending : flow.step === "reading" || flow.step === "sending";
  const test = doctor.data?.facts?.recipients === "test";
  return (
    <ReviewDialog
      confirmIcon={mode === "send" ? <SendIcon aria-hidden="true" /> : undefined}
      confirmLabel={mode === "send" ? "Send" : "Check"}
      items={items}
      lead={mode === "check" ? "Send all Checked of its batch sends it later, with the others, through the same checks." : test ? "Goes to the test list only (Settings ▸ Sending): the client gets nothing." : undefined}
      loading={sendLoading(input)}
      onConfirm={confirm}
      onOpenChange={(next) => {
        if (!next) onClose();
      }}
      open={open}
      pending={pending}
      pendingLabel={mode === "check" ? "Checking" : flow.step === "sending" ? "Sending" : "Reading Mail"}
      summary={mail?.found ? <MailSummary mail={mail} /> : undefined}
      title={mode === "send" ? `Send to ${name}?` : `Check the draft for ${name}?`}
    />
  );
}

function MailSummary({ mail }: { mail: DraftMailDto }) {
  return (
    <div className="flex flex-col gap-1">
      <dl className="grid grid-cols-[auto_minmax(0,1fr)] gap-x-3 gap-y-1">
        <dt className="text-muted-foreground">To</dt>
        <dd className="break-words">{mail.to.join(", ") || "nobody"}</dd>
        {mail.cc.length > 0 && (
          <>
            <dt className="text-muted-foreground">Cc</dt>
            <dd className="break-words">{mail.cc.join(", ")}</dd>
          </>
        )}
        <dt className="text-muted-foreground">Subject</dt>
        <dd className="break-words">{mail.subject}</dd>
        {mail.from && (
          <>
            <dt className="text-muted-foreground">From</dt>
            <dd className="break-words">{mail.from}</dd>
          </>
        )}
      </dl>
      <p className="text-muted-foreground text-xs">The text is exactly what Mail holds now, as the draft shows it. A sent mail cannot be recalled.</p>
    </div>
  );
}
