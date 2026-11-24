import { isHiddenLabel } from "@hub/config/chat-rules";
import { AUTOPILOT_DRAFT_AUTHOR, AUTOPILOT_SEND_ACTOR, isPausingReason, type AutopilotBrain, type AutopilotChat } from "@hub/config/autopilot";
import { isDoneThrough, type Repos } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";
import type { StoredChat } from "@hub/messengers";
import { memoryLedger } from "./budget";
import { recordTurn, seedLedger } from "./record";
import { AutopilotScheduler, type Clock, type Outcome, type Precheck, type SchedulerDeps } from "./scheduler";
import { autopilotSwitches, type AutopilotFiles, type AutopilotSwitches } from "./switches";
import { turnRunner, type AutopilotDeliver } from "./turn";

// The autopilot in the server (P139 A2-A6): the messenger ingest wakes it (`onStored`, inside the poll that stored the message,
// never a timer or a poll of its own), the scheduler decides when a turn runs, the precheck reads the switches and the chat right
// before it, the brain (A3) drafts, `deliver` (A4) sends through the door, a hand-back pauses the chat in `app.db` (decision 0048
// point 5), and every outcome is one Activity line (A6) whose rows refill the budgets after a restart.

export interface AutopilotHandle {
  switches: AutopilotSwitches;
  scheduler: AutopilotScheduler;
  /** The ingest stored messages in these chats of `project` (the pollers' `onStored`). Never throws. */
  stored(project: string, chats: StoredChat[]): void;
  /** At server start (verdict 23): queue or hand back each autopilot chat's unanswered client message. */
  scan(): Promise<void>;
  /** Resolves when every wake and every turn has settled (tests, shutdown). */
  idle(): Promise<void>;
  /** A4: the send, once the accounts it reaches have started (the ingest that wakes the autopilot starts with them). */
  useDeliver(deliver: AutopilotDeliver): void;
}

export interface AutopilotDeps {
  repos: Repos;
  files: AutopilotFiles;
  /** A3's brain; absent, every turn is `skipped: no_brain`. */
  brain?: AutopilotBrain;
  /** A4's send; absent, a `send` verdict is `skipped: no_sender`. It may be built after this (the accounts start later). */
  deliver?: AutopilotDeliver;
  /** Today's start, for the daily assistant line (verdict 18); default the server's local midnight. */
  dayStart?: (now: Date) => Date;
  clock?: Clock;
  scheduler?: Pick<SchedulerDeps, "ledger" | "spacing" | "pool" | "limits">;
}

const localMidnight = (now: Date) => new Date(now.getFullYear(), now.getMonth(), now.getDate());

/**
 * Verdict 18: whether this reply is the chat's first autopilot message today and the project discloses daily. Read from
 * `send_log` (a dry run sends nothing, so its drafts each carry the line until one goes out).
 */
async function disclosesNow(repos: Repos, chat: AutopilotChat, daily: boolean, since: Date): Promise<boolean> {
  if (!daily) return false;
  const to = `${chat.channel === "whatsapp" ? "whatsapp" : "telegram"}:${chat.chatId}`;
  return !(await repos.sends.messengerSendsOf(AUTOPILOT_SEND_ACTOR, since.toISOString())).some((s) => s.project === chat.project && s.channel === chat.channel && s.toAddr === to);
}

/**
 * Right before a turn: every switch still on, not paused, the newest message the client's and not hidden, no draft of the
 * owner's waiting (autopilot's own waiting draft is revised, verdict 29), and whether the reply carries the daily line.
 */
async function precheck(repos: Repos, switches: AutopilotSwitches, chat: AutopilotChat, dayStart: Date): Promise<Precheck> {
  const c = await switches.chat(chat.project, chat);
  if (!c || c.state.state === "off") return { skip: "switched_off" };
  if (c.state.state === "paused") return { skip: "paused" };
  const [newest] = await repos.messengers.messagesOf(chat.project, [{ channel: chat.channel, chatId: chat.chatId }], { limit: 1 });
  if (!newest || newest.direction !== "in") return { skip: "not_inbound" };
  const verdict = (await repos.messengers.verdictsOf(chat.project, [newest.id])).get(newest.id);
  if (isHiddenLabel(verdict)) return { skip: "hidden" };
  // P143 D3: a chat marked no reply needed through this message waits for their next one.
  if (isDoneThrough(c.row, newest.sentAt)) return { skip: "done" };
  // Verdict 29: a draft the owner (or an attended session) wrote or edited is his; a turn never touches it.
  const open = await repos.messengers.openDraft(chat.project, chat.channel, chat.chatId);
  if (open && open.createdBy !== AUTOPILOT_DRAFT_AUTHOR) return { skip: "your_draft" };
  let daily = true;
  try {
    daily = switches.project(chat.project).policy.disclose === "daily";
  } catch {
    daily = true;
  }
  return { mode: c.state.state, revise: open?.id ?? null, disclose: await disclosesNow(repos, chat, daily, dayStart) };
}

