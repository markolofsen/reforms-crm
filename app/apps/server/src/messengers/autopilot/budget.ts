import {
  AUTOPILOT_CHAT_SENDS_PER_10_MIN,
  AUTOPILOT_CHAT_SENDS_PER_DAY,
  AUTOPILOT_CHAT_TURNS_PER_DAY,
  AUTOPILOT_INSTANCE_TURNS_PER_DAY,
  AUTOPILOT_SPACING_JITTER_MS,
  type AutopilotReason,
} from "@hub/config/autopilot";
import { MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";

// The autopilot's budgets and its send spacing (P139 A2; verdicts 10, 11, 19; A0 section 6). Pure: every time is a number of
// milliseconds handed in, so the scheduler's tests run on a fake clock. A day is the last 24 hours, not the calendar day, so a
// budget never refills at midnight in the middle of a burst.

const DAY_MS = 24 * 3_600_000;
const TEN_MIN_MS = 10 * 60_000;

/**
 * Where the counts come from. The scheduler records into it and reads it before each turn. The in-memory one below is A2's;
 * A4 seeds the sends from `send_log` (`actor: autopilot`) and A6 backs the turns with their Activity rows, so a restart does
 * not refill a day's budget.
 */
export interface AutopilotLedger {
  /** Turns started since `since` in one chat (its key), or on this Mac (`null`). */
  turnsSince(chat: string | null, since: number): number;
  /** Autopilot sends since `since` in one chat. */
  sendsSince(chat: string, since: number): number;
  recordTurn(chat: string, at: number): void;
  recordSend(chat: string, at: number): void;
}

export interface BudgetLimits {
  instanceTurnsPerDay: number;
  chatTurnsPerDay: number;
  chatSendsPerDay: number;
  chatSendsPer10Min: number;
}

export const BUDGET_LIMITS: BudgetLimits = {
  instanceTurnsPerDay: AUTOPILOT_INSTANCE_TURNS_PER_DAY,
  chatTurnsPerDay: AUTOPILOT_CHAT_TURNS_PER_DAY,
  chatSendsPerDay: AUTOPILOT_CHAT_SENDS_PER_DAY,
  chatSendsPer10Min: AUTOPILOT_CHAT_SENDS_PER_10_MIN,
};

/** The ledger of one server process: timestamps per chat, pruned to the last day on every write. */
export function memoryLedger(): AutopilotLedger {
  const turns = new Map<string, number[]>();
  const sends = new Map<string, number[]>();
  const push = (m: Map<string, number[]>, k: string, at: number) => m.set(k, [...(m.get(k) ?? []).filter((t) => t > at - DAY_MS), at]);
  const count = (xs: number[] | undefined, since: number) => (xs ?? []).filter((t) => t > since).length;
  return {
    turnsSince: (chat, since) => (chat === null ? [...turns.values()].reduce((n, xs) => n + count(xs, since), 0) : count(turns.get(chat), since)),
    sendsSince: (chat, since) => count(sends.get(chat), since),
    recordTurn: (chat, at) => void push(turns, chat, at),
    recordSend: (chat, at) => void push(sends, chat, at),
  };
}

/**
 * The budget a new turn in `chat` would break, as its hand-back reason, or null. Checked before the turn runs: a turn that would
 * be the 101st of the day on this Mac, the 21st in the chat, or follow the chat's 15th send of the day or its 4th in ten minutes
 * hands back instead (verdict 10: four sends in ten minutes looks like a bot).
 */
export function budgetRefusal(ledger: AutopilotLedger, chat: string, now: number, limits: BudgetLimits = BUDGET_LIMITS): AutopilotReason | null {
  if (ledger.turnsSince(null, now - DAY_MS) >= limits.instanceTurnsPerDay) return "instance_budget";
  if (ledger.sendsSince(chat, now - TEN_MIN_MS) >= limits.chatSendsPer10Min) return "looks_like_bot";
  if (ledger.turnsSince(chat, now - DAY_MS) >= limits.chatTurnsPerDay || ledger.sendsSince(chat, now - DAY_MS) >= limits.chatSendsPerDay) return "chat_budget";
  return null;
}

/**
 * The send spacing as a schedule (verdict 11): the door refuses a send within 20 s of the account's last one, so autopilot asks
 * for a time instead of being refused. Each account's slot is reserved, so two turns of the pool on one account space each other
 * out, and the account's durable last send (the owner's own Send included, read from `send_log` by the caller) is respected.
 */
export class SendSpacing {
  private readonly reserved = new Map<string, number>();

  constructor(
    private readonly spacingMs: number = MESSENGER_SPACING_SECONDS * 1000,
    private readonly jitterMs: number = AUTOPILOT_SPACING_JITTER_MS,
  ) {}

  /** The time the next send on `account` may go: now, or the later of its last send and its last reservation plus the spacing and a jitter. */
  reserve(account: string, lastSentAt: number | null, now: number, random: () => number): number {
    const last = Math.max(lastSentAt ?? -Infinity, this.reserved.get(account) ?? -Infinity);
    const at = Number.isFinite(last) ? Math.max(now, last + this.spacingMs + Math.floor(random() * this.jitterMs)) : now;
    this.reserved.set(account, at);
    return at;
  }
}
