import { AUTOPILOT_ACCOUNT_SHARE, AUTOPILOT_DRAFT_AUTHOR, AUTOPILOT_READ_DELAY_MS, AUTOPILOT_SEND_ACTOR, AUTOPILOT_TYPING } from "@hub/config/autopilot";
import type { Repos } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";
import { applyMessenger, type MessengerDoorDeps } from "@hub/messengers/door";
import { inQuietHours } from "@hub/projects/autopilot";
import type { MessengerTyping } from "../../send/messenger-senders";
import type { AutopilotSwitches } from "./switches";
import type { AutopilotDeliver } from "./turn";

// The autopilot's send (decision 0048 points 3, 6, 8; P139 A4; verdicts 11-13). Only mechanical limits, never a check of what
// the model wrote (the owner, 2026-11-24: the `autopilot-reply` skill's rules decide what may go out):
//   1. quiet hours: the draft waits, the chat hands back;
//   2. the account's send slot (the door's 20 s spacing as a schedule, the owner's own sends included);
//   3. the read delay, then the typing status for a length-based time (best-effort);
//   4. the re-checks right before the door: every switch still on in mode `on`, not paused, the newest message still the
//      client's, and the draft still autopilot's, waiting, with the text this turn wrote;
//   5. `applyMessenger` with the `autopilot` authority: the same five stages as the owner's Send, its audit row held to
//      autopilot's share of the account (20 of the 30).
// Every wait rejects when the turn is aborted (a newer client message, the owner's own message, a switch); from `sending()`
// on nothing aborts it. A park the adapter reports parks the account in the door (`senders.failed`), as for his own Send.

export interface DeliverDeps {
  repos: Repos;
  switches: AutopilotSwitches;
  /** The door's deps, or null while no messenger account is connected. */
  door: () => MessengerDoorDeps | null;
  typing?: MessengerTyping;
  now?: () => Date;
}

const log = ops("autopilot");

/** Verdict 13: how long the typing status shows for `text`: 1.5 s + 35 ms a character, at most 12 s, ±20 %. */
export function typingMs(text: string, random: () => number): number {
  const base = Math.min(AUTOPILOT_TYPING.baseMs + AUTOPILOT_TYPING.perCharMs * text.length, AUTOPILOT_TYPING.maxMs);
  return Math.round(base * (1 - AUTOPILOT_TYPING.jitter + 2 * AUTOPILOT_TYPING.jitter * random()));
}

export const readDelayMs = (random: () => number): number => Math.round(AUTOPILOT_READ_DELAY_MS.min + (AUTOPILOT_READ_DELAY_MS.max - AUTOPILOT_READ_DELAY_MS.min) * random());

export function autopilotDeliver(d: DeliverDeps): AutopilotDeliver {
  const now = d.now ?? (() => new Date());
  return async (turn, draft) => {
    const { chat } = turn;
    if (inQuietHours(d.switches.project(chat.project).policy.quiet, now())) return { outcome: "handed_back", reason: "quiet_hours" };
    const door = d.door();
    if (!door) return { outcome: "refused", reason: "door", note: "no messenger account is connected" };
    const row = await d.repos.messengers.chatById(chat.project, chat.chat);
    if (!row?.account) return { outcome: "refused", reason: "door", note: "no stored message tells which account reads this chat" };
    // Verdict 11: autopilot's share of the account; the audit row re-checks it in its own write.
    const since = new Date(now().getTime() - 24 * 3_600_000).toISOString();
    const mine = (await d.repos.sends.messengerSendsOf(AUTOPILOT_SEND_ACTOR, since)).filter((s) => s.channel === row.channel && s.sender === row.account).length;
    if (mine >= AUTOPILOT_ACCOUNT_SHARE) return { outcome: "handed_back", reason: "account_budget" };
    const usage = await d.repos.sends.messengerUsage(row.channel, row.account, now().toISOString());
    await turn.sendSlot(row.account, usage.lastAttemptAt ? Date.parse(usage.lastAttemptAt) : null);
    await turn.wait(readDelayMs(turn.random));
    const typed = await d.typing?.typing(row.channel, row.account, row.chatId).catch((e: unknown) => {
      log.warn("the typing status could not be shown; the reply goes anyway", { project: chat.project, chat: chat.chat, channel: row.channel, ...errFields(e) });
      return false;
    });
    if (typed) await turn.wait(typingMs(draft.text, turn.random));
    // The last look before the door: the switches, the pause, the newest message and the draft, read fresh.
    const c = await d.switches.chat(chat.project, chat);
    if (!c || c.state.state === "off") return { outcome: "skipped", reason: "switched_off" };
    if (c.state.state === "paused") return { outcome: "skipped", reason: "paused" };
    if (c.state.state !== "on") return { outcome: "dry_run", reason: null };
    const [newest] = await d.repos.messengers.messagesOf(chat.project, [{ channel: row.channel, chatId: row.chatId }], { limit: 1 });
    if (!newest || newest.direction !== "in") return { outcome: "skipped", reason: "not_inbound" };
    const stored = await d.repos.messengers.getDraft(chat.project, draft.draftId);
    if (!stored || stored.status !== "draft" || stored.createdBy !== AUTOPILOT_DRAFT_AUTHOR || stored.text.trim() !== draft.text) return { outcome: "skipped", reason: "your_draft" };
    turn.sending();
    const r = await applyMessenger(door, chat.project, draft.draftId, { chatId: row.chatId, text: draft.text }, { kind: "autopilot", actor: AUTOPILOT_SEND_ACTOR, turn: turn.actionId });
    if (!r) return { outcome: "refused", reason: "door", note: "the draft is gone" };
    if ("refused" in r) return { outcome: "refused", reason: "door", note: r.refused.join("; ") };
    if ("failed" in r) return { outcome: "refused", reason: "door", note: `the send failed: ${r.failed}`, sendId: r.sendId };
    return { outcome: "sent", reason: null, sendId: r.sendId };
  };
}
