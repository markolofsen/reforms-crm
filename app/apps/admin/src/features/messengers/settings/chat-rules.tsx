import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { CHAT_INSTRUCTION_MAX, NUDGE_DAYS_MAX, NUDGE_DAYS_MIN, REPLY_MODE_LABELS, REPLY_MODES } from "@hub/config/chat-rules";
import type { ChatRulesBody, MessengerChatDto, PreanalysisDto } from "@hub/contract/messenger-panel";
import { cn } from "@hub/ui/cn";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { MarkdownEditor } from "@hub/ui/product/markdown-editor";
import { LanguagePicker } from "@hub/ui/product/language-picker";
import { Switch } from "@hub/ui/switch";
import { ToggleGroup, ToggleGroupItem } from "@hub/ui/toggle-group";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { messengerMutationKeys } from "@/lib/cache/keys";
import { agentRef } from "@/lib/focus";
import { chatName, CHANNEL_LABEL, prefilterNote, triageLine } from "../labels";

const LABEL = "text-sm";
const HINT = "text-muted-foreground text-xs";

/** One field that saves when it is left or Enter is pressed, and only when its value changed. */
function CommitInput({ id, value, onCommit, disabled, ariaLabel, ...rest }: { id: string; value: string; onCommit: (v: string) => boolean | void; disabled: boolean; ariaLabel?: string; inputMode?: "numeric"; placeholder?: string; list?: string; className?: string }) {
  const [text, setText] = useState(value);
  const commit = () => {
    const next = text.trim();
    if (next !== value && onCommit(next) === false) setText(value);
  };
  return <Input {...rest} aria-label={ariaLabel} className={cn("control-m", rest.className)} disabled={disabled} id={id} onBlur={commit} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} value={text} />;
}

/**
 * One linked chat's rules (P71 M2b), every one in view and written by the owner only, through the gated rules route: when the
 * agent may draft (`reply_mode`; no automatic value: Send stays his click), whether it may propose a follow-up and after how many
 * quiet days, the reply language, the pre-analysis switch with what it does (or "needs an OpenRouter key") and the chat's counts
 * by reason, and his own instruction (at most 4 000
 * characters), saved by its button. Its ref is `chat:<id>` (P72).
 */
