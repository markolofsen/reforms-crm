import { useMutation, useQueryClient } from "@tanstack/react-query";
import type { ContactLinksDto } from "@hub/contract/local";
import { useState, type ReactNode } from "react";
import { refOf } from "@hub/contract/focus";
import { ConversationComposer, ConversationComposerFooter } from "@hub/ui/product/conversation-frame";
import { toastManager } from "@hub/ui/toast";
import { useGo } from "@/hooks/use-go";
import { LoadFailed } from "@/components/state-views";
import { refreshData, sentence } from "@/lib/api/client";
import { agentRef } from "@/lib/focus";
import { copyText } from "@/lib/external";
import { sendApi } from "@/lib/api/send";
import { dest } from "@/routes/paths";
import { firstName, type ReviewDraft } from "../source";
import type { ReviewActions } from "../use-review-actions";
import { BasedOnStrip } from "../based-on/based-on-strip";
import { ActionBar, hasMailLink, type Handlers } from "./action-bar";
import { CardHeader } from "./card-header";
import { stateOf } from "./card-state";
import { draftLinkOf, mailReadable } from "../mail/tick-guard";
import { CheckList } from "./check-list";
import { DraftBlock } from "./draft-block";
import { DraftEditor, DraftEditorFooter } from "../mail/draft-editor";
import { useMailWrite } from "../mail/use-mail-write";
import { useDraftMail } from "../mail/use-draft-mail";
import { useChangedUnder } from "../mail/use-changed-under";
import { ActionButton } from "@hub/ui/product/action-button";
import { useSendKey } from "../mail/use-send-key";
import { MailSendDialog } from "./send-dialog";
import { useOnSent, useSendFlow } from "./use-send-flow";

export type CardProps = {
  d: ReviewDraft;
  project: string;
  actions: ReviewActions;
  now: number;
  advance: () => void;
  say: (text: string) => void;
  embedded?: boolean;
  composerNotice?: ReactNode;
  /** P131 O5: the client's Telegram and WhatsApp (their Notion card), for the Client menu. */
  contact?: ContactLinksDto | null;
};

/**
 * One draft, designed once: header, about, checks (only when present), the draft, the action bar. The bar is a pure
 * function of the card's state (`card-state.ts`), so there is never a second primary and never a dead button.
 */
