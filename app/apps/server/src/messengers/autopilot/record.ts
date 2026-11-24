import type { AutopilotTodayDto } from "@hub/contract/autopilot";
import { AUTOPILOT_ACCOUNT_SHARE, AUTOPILOT_MODEL, AUTOPILOT_REASON_WORDS, AUTOPILOT_SEND_ACTOR, AUTOPILOT_SKILL, autopilotChatKey, type AutopilotChannel } from "@hub/config/autopilot";
import type { Repos } from "@hub/db";
import type { AutopilotLedger } from "./budget";
import { turnKey, type Outcome } from "./scheduler";

// The autopilot's durable record (decision 0048 point 9, P139 A6; verdict 22): one Activity line per turn, a run of trigger
// `autopilot` with one event, written after the turn's ops line. The same rows refill the budgets after a restart (`seedLedger`,
// with autopilot's sends from `send_log`) and give Overview its counts, so there is one record of a turn, not two.

const DAY_MS = 24 * 3_600_000;

/** What a turn's event carries in its detail (besides Activity's `action`, `reason` and `skill`). */
export interface TurnDetail {
  /** `<channel>:<chatId>`: the chat's key in the project's `autopilot.chats`. */
  chat: string;
  /** The `messenger_chats` row id. */
  chatRow: number;
  outcome: Outcome["outcome"];
  reason: Outcome["reason"];
  note: string | null;
  /** The turn ran (it counted against the turn budgets): it got past the precheck and the budgets. */
  ran: boolean;
  actionId: string;
  draftId: number | null;
  sendId: number | null;
  ms: number | null;
  messages: number;
}

/** The Activity action of an outcome: a hand-back or a refusal is the owner's (Needs you); a skip is a skip; a send and a dry run show as their send row and their draft. */
const ACTION: Record<Outcome["outcome"], string> = { handed_back: "escalated", refused: "escalated", skipped: "skipped", sent: "autopilot_sent", dry_run: "autopilot_dry_run" };
const STATUS: Record<Outcome["outcome"], "ok" | "needs_human" | "failed"> = { handed_back: "needs_human", refused: "failed", skipped: "ok", sent: "ok", dry_run: "ok" };
const OUTCOME_WORDS: Record<Outcome["outcome"], string> = { sent: "sent", handed_back: "handed back", refused: "refused", dry_run: "would send", skipped: "skipped" };

/** The Activity line's summary: "Autopilot · Anna · sent · 0.03 $ · 18 s". */
export function turnSummary(who: string, o: Pick<Outcome, "outcome" | "costUsd" | "ms">): string {
  const cost = o.costUsd != null ? `${o.costUsd.toFixed(2)} $` : null;
  const secs = o.ms != null ? `${Math.round(o.ms / 1000)} s` : null;
  return ["Autopilot", who, OUTCOME_WORDS[o.outcome], cost, secs].filter((x): x is string => x !== null).join(" · ");
}

/** Writes the turn's Activity run and event. */
export async function recordTurn(repos: Repos, o: Outcome, at: Date): Promise<void> {
  const { project } = o.chat;
  const row = await repos.messengers.chatById(project, o.chat.chat);
  const clientId = row ? await repos.messengers.clientByIdentifier(project, row.channel === "whatsapp" ? "whatsapp" : "telegram", row.chatId) : null;
  const client = clientId === null ? null : await repos.clients.get(project, clientId);
  const who = client?.name || row?.title || row?.profileName || `chat ${o.chat.chatId}`;
  const finishedAt = at.toISOString();
  const startedAt = new Date(at.getTime() - (o.ms ?? 0)).toISOString();
  const words = o.reason ? AUTOPILOT_REASON_WORDS[o.reason] : null;
  const why = [words, o.note].filter((x): x is string => !!x).join(": ") || null;
  const detail: TurnDetail = { chat: autopilotChatKey(o.chat.channel, o.chat.chatId), chatRow: o.chat.chat, outcome: o.outcome, reason: o.reason, note: o.note ?? null, ran: o.ms !== null, actionId: o.actionId, draftId: o.draftId ?? null, sendId: o.sendId ?? null, ms: o.ms, messages: o.messages };
  const runId = await repos.runs.start({ project, startedAt, finishedAt, trigger: "autopilot", skill: AUTOPILOT_SKILL, model: o.ms !== null ? AUTOPILOT_MODEL : null, status: STATUS[o.outcome], costUsd: o.costUsd ?? 0 });
  await repos.runs.addEvent({
    project,
    runId,
    at: finishedAt,
    kind: o.outcome === "handed_back" || o.outcome === "refused" ? "needs_human" : "decision",
    tool: null,
    summary: turnSummary(who, o),
    detail: JSON.stringify({ action: ACTION[o.outcome], reason: why, skill: AUTOPILOT_SKILL, autopilot: detail }),
    clientId,
  });
}

