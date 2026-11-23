import { useId, useState } from "react";
import { CHAT_INSTRUCTION_MAX, NUDGE_DAYS_MAX, NUDGE_DAYS_MIN, REPLY_MODE_LABELS, REPLY_MODES } from "@hub/config/chat-rules";
import type { MessengerChatDto, PreanalysisDto } from "@hub/contract/messenger-panel";
import { cn } from "@hub/ui/cn";
import { CommitField, SettingSwitch } from "@hub/ui/product/field";
import { ActionButton } from "@hub/ui/product/action-button";
import { MarkdownEditor } from "@hub/ui/product/composer/markdown-editor";
import { LanguagePicker } from "@hub/ui/product/language-picker";
import { ToggleGroup, ToggleGroupItem } from "@hub/ui/toggle-group";
import { sentence } from "@/lib/api/client";
import { useSaveChatRules } from "@/lib/data/messengers";
import { agentRef } from "@/lib/focus";
import { chatName, CHANNEL_LABEL, prefilterNote, triageLine } from "../labels";

const LABEL = "text-sm";
const HINT = "text-muted-foreground text-xs";

/**
 * One linked chat's rules (P71 M2b) as one line with its values (P128 X5: "<name> · Telegram · Draft replies · no instruction ·
 * Edit"); Edit opens them in place. Written by the owner only, through the gated rules route: when the
 * agent may draft (`reply_mode`; no automatic value: Send stays his click), whether it may propose a follow-up and after how many
 * quiet days, the reply language, the pre-analysis switch with what it does (or "needs an OpenRouter key") and the chat's counts
 * by reason, and his own instruction (at most 4 000
 * characters), saved by its button. Its ref is `chat:<id>` (P72).
 */
export function ChatRules({ project, c, preanalysis }: { project: string; c: MessengerChatDto; preanalysis: PreanalysisDto }) {
  const save = useSaveChatRules(project, c.id);
  const ids = { mode: useId(), nudge: useId(), days: useId(), lang: useId(), pre: useId(), text: useId() };
  const [instruction, setInstruction] = useState(c.rules.instruction ?? "");
  // P128 X5: one line per chat with its values in view; Edit opens the rules in place (an action's own form, admin-principles 9).
  const [editing, setEditing] = useState(false);
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
      <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-0.5" data-testid="chat-rules-line">
        <span className="min-w-0 truncate font-medium text-sm" data-agent-label="">
          {name}
        </span>
        <span className={cn("min-w-0 flex-1 truncate", HINT)}>
          {CHANNEL_LABEL[c.channel]} · {REPLY_MODE_LABELS[r.replyMode]} · {r.instruction ? "own instruction" : "no instruction"}
          {r.mayNudge ? ` · follow-up after ${r.nudgeAfterDays} days` : ""}
          {r.language ? ` · ${r.language}` : ""}
        </span>
        <ActionButton aria-expanded={editing} onClick={() => setEditing((v) => !v)} size="s" variant="quiet">
          {editing ? "Done" : "Edit"}
          <span className="sr-only"> the rules for {name}</span>
        </ActionButton>
      </div>
      {editing && (
      <div className="flex min-w-0 flex-col gap-2.5">
        <fieldset className="flex min-w-0 flex-col gap-1">
          <legend className={LABEL} id={ids.mode}>Reply mode</legend>
          <ToggleGroup aria-labelledby={ids.mode} onValueChange={(v) => { const m = REPLY_MODES.find((x) => x === v[0]); if (m && m !== r.replyMode) save.mutate({ replyMode: m }); }} size="sm" value={[r.replyMode]} variant="outline">
            {REPLY_MODES.map((m) => <ToggleGroupItem className="min-h-(--control-s)" disabled={busy} key={m} value={m}>{REPLY_MODE_LABELS[m]}</ToggleGroupItem>)}
          </ToggleGroup>
        </fieldset>
        <div className="grid gap-x-6 gap-y-3 border-t pt-3 sm:grid-cols-2" data-testid="chat-rules-options">
          <div className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1">
            <SettingSwitch checked={r.mayNudge} labelledBy={ids.nudge} onChange={(v) => save.mutate({ mayNudge: v })} pending={busy} />
            <span className={cn("min-w-0", LABEL)} id={ids.nudge}>
              May propose a follow-up
            </span>
            {r.mayNudge && (
              <span className="flex items-center gap-1.5">
                <label className={HINT} htmlFor={ids.days}>
                  after quiet days
                </label>
                <CommitField className="w-16 shrink-0" id={ids.days} label={`Quiet days, from ${NUDGE_DAYS_MIN} to ${NUDGE_DAYS_MAX}`} pending={busy} inputMode="numeric" key={r.nudgeAfterDays} onCommit={(v) => {
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
          <SettingSwitch checked={r.prefilter} describedBy={`${ids.pre}-note`} labelledBy={ids.pre} onChange={(v) => save.mutate({ prefilter: v })} pending={busy} />
          <div className="flex flex-col gap-0.5">
            <span className={LABEL} id={ids.pre}>
              Pre-analysis
            </span>
            <span className={cn("measure", HINT)} id={`${ids.pre}-note`}>
              {preanalysis.state === "no_key" ? "Off: needs an OpenRouter key (see above the chats)." : prefilterNote(preanalysis)}
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
      )}
      {save.isError && (
        <p className="text-destructive-foreground text-sm" role="alert">
          {sentence(save.error)}
        </p>
      )}
    </li>
  );
}
