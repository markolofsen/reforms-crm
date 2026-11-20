import { useMutation, useQueryClient } from "@tanstack/react-query";
import { useId, useState } from "react";
import { CHAT_INSTRUCTION_MAX, NUDGE_DAYS_MAX, NUDGE_DAYS_MIN, REPLY_MODE_LABELS, REPLY_MODES } from "@hub/config/chat-rules";
import type { ChatRulesBody, MessengerChatDto } from "@hub/contract/messenger-panel";
import { cn } from "@hub/ui/cn";
import { Input } from "@hub/ui/input";
import { ActionButton } from "@hub/ui/product/action-button";
import { Switch } from "@hub/ui/switch";
import { Textarea } from "@hub/ui/textarea";
import { ToggleGroup, ToggleGroupItem } from "@hub/ui/toggle-group";
import { sentence } from "@/lib/api/client";
import { messengersApi } from "@/lib/api/messengers/panel";
import { keys } from "@/lib/cache/keys";
import { agentRef } from "@/lib/focus";
import { chatName, CHANNEL_LABEL } from "../labels";

/** The honest line of M-P (P71 plan): what the switch would do, and that nothing reads it yet. */
export const PREFILTER_NOTE = "Off by default. Only linked chats reach the Hub (a few hundred messages a day), so a cheap pre-read saves little; nothing reads this switch until the pre-analysis is built (P71 M-P).";

const LABEL = "text-sm";
const HINT = "text-muted-foreground text-xs";

/** One field that saves when it is left or Enter is pressed, and only when its value changed. */
function CommitInput({ id, value, onCommit, disabled, ...rest }: { id: string; value: string; onCommit: (v: string) => void; disabled: boolean; inputMode?: "numeric"; placeholder?: string; className?: string }) {
  const [text, setText] = useState(value);
  const commit = () => {
    if (text.trim() !== value) onCommit(text.trim());
  };
  return <Input {...rest} className={cn("control-m", rest.className)} disabled={disabled} id={id} onBlur={commit} onChange={(e) => setText(e.target.value)} onKeyDown={(e) => e.key === "Enter" && commit()} value={text} />;
}

/**
 * One linked chat's rules (P71 M2b), every one in view and written by the owner only, through the gated rules route: when the
 * agent may draft (`reply_mode`; no automatic value: Send stays his click), whether it may propose a follow-up and after how many
 * quiet days, the reply language, the pre-analysis switch with its honest note, and his own instruction (at most 4 000
 * characters), saved by its button. Its ref is `chat:<id>` (P72).
 */
export function ChatRules({ project, c }: { project: string; c: MessengerChatDto }) {
  const qc = useQueryClient();
  const save = useMutation({ mutationFn: (patch: ChatRulesBody) => messengersApi.setRules(project, c.id, patch), onSettled: () => qc.invalidateQueries({ queryKey: keys.messengerChatsOf(project) }) });
  const ids = { mode: useId(), nudge: useId(), days: useId(), lang: useId(), pre: useId(), text: useId() };
  const [instruction, setInstruction] = useState(c.rules.instruction ?? "");
  const r = c.rules;
  const busy = save.isPending;
  const name = chatName(c);
  return (
    <li aria-label={`Rules for ${name}`} className="flex flex-col gap-3 py-3" data-chat-rules={c.id} {...agentRef(`chat:${c.id}`)}>
      <div className="flex flex-wrap items-baseline gap-2">
        <span className="font-medium text-sm" data-agent-label="">
          {name}
        </span>
        <span className={HINT}>
          {CHANNEL_LABEL[c.channel]}
          {c.title && c.title !== name ? ` · ${c.title}` : ""}
        </span>
      </div>
      <div className="flex flex-wrap items-center gap-x-6 gap-y-3">
        <div className="flex flex-col gap-1">
          <span className={LABEL} id={ids.mode}>
            The agent
          </span>
          <ToggleGroup aria-labelledby={ids.mode} onValueChange={(v) => { const m = REPLY_MODES.find((x) => x === v[0]); if (m && m !== r.replyMode) save.mutate({ replyMode: m }); }} size="sm" value={[r.replyMode]} variant="outline">
            {REPLY_MODES.map((m) => (
              <ToggleGroupItem className="min-h-(--control-s)" disabled={busy} key={m} value={m}>
                {REPLY_MODE_LABELS[m]}
              </ToggleGroupItem>
            ))}
          </ToggleGroup>
        </div>
        <div className="flex items-center gap-2">
          {/* The label is the touch target: 44px high below 1024px, the switch alone is smaller. */}
          <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0">
            <Switch aria-labelledby={ids.nudge} checked={r.mayNudge} disabled={busy} onCheckedChange={(v) => save.mutate({ mayNudge: v })} />
          </label>
          <span className={LABEL} id={ids.nudge}>
            May propose a follow-up
          </span>
          {r.mayNudge && (
            <>
              <label className={HINT} htmlFor={ids.days}>
                after quiet days ({NUDGE_DAYS_MIN} to {NUDGE_DAYS_MAX})
              </label>
              <CommitInput className="w-16" disabled={busy} id={ids.days} inputMode="numeric" key={r.nudgeAfterDays} onCommit={(v) => /^\d+$/.test(v) && save.mutate({ nudgeAfterDays: Number(v) })} value={String(r.nudgeAfterDays)} />
            </>
          )}
        </div>
        <div className="flex items-center gap-2">
          <label className={LABEL} htmlFor={ids.lang}>
            Reply language
          </label>
          <CommitInput className="w-28" disabled={busy} id={ids.lang} key={r.language ?? ""} onCommit={(v) => save.mutate({ language: v || null })} placeholder="the client's" value={r.language ?? ""} />
        </div>
      </div>
      <div className="flex items-start gap-2">
        <label className="flex min-h-11 cursor-pointer items-center lg:min-h-0">
          <Switch aria-describedby={`${ids.pre}-note`} aria-labelledby={ids.pre} checked={r.prefilter} disabled={busy} onCheckedChange={(v) => save.mutate({ prefilter: v })} />
        </label>
        <div className="flex flex-col gap-0.5">
          <span className={LABEL} id={ids.pre}>
            Pre-analysis of this chat
          </span>
          <span className={cn("measure", HINT)} id={`${ids.pre}-note`}>
            {PREFILTER_NOTE}
          </span>
        </div>
      </div>
      <div className="flex flex-col gap-1.5">
        <label className={LABEL} htmlFor={ids.text}>
          Your instruction for this chat
        </label>
        <Textarea className="measure font-sans" disabled={busy} id={ids.text} maxLength={CHAT_INSTRUCTION_MAX} onChange={(e) => setInstruction(e.target.value)} placeholder="How the agent should answer here, in your words." value={instruction} />
        <div className="flex items-center gap-2">
          <ActionButton disabled={busy || instruction.trim() === (r.instruction ?? "")} onClick={() => save.mutate({ instruction: instruction.trim() || null })} size="s" variant="secondary">
            Save instruction
          </ActionButton>
          <span className={cn("tabular-nums", HINT)}>
            {instruction.length} of {CHAT_INSTRUCTION_MAX}
          </span>
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