export function DraftCard({ d, project, actions, now, advance, say, embedded = false, composerNotice, contact = null }: CardProps) {
  const qc = useQueryClient();
  const navigate = useGo();
  const { flow, go, close } = useSendFlow(project, d.id);
  const mailRead = useDraftMail(project, d);
  const mail = mailRead.data;
  const mailError = mailRead.isError && !mail ? sentence(mailRead.error) : null;
  const state = stateOf(d, flow.step, mailReadable(mail));
  const draftLink = draftLinkOf(mail);
  const first = firstName(d);
  const under = useChangedUnder(d);
  const [editing, setEditing] = useState<{ text: string; hash: string } | null>(null);
  const [editValue, setEditValue] = useState("");
  const [editSaved, setEditSaved] = useState(false);
  const { save: editSave } = useMailWrite(project, d.id);
  const cancel = useMutation({
    mutationFn: () => (d.sendState ? sendApi.cancel(project, d.sendState.id) : Promise.reject(new Error("Nothing is queued."))),
    onSuccess: () => {
      toastManager.add({ title: `Cancelled the send to ${first}`, type: "success" });
      return refreshData(qc, { mail: true });
    },
    onError: (e) => say(sentence(e)),
  });
  // After a send the card moves on to the next draft, and the person hears what went where.
  const sent = flow.step === "sent";
  useOnSent(sent, () => {
    actions.closeReview();
    close();
    toastManager.add({ title: `Sent to ${first}`, type: "success" });
    advance();
  });
  // P105: the review dialog of this draft (the workspace's `C` opens it too, so its state is the actions').
  const review = actions.review?.id === d.id ? actions.review.mode : null;
  const closeReview = () => {
    if (flow.step === "reading" || flow.step === "sending") return;
    actions.closeReview();
    close();
  };
  const reread = () => {
    under.seen();
    void mailRead.refetch();
  };
  const on: Handlers = {
    send: () => actions.openReview(d, "send"),
    check: () => actions.openReview(d, "check"),
    uncheck: () => actions.setChecked(d, false),
    skip: (reason) => {
      advance();
      actions.setStatus(d, "skipped", { reason });
    },
    done: () => {
      advance();
      actions.setStatus(d, "done");
    },
    hold: () => actions.setStatus(d, "hold"),
    resume: () => actions.setStatus(d, "ready"),
    reopen: () => actions.setStatus(d, "ready"),
    cancelSend: () => cancel.mutate(),
    copySubject: () => {
      void copyText(d.subject).then((ok) => say(ok ? "Copied. In Mail press Option+Command+F and paste." : "The clipboard was blocked: copy the subject from the draft."));
    },
    history: () => navigate(dest("log.list", { client: d.clientId })),
  };
  // Shift+Enter opens the review dialog; only the dialog's Send sends (a press right after it opens does not count).
  const sendable = state === "checks_open" || state === "unread" || state === "acknowledged" || state === "failed";
  useSendKey(sendable && review === null ? on.send : null);
  const editDirty = editing !== null && editValue !== editing.text;
  const editChangedUnder = editing !== null && mail?.found === true && mail.hash !== editing.hash;
  const startEditing = (value: { text: string; hash: string }) => {
    editSave.reset();
    setEditSaved(false);
    setEditing(value);
    setEditValue(value.text);
  };
  const cancelEditing = () => {
    if (!editSave.isPending) setEditing(null);
  };
  const submitEditing = () => {
    if (editing === null || !editDirty || editSave.isPending || !editValue.trim() || editChangedUnder) return;
    editSave.mutate({ text: editValue, hash: editing.hash }, { onSuccess: () => { setEditing(null); setEditSaved(true); } });
  };
  const content = (
    <div className="flex min-w-0 flex-1 flex-col gap-3">
        <CardHeader actions={actions} contact={contact} d={d} now={now} ready={state === "acknowledged"} />
        {d.reason && (
          <p className="break-words text-sm">
            <span className="text-muted-foreground">Why this email: </span>
            {d.reason}
          </p>
        )}
        {d.skipReason && <p className="text-sm">Skipped: {d.skipReason}</p>}
        <BasedOnStrip d={d} />
        {under.changed && (
          <div className="flex min-h-11 items-center gap-3 rounded-md border px-3 py-2 text-sm lg:min-h-0" role="status">
            <span className="min-w-0 flex-1">Changed by the agent since you opened it.</span>
            <ActionButton onClick={reread} size="s">
              Reload
            </ActionButton>
          </div>
        )}
        {mailError !== null && <LoadFailed error={mailRead.error} onRetry={() => void mailRead.refetch()} retrying={mailRead.isFetching} what="the draft from Mail" />}
        <CheckList d={d} onOpen={on.send} {...(mail?.found ? { results: mail.safetyResults } : {})} />
        <DraftBlock
          actions={actions}
          d={d}
          editing={editing}
          editor={editing !== null ? <DraftEditor disabled={editSave.isPending} onCancel={cancelEditing} onChange={setEditValue} onSubmit={submitEditing} value={editValue} /> : null}
          {...(mail ? { live: mail } : {})}
          onEdit={startEditing}
          onRead={() => void mailRead.refetch()}
          project={project}
          reading={mailRead.isFetching}
        />
    </div>
  );
  const actionBarContent = (
    <ConversationComposerFooter feedback={
      editSaved ? <p className="text-muted-foreground text-sm" role="status">Draft saved in Mail. It remains unsent.</p> : undefined
    }>
      <div className="min-w-0 flex-1">
        {editing !== null ? (
          <DraftEditorFooter changedUnder={editChangedUnder} dirty={editDirty} error={editSave.isError ? sentence(editSave.error) : null} onCancel={cancelEditing} onSubmit={submitEditing} pending={editSave.isPending} value={editValue} />
        ) : (
          <ActionBar actions={actions} context={{ name: first, hasMailLink: hasMailLink(d), hasDraftLink: draftLink !== null }} d={d} draftLink={draftLink} on={on} state={state} />
        )}
      </div>
      <MailSendDialog changedUnder={under.changed} d={d} flow={flow} go={go} mail={mail} mode={review ?? "send"} name={first} onClose={closeReview} onReread={reread} open={review !== null} project={project} readError={mailError} resetFlow={close} />
    </ConversationComposerFooter>
  );
  const actionBar = embedded ? actionBarContent : <div className="shrink-0 border-t bg-background px-4 py-3 lg:px-6">{actionBarContent}</div>;
  // The open draft carries its ref too (P72): beside the terminal dock the list pane is hidden, and a pointer at `draft:<id>`
  // that Show opened must still find a row to ring.
  // The article is the draft with its actions (Send, Skip, More actions): the composer pins the actions under the body, inside it.
  if (embedded) {
    return (
      <article aria-label={`Draft for ${d.client.name}`} className="flex h-full min-h-0 min-w-0 flex-1 flex-col" {...agentRef(refOf("draft", d.id))}>
        <ConversationComposer ariaLabel="Mail draft and actions" footer={actionBar} notice={composerNotice}>
          {content}
        </ConversationComposer>
      </article>
    );
  }
  return (
    <article aria-label={`Draft for ${d.client.name}`} className="flex min-h-0 min-w-0 flex-1 flex-col" {...agentRef(refOf("draft", d.id))}>
      {content}
      {actionBar}
    </article>
  );
}
