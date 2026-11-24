import { isHiddenLabel } from "@hub/config/chat-rules";
import { isPausingReason, type AutopilotBrain, type AutopilotChat, type AutopilotMode, type AutopilotReason } from "@hub/config/autopilot";
import type { Repos } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";
import type { StoredChat } from "@hub/messengers";
import { AutopilotScheduler, type Clock, type Outcome, type SchedulerDeps } from "./scheduler";
import { autopilotSwitches, type AutopilotFiles, type AutopilotSwitches } from "./switches";
import { turnRunner, type AutopilotDeliver } from "./turn";

// The autopilot in the server (P139 A2): the messenger ingest wakes it (`onStored`, inside the poll that stored the message,
// never a timer or a poll of its own), the scheduler decides when a turn runs, the precheck reads the switches and the chat right
// before it, and a hand-back pauses the chat in `app.db` (decision 0048 point 5). Nothing here sends.

export interface AutopilotHandle {
  switches: AutopilotSwitches;
  scheduler: AutopilotScheduler;
  /** The ingest stored messages in these chats of `project` (the pollers' `onStored`). Never throws. */
  stored(project: string, chats: StoredChat[]): void;
  /** At server start (verdict 23): queue or hand back each autopilot chat's unanswered client message. */
  scan(): Promise<void>;
  /** Resolves when every wake and every turn has settled (tests, shutdown). */
  idle(): Promise<void>;
}

export interface AutopilotDeps {
  repos: Repos;
  files: AutopilotFiles;
  /** A3's brain; absent, every turn is `skipped: no_brain`. */
  brain?: AutopilotBrain;
  /** A4's send; absent, a `send` verdict is `skipped: no_sender`. */
  deliver?: AutopilotDeliver;
  clock?: Clock;
  scheduler?: Pick<SchedulerDeps, "ledger" | "spacing" | "pool" | "limits">;
}

type Precheck = { skip: AutopilotReason } | { mode: Exclude<AutopilotMode, "off"> };

/** Right before a turn: every switch still on, not paused, the newest message the client's and not hidden, no draft of the owner's waiting. */
async function precheck(repos: Repos, switches: AutopilotSwitches, chat: AutopilotChat): Promise<Precheck> {
  const c = await switches.chat(chat.project, chat);
  if (!c || c.state.state === "off") return { skip: "switched_off" };
  if (c.state.state === "paused") return { skip: "paused" };
  const [newest] = await repos.messengers.messagesOf(chat.project, [{ channel: chat.channel, chatId: chat.chatId }], { limit: 1 });
  if (!newest || newest.direction !== "in") return { skip: "not_inbound" };
  const verdict = (await repos.messengers.verdictsOf(chat.project, [newest.id])).get(newest.id);
  if (isHiddenLabel(verdict)) return { skip: "hidden" };
  // Verdict 29: an open draft is the owner's until A3 marks autopilot's own drafts; a turn never touches his.
  if (await repos.messengers.openDraft(chat.project, chat.channel, chat.chatId)) return { skip: "your_draft" };
  return { mode: c.state.state };
}

export function createAutopilot(d: AutopilotDeps): AutopilotHandle {
  const { repos } = d;
  const log = ops("autopilot");
  const switches = autopilotSwitches({ ...d.files, repos });
  const wakes = new Set<Promise<void>>();
  const onOutcome = async (o: Outcome) => {
    if (isPausingReason(o.reason)) await repos.messengers.setAutopilotPause(o.chat.project, o.chat.channel, o.chat.chatId, o.reason);
  };
  const scheduler = new AutopilotScheduler({
    precheck: (chat) => precheck(repos, switches, chat),
    run: turnRunner({ brain: d.brain, deliver: d.deliver }),
    onOutcome,
    ...(d.clock ? { clock: d.clock } : {}),
    ...d.scheduler,
  });

  const wake = async (project: string, chats: StoredChat[]) => {
    for (const s of chats) {
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
      const items: Array<{ chat: AutopilotChat; newestAt: number }> = [];
      for (const { slug } of (await repos.projects.registry()).projects) {
        for (const row of await switches.listed(slug)) {
          const chat = switches.chatOf(slug, row);
          // The precheck's own reads: a chat off or paused, a newest message not the client's or one the pre-analysis hid, and a
          // draft that already waits (a dry run's, the owner's) are not "missed": nothing is queued and nothing pauses.
          if ("skip" in (await precheck(repos, switches, chat))) continue;
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
  };
}