/** A turn event's autopilot detail, or null for another run's or a pruned one. */
export function turnDetailOf(text: string | null): TurnDetail | null {
  try {
    const v: unknown = JSON.parse(text ?? "null");
    const d = v && typeof v === "object" ? (Reflect.get(v, "autopilot") as unknown) : null;
    return d && typeof d === "object" && typeof Reflect.get(d, "chat") === "string" ? (d as TurnDetail) : null;
  } catch {
    return null;
  }
}

/** `<kind>:<chatId>` of a `send_log.to_addr` back to the chat's key, with the row's channel. */
const chatOfSend = (channel: string | null, to: string): string | null => {
  const i = to.indexOf(":");
  return channel && i > 0 ? autopilotChatKey(channel as AutopilotChannel, to.slice(i + 1)) : null;
};

/**
 * After a restart (A2 left it in memory): the last day's turns that ran and autopilot's sends go back into the ledger, so a
 * restart never refills a day's budget. Returns how many of each it read.
 */
export async function seedLedger(repos: Repos, ledger: AutopilotLedger, now: Date): Promise<{ turns: number; sends: number }> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  let turns = 0;
  for (const t of await repos.runs.autopilotTurns(since)) {
    const d = turnDetailOf(t.detail);
    if (!d?.ran) continue;
    const [channel, ...rest] = d.chat.split(":");
    ledger.recordTurn(turnKey({ project: t.project, channel: channel as AutopilotChannel, chatId: rest.join(":") }), Date.parse(t.startedAt));
    turns++;
  }
  let sends = 0;
  for (const s of await repos.sends.messengerSendsOf(AUTOPILOT_SEND_ACTOR, since)) {
    const key = chatOfSend(s.channel, s.toAddr);
    if (!key) continue;
    const [channel, ...rest] = key.split(":");
    ledger.recordSend(turnKey({ project: s.project, channel: channel as AutopilotChannel, chatId: rest.join(":") }), Date.parse(s.createdAt));
    sends++;
  }
  return { turns, sends };
}

/** P139 A6: a project's last 24 hours of turns (Overview, Settings ▸ Messengers ▸ Autopilot) and each chat's newest note. */
export async function todayOf(repos: Repos, project: string, now: Date): Promise<{ today: AutopilotTodayDto; notes: Map<number, string | null> }> {
  const since = new Date(now.getTime() - DAY_MS).toISOString();
  const today: AutopilotTodayDto = { sent: 0, handedBack: 0, refused: 0, dryRun: 0, lastTurnAt: null, accounts: [] };
  const notes = new Map<number, string | null>();
  for (const t of await repos.runs.autopilotTurns(since)) {
    if (t.project !== project) continue;
    const d = turnDetailOf(t.detail);
    if (!d) continue;
    if (d.outcome === "sent") today.sent++;
    else if (d.outcome === "handed_back") today.handedBack++;
    else if (d.outcome === "refused") today.refused++;
    else if (d.outcome === "dry_run") today.dryRun++;
    if (d.ran) today.lastTurnAt = t.startedAt;
    notes.set(d.chatRow, d.note);
  }
  // The share is per account and shared by every project on it: every project's autopilot sends count.
  const used = new Map<string, { channel: AutopilotChannel; account: string; used: number }>();
  for (const s of await repos.sends.messengerSendsOf(AUTOPILOT_SEND_ACTOR, since)) {
    if (!s.channel || s.channel === "mail" || !s.sender) continue;
    const k = `${s.channel}|${s.sender}`;
    const cur = used.get(k) ?? { channel: s.channel as AutopilotChannel, account: s.sender, used: 0 };
    cur.used++;
    used.set(k, cur);
  }
  today.accounts = [...used.values()].map((a) => ({ ...a, share: AUTOPILOT_ACCOUNT_SHARE }));
  return { today, notes };
}
