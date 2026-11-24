"use client";

import { useId } from "react";
import { AUTOPILOT_OFF_WORDS } from "@hub/config/autopilot";
import type { AutopilotChatDto, AutopilotProjectDto } from "@hub/contract/autopilot";
import { SettingSwitch } from "@hub/ui/product/field";
import { sentence } from "@/lib/api/client";
import { useProjectAutopilot, useSetProjectAutopilot } from "@/lib/data/messengers";
import { formatTime } from "@/lib/format";

// P139 A5 (verdict 4): the per-chat autopilot switch, the stock Switch through `SettingSwitch`, in the conversation header and on
// the chat's rules line, and its state line under the header's facts. Only linked chats have one (decision 0049 point 9).

/** Why the switch cannot be turned on now, in words, or null. A chat already on can always be switched off. */
export function blockedWhy(p: Pick<AutopilotProjectDto, "instanceOn" | "mode">, c: AutopilotChatDto): string | null {
  if (!p.instanceOn) return AUTOPILOT_OFF_WORDS.instance;
  if (p.mode === "off") return AUTOPILOT_OFF_WORDS.project;
  if (c.off === "reply_mode" || c.off === "stopped") return AUTOPILOT_OFF_WORDS[c.off];
  return null;
}

/** "Autopilot · answering", "Autopilot · dry run", "Autopilot · paused: <why>, 14:02", "Autopilot · off: <why>"; null when the chat is not switched on. */
export function autopilotLine(c: AutopilotChatDto): string | null {
  if (!c.listed) return null;
  switch (c.state) {
    case "on":
      return "Autopilot · answering";
    case "dry_run":
      return "Autopilot · dry run";
    case "paused":
      return `Autopilot · paused: ${c.pausedWords ?? "paused"}${c.note ? ` (${c.note})` : ""}${c.pausedAt ? `, ${formatTime(c.pausedAt)}` : ""}`;
    case "off":
      return `Autopilot · off: ${c.off ? AUTOPILOT_OFF_WORDS[c.off] : "off"}`;
    default:
      return null;
  }
}

/** The short mark of the chat list: a word, not only a colour (accessibility rules). */
export function autopilotMark(c: AutopilotChatDto | undefined): string | null {
  if (!c?.listed) return null;
  if (c.state === "paused") return "Autopilot paused";
  if (c.state === "on" || c.state === "dry_run") return "Autopilot";
  return null;
}

/** The chat's autopilot as the project's view has it (one query per project, shared by every row). */
export function useChatAutopilot(project: string, chatId: number): { p: AutopilotProjectDto; c: AutopilotChatDto } | null {
  const q = useProjectAutopilot(project);
  const c = q.data?.chats.find((x) => x.chat === chatId);
  return q.data && c ? { p: q.data, c } : null;
}

export function AutopilotChatSwitch({ project, chatId, compact = false }: { project: string; chatId: number; compact?: boolean }) {
  const ap = useChatAutopilot(project, chatId);
  const set = useSetProjectAutopilot(project);
  const id = useId();
  if (!ap) return null;
  const { p, c } = ap;
  // A paused chat reads as off: switching it on again is how the owner lifts the pause (verdict 15).
  const checked = c.listed && c.state !== "paused";
  const why = checked ? null : blockedWhy(p, c);
  return (
    <span className="inline-flex min-w-0 items-center gap-2" data-testid="autopilot-chat-switch">
      <SettingSwitch checked={checked} describedBy={why ? `${id}-why` : undefined} disabled={why !== null} error={set.isError ? sentence(set.error) : null} labelledBy={id} onChange={(on) => set.mutate({ kind: "chat", chat: chatId, on })} pending={set.isPending} />
      <span className="text-sm" id={id}>
        Autopilot
      </span>
      {why && !compact && (
        <span className="text-muted-foreground text-xs" id={`${id}-why`}>
          {why}
        </span>
      )}
      {why && compact && (
        <span className="sr-only" id={`${id}-why`}>
          {why}
        </span>
      )}
    </span>
  );
}

/** The state line under the conversation header's facts, when the chat is switched on. */
export function AutopilotStateLine({ project, chatId }: { project: string; chatId: number }) {
  const ap = useChatAutopilot(project, chatId);
  const line = ap ? autopilotLine(ap.c) : null;
  return line ? <span data-testid="autopilot-state">{line}</span> : null;
}