export function ChatRules({ project, c, preanalysis }: { project: string; c: MessengerChatDto; preanalysis: PreanalysisDto }) {
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: (patch: ChatRulesBody) => messengersApi.setRules(project, c.id, patch), onSettled: () => Promise.all(messengerMutationKeys(project, c.id).map((queryKey) => qc.invalidateQueries({ queryKey }))) });
  const ids = { mode: useId(), nudge: useId(), days: useId(), lang: useId(), pre: useId(), text: useId() };
  const [instruction, setInstruction] = useState(c.rules.instruction ?? "");
  const r = c.rules;
  const busy = save.isPending;
  const name = chatName(c);
  const commitInstruction = () => {
    const next = instruction.trim();
    if (busy || next === (r.instruction ?? "")) return;
    save.mutate({ instruction: next || null });
  };
  return (
    <li aria-label={`Rules for ${name}`} className="flex flex-col gap-2.5 py-2.5" data-chat-rules={c.id} {...agentRef(`chat:${c.id}`)}>
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5">
        <span className="min-w-0 truncate font-medium text-sm" data-agent-label="">
          {name}
        </span>
        <span className={cn("min-w-0 truncate", HINT)}>
          {CHANNEL_LABEL[c.channel]}
          {c.title && c.title !== name ? ` · ${c.title}` : ""}
        </span>
      </div>
      <div className="flex min-w-0 flex-col gap-2.5">
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className={LABEL} id={ids.mode}>Reply mode</legend>
          <ToggleGroup aria-labelledby={ids.mode} onValueChange={(v) => { const m = REPLY_MODES.find((x) => x === v[0]); if (m && m !== r.replyMode) save.mutate({ replyMode: m }); }} size="sm" value={[r.replyMode]} variant="outline">
            {REPLY_MODES.map((m) => <ToggleGroupItem className="min-h-(--control-s)" disabled={busy} key={m} value={m}>{REPLY_MODE_LABELS[m]}</ToggleGroupItem>)}
          </ToggleGroup>
        </fieldset>
        <div className="grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2" data-testid="chat-rules-options">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            {/* The label is the touch target: 44px high below 1024px, the switch alone is smaller. */}
            <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0">
              <Switch aria-labelledby={ids.nudge} checked={r.mayNudge} disabled={busy} onCheckedChange={(v) => save.mutate({ mayNudge: v })} />
            </label>
            <span className={cn("min-w-0", LABEL)} id={ids.nudge}>
              May propose a follow-up
            </span>
            {r.mayNudge && (
              <span className="flex items-center gap-1.5">
                <label className={HINT} htmlFor={ids.days}>
                  after quiet days
                </label>
                <CommitInput ariaLabel={`Quiet days, from ${NUDGE_DAYS_MIN} to ${NUDGE_DAYS_MAX}`} className="w-16 shrink-0" disabled={busy} id={ids.days} inputMode="numeric" key={r.nudgeAfterDays} onCommit={(v) => {
                  if (!/^\d+$/.test(v)) return false;
                  const days = Number(v);
                  if (days < NUDGE_DAYS_MIN || days > NUDGE_DAYS_MAX) return false;
                  save.mutate({ nudgeAfterDays: days });
                  return true;
                }} value={String(r.nudgeAfterDays)} />
                <span className={HINT}>({NUDGE_DAYS_MIN}–{NUDGE_DAYS_MAX})</span>
              </span>
            )}
          </div>
          <div className="flex min-w-0 flex-wrap items-center justify-between gap-x-2 gap-y-1">
            <div className="flex min-w-0 flex-col gap-0.5">
              <label className={LABEL} htmlFor={ids.lang}>
                Language
              </label>
              {r.language === null && <span className={cn("min-w-0", HINT)}>Uses the client&apos;s language.</span>}
            </div>
            <div className="shrink-0">
              <LanguagePicker ariaLabel="Language override" disabled={busy} id={ids.lang} includeClientDefault onChange={(language) => save.mutate({ language })} value={r.language ?? null} />
            </div>
          </div>
        </div>
        <div className="flex items-start gap-2 border-t pt-3">
          <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0">
            <Switch aria-describedby={`${ids.pre}-note`} aria-labelledby={ids.pre} checked={r.prefilter} disabled={busy} onCheckedChange={(v) => save.mutate({ prefilter: v })} />
          </label>
          <div className="flex flex-col gap-0.5">
            <span className={LABEL} id={ids.pre}>
              Pre-analysis
            </span>
            <span className={cn("measure", HINT)} id={`${ids.pre}-note`}>
              {prefilterNote(preanalysis)}
            </span>
            {triageLine(c) && <span className={cn("measure", HINT)}>{triageLine(c)}</span>}
          </div>
        </div>
        <div className="flex flex-col gap-1.5 border-t pt-3">
          <label className={LABEL} htmlFor={ids.text}>
            <span aria-hidden="true">Chat instruction</span>
            <span className="sr-only">Your instruction for this chat</span>
          </label>
          <MarkdownEditor ariaLabel="Your instruction for this chat" disabled={busy} id={ids.text} maxLength={CHAT_INSTRUCTION_MAX} onChange={setInstruction} onSubmit={commitInstruction} placeholder="How the agent should answer here, in your words." showMeta={false} value={instruction} />
          <div className="flex items-center gap-2">
            <ActionButton disabled={busy || instruction.trim() === (r.instruction ?? "")} onClick={commitInstruction} size="s" variant="secondary">
              Save instruction
            </ActionButton>
            <span className={cn("tabular-nums", HINT)}>
              {instruction.length} of {CHAT_INSTRUCTION_MAX}
            </span>
          </div>
        </div>
      </div>
      {save.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(save.error)}
        </p>
      )}
    </li>
  );
}
