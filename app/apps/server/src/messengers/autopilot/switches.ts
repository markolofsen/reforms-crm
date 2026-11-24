import { AUTOPILOT_REASON_WORDS, autopilotChatKey, isPausingReason, type AutopilotChat } from "@hub/config/autopilot";
import type { AutopilotChatDto, AutopilotProjectDto } from "@hub/contract/autopilot";
import type { MessengerChatRow, Repos } from "@hub/db";
import { autopilotOf, chatAutopilot, readAutopilotSwitch, setAutopilot, writeAutopilotSwitch, type AutopilotChange, type ChatAutopilot, type SwitchState } from "@hub/projects/autopilot";
import { readSendPolicy, type AutopilotPolicy } from "@hub/projects/send-policy";
import { projectStore } from "@hub/projects/store";

// The three switches of decision 0048 point 2 as the server reads them, live on every call (never cached): the instance file,
// the project's send-policy block, the chat's membership, then Stop sending, the chat's reply mode and its pause in `app.db`.
// The writes go through `@hub/projects/autopilot` (the send policy's one writer); only the owner's routes call them.

export interface AutopilotFiles {
  /** `hubPaths().autopilot`. */
  switchFile: string;
  /** `hubPaths().stateProjects`. */
  policyDir: string;
  projectsDir: string;
}

export interface ProjectAutopilot {
  kind: string;
  policy: AutopilotPolicy;
  updatedAt: string | null;
  error: string | null;
}

export type AutopilotSwitches = ReturnType<typeof autopilotSwitches>;

const chatOf = (project: string, r: MessengerChatRow): AutopilotChat => ({ project, channel: r.channel, chatId: r.chatId, chat: r.id });
const pauseOf = (r: MessengerChatRow) => (r.autopilotPausedAt ? { at: r.autopilotPausedAt, reason: r.autopilotPausedReason ?? "paused" } : null);

export function autopilotSwitches(o: AutopilotFiles & { repos: Repos }) {
  const instance = (): SwitchState => readAutopilotSwitch(o.switchFile);
  /** Throws when the project is not registered here (the route's 404). */
  const project = (slug: string): ProjectAutopilot => {
    const kind = projectStore({ projects: o.projectsDir, stateProjects: o.policyDir }).config(slug).kind;
    const st = readSendPolicy(o.policyDir, slug, kind);
    return { kind, policy: autopilotOf(st.policy), updatedAt: st.policy.updatedAt || null, error: st.error ?? null };
  };
  const stateOf = (r: MessengerChatRow, p: ProjectAutopilot, on: boolean, stopped: boolean): ChatAutopilot =>
    chatAutopilot({ instanceOn: on, policy: p.policy, chat: autopilotChatKey(r.channel, r.chatId), replyMode: r.replyMode, stopped, paused: pauseOf(r) });

  return {
    instance,
    project,
    chatOf,
    /** One chat's autopilot now, or null when the chat is not linked in this project. */
    async chat(slug: string, chat: Pick<AutopilotChat, "channel" | "chatId">): Promise<{ row: MessengerChatRow; state: ChatAutopilot } | null> {
      const row = await o.repos.messengers.chat(slug, chat.channel, chat.chatId);
      // P141 U6 (decision 0049 point 9): an unlinked chat has no autopilot at all, whatever the project's block lists.
      if (!row || !(await o.repos.messengers.isLinked(slug, chat.channel, chat.chatId))) return null;
      let p: ProjectAutopilot;
      try {
        p = project(slug);
      } catch {
        return { row, state: { state: "off", off: "project" } };
      }
      return { row, state: stateOf(row, p, instance().value.on, await o.repos.sends.isStopped(slug)) };
    },
    /** The linked chats listed in the project's block (the wake and the restart scan read only these). */
    async listed(slug: string): Promise<MessengerChatRow[]> {
      let p: ProjectAutopilot;
      try {
        p = project(slug);
      } catch {
        return [];
      }
      if (p.policy.mode === "off" || p.policy.chats.length === 0) return [];
      const keys = new Set(p.policy.chats);
      return (await o.repos.messengers.knownChats(slug)).filter((r) => r.linked && keys.has(autopilotChatKey(r.channel, r.chatId)));
    },
    /** The project's block and every linked chat's state, for the owner's route. */
    async view(slug: string): Promise<AutopilotProjectDto> {
      const p = project(slug);
      const on = instance().value.on;
      const stopped = await o.repos.sends.isStopped(slug);
      const chats: AutopilotChatDto[] = [];
      for (const r of (await o.repos.messengers.knownChats(slug)).filter((x) => x.linked)) {
        const s = stateOf(r, p, on, stopped);
        const reason = s.state === "paused" ? s.reason : null;
        chats.push({
          chat: r.id,
          channel: r.channel,
          chatId: r.chatId,
          title: r.title,
          listed: p.policy.chats.includes(autopilotChatKey(r.channel, r.chatId)),
          state: s.state,
          off: s.state === "off" ? s.off : null,
          pausedAt: s.state === "paused" ? s.at : null,
          pausedReason: reason,
          pausedWords: reason === null ? null : isPausingReason(reason) ? AUTOPILOT_REASON_WORDS[reason] : reason,
        });
      }
      return { project: slug, instanceOn: on, mode: p.policy.mode, disclose: p.policy.disclose, quiet: p.policy.quiet, updatedAt: p.updatedAt, error: p.error, chats };
    },
    setInstance: (on: boolean, by: string, now: Date) => writeAutopilotSwitch(o.switchFile, on, by, now),
    setProject: (slug: string, change: AutopilotChange, by: string, now: Date) => setAutopilot(o.policyDir, slug, project(slug).kind, change, by, now),
  };
}
