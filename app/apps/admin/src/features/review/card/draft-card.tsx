import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useEffect } from "react";
import { toastManager } from "@hub/ui/toast";
import { useGo } from "@/hooks/use-go";
import { refreshData, sentence } from "@/lib/api/client";
import { sendApi } from "@/lib/api/send";
import { mailLink } from "@/lib/mail";
import { paths } from "@/routes/paths";
import type { ReviewDraft } from "../source";
import type { ReviewActions } from "../use-review-actions";
import { BasedOnStrip } from "../based-on/based-on-strip";
import { ActionBar, SendNotices, type Handlers } from "./action-bar";
import { CardHeader } from "./card-header";
import { stateOf } from "./card-state";
import { mailReadable, tickBlock } from "../mail/tick-guard";
import { CheckList } from "./check-list";
import { DraftBlock } from "./draft-block";
import { ThreadTable } from "../mail/thread-table";
import { useDraftMail } from "../mail/use-draft-mail";
import { useSendKey } from "../mail/use-send-key";
import { useSendFlow } from "./use-send-flow";

export type CardProps = {
  d: ReviewDraft;
  project: string;
  actions: ReviewActions;
  now: number;
  thread: boolean;
  onThread: () => void;
  onReplyAll: (d: ReviewDraft) => void;
  advance: () => void;
  say: (text: string) => void;
};

/**
 * One draft, designed once: header, about, checks (only when present), the draft, the action bar. The bar is a pure
 * function of the card's state (`card-state.ts`), so there is never a second primary and never a dead button.
 */
export function DraftCard({ d, project, actions, now, thread, onThread, onReplyAll, advance, say }: CardProps) {
  const qc = useQueryClient();
  const go = useGo();
  const { flow, read, send, close } = useSendFlow(project, d.id);
  const mail = useDraftMail(project, d).data;
  const state = stateOf(d, flow.step, mailReadable(mail));
  const first = d.client.name.split(" ")[0] ?? d.client.name;
  const cancel = useMutation({
    mutationFn: () => (d.sendState ? sendApi.cancel(project, d.sendState.id) : Promise.reject(new Error("Nothing is queued."))),
    onSuccess: () => {
      toastManager.add({ title: `Cancelled the send to ${first}`, type: "success" });
      return refreshData(qc);
    },
    onError: (e) => say(sentence(e)),
  });
  // After a send the card moves on to the next draft, and the person hears what went where.
  const sent = flow.step === "sent";
  useEffect(() => {
    if (!sent) return;
    toastManager.add({ title: `Sent to ${first}`, type: "success" });
    advance();
  }, [sent, first, advance]);

  const undoToast = (title: string) => toastManager.add({ title, type: "success", actionProps: { children: "Undo", onClick: () => actions.undo(d) } });
  const on: Handlers = {
    send: read,
    confirm: () => flow.step === "confirm" && send(flow.mail),
    cancelFlow: close,
    skip: (reason) => {
      advance();
      actions.setStatus(d, "skipped", reason);
      undoToast(`Skipped ${first}`);
    },
    done: () => {
      advance();
      actions.setStatus(d, "done");
      undoToast(`Marked ${first} done`);
    },
    hold: () => actions.setStatus(d, "hold"),
    resume: () => actions.setStatus(d, "ready"),
    reopen: () => actions.setStatus(d, "ready"),
    replyMail: () => onReplyAll(d),
    cancelSend: () => cancel.mutate(),
    copySubject: () => {
      void navigator.clipboard
        .writeText(d.subject)
        .then(() => say("Copied. In Mail press Option+Command+F and paste."))
        .catch(() => say("The clipboard was blocked: copy the subject from the draft."));
    },
    history: () => d.runId !== null && go(paths.log.list({ run: d.runId })),
    blocked: say,
  };
  // Shift+Enter: read Mail and show the confirmation, then send what was shown. Nothing else sends by key.
  useSendKey(state === "acknowledged" || state === "failed" ? read : state === "confirming" ? on.confirm : null);
  const confirmed = flow.step === "confirm" || flow.step === "sending" ? flow.mail.body : null;
  return (
    <article aria-label={`Draft for ${d.client.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col">
      <div className="flex min-w-0 flex-1 flex-col gap-6 p-4 lg:p-6">
        <CardHeader actions={actions} d={d} now={now} ready={state === "acknowledged"} />
        {d.reason && (
          <p className="break-words text-sm">
            <span className="text-muted-foreground">Why this email: </span>
            {d.reason}
          </p>
        )}
        {d.skipReason && <p className="text-sm">Skipped: {d.skipReason}</p>}
        <BasedOnStrip d={d} />
        <ThreadTable d={d} project={project} />
        <CheckList actions={actions} d={d} {...(mail?.found ? { results: mail.safetyResults } : {})} />
        <DraftBlock actions={actions} confirmed={confirmed} d={d} {...(mail ? { live: mail } : {})} onThread={onThread} project={project} thread={thread} />
        <SendNotices flow={flow} onClose={close} />
      </div>
      <ActionBar actions={actions} context={{ name: first, hasMailLink: mailLink(d.mailRef) !== null, acknowledged: d.checked }} d={d} flow={flow} mailHash={mail?.hash ?? null} on={on} tickBlock={tickBlock(d, mail, flow.step)} state={state} />
    </article>
  );
}