/** P143 D3: the chat is marked no reply needed through its newest stored message (its own time). */
async function doneNow(repos: Repos, chat: AutopilotChat): Promise<boolean> {
  const row = await repos.messengers.chat(chat.project, chat.channel, chat.chatId);
  const [newest] = await repos.messengers.messagesOf(chat.project, [{ channel: chat.channel, chatId: chat.chatId }], { limit: 1 });
  return !!row && !!newest && newest.direction === "in" && isDoneThrough(row, newest.sentAt);
}

export function createAutopilot(d: AutopilotDeps): AutopilotHandle {
  const { repos } = d;
  const log = ops("autopilot");
  const switches = autopilotSwitches({ ...d.files, repos });
  const wakes = new Set<Promise<void>>();
  const clockNow = () => new Date(d.clock ? d.clock.now() : Date.now());
  const dayStart = d.dayStart ?? localMidnight;
  const onOutcome = async (o: Outcome) => {
    if (isPausingReason(o.reason)) await repos.messengers.setAutopilotPause(o.chat.project, o.chat.channel, o.chat.chatId, o.reason);
    // "interrupted" never reaches here (the turn reruns); every other outcome is one Activity line.
    await recordTurn(repos, o, clockNow());
  };
  const ledger = d.scheduler?.ledger ?? memoryLedger();
  const late: { deliver?: AutopilotDeliver } = {};
  const scheduler = new AutopilotScheduler({
    precheck: (chat) => precheck(repos, switches, chat, dayStart(clockNow())),
    run: (turn, signal) => turnRunner({ brain: d.brain, deliver: late.deliver ?? d.deliver, isDone: (t) => doneNow(repos, t.chat) })(turn, signal),
    onOutcome,
    ...(d.clock ? { clock: d.clock } : {}),
    ...d.scheduler,
    ledger,
  });

  const wake = async (project: string, chats: StoredChat[]) => {
    for (const s of chats) {
      // Decision 0049 point 9: a chat cached before it is linked never wakes the autopilot.
      if (!s.linked) continue;
      const c = await switches.chat(project, s);
      if (!c || (c.state.state !== "on" && c.state.state !== "dry_run")) continue;
      const chat = switches.chatOf(project, c.row);
      // A client message first, then the owner's: when both came in one poll, his message wins and pauses the chat.
      if (s.inbound > 0) scheduler.inbound(chat, s.inbound);
      if (s.outbound > 0) scheduler.outbound(chat);
    }
  };

  return {
    switches,
    scheduler,
    stored: (project, chats) => {
      if (chats.length === 0) return;
      const p: Promise<void> = wake(project, chats)
        .catch((e: unknown) => log.error("the autopilot wake failed", { project, ...errFields(e) }))
        .finally(() => wakes.delete(p));
      wakes.add(p);
    },
    scan: async () => {
      // A6: the last day's turns and sends back into the budgets before anything is queued.
      const seeded = await seedLedger(repos, ledger, clockNow());
      if (seeded.turns || seeded.sends) log.info("autopilot budgets read back", seeded);
      const items: Array<{ chat: AutopilotChat; newestAt: number }> = [];
      for (const { slug } of (await repos.projects.registry()).projects) {
        for (const row of await switches.listed(slug)) {
          const chat = switches.chatOf(slug, row);
          // The precheck's own reads: a chat off or paused, a newest message not the client's or one the pre-analysis hid, and a
          // draft that already waits (a dry run's, the owner's) are not "missed": nothing is queued and nothing pauses.
          if ("skip" in (await precheck(repos, switches, chat, dayStart(clockNow())))) continue;
          // A draft that already waits (a dry run's "would send", a handed-back one) answered the burst: nothing was missed.
          if (await repos.messengers.openDraft(slug, row.channel, row.chatId)) continue;
          const [newest] = await repos.messengers.messagesOf(slug, [{ channel: row.channel, chatId: row.chatId }], { limit: 1 });
          if (newest) items.push({ chat, newestAt: Date.parse(newest.sentAt) });
        }
      }
      scheduler.resume(items);
    },
    idle: async () => {
      while (wakes.size) await Promise.all([...wakes]);
      await scheduler.idle();
    },
    useDeliver: (deliver) => {
      late.deliver = deliver;
    },
  };
}
