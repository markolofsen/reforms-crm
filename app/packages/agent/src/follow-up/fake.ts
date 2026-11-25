import type { FollowUpBrain, FollowUpTurn, FollowUpTurnResult } from "@hub/config/follow-ups";
import type { Repos } from "@hub/db";
import { recordAgentDraft } from "../messenger/record";

// A sweep brain with no model (P142 F4, verdict 21): the e2e run's `HUB_FOLLOWUP_BRAIN=fake` (the server wires it only with a
// throwaway `HUB_DB`) and the unit tests. By a fixed script, through the same writers as a real turn's tools:
// - a client whose newest silence is in a linked chat gets a messenger nudge (`follow_up` n = sent + 1); in an autopilot chat it
//   carries the verdict send and `send_after` = now;
// - a Mail-only client is a wait of two days (the fake writes no Mail);
// - a client with three nudges sent is a stop (`no_answer`).

export interface FakeFollowUpDeps {
  repos: Repos;
  now?: () => Date;
}

export function fakeFollowUpBrain(d: FakeFollowUpDeps): FollowUpBrain {
  const now = () => (d.now ?? (() => new Date()))();
  return {
    name: "fake",
    async turn(t: FollowUpTurn, signal): Promise<FollowUpTurnResult> {
      if (signal.aborted) return { kind: "failed", code: "failed", detail: "aborted" };
      const at = now();
      const plan = await d.repos.followUps.get(t.project, t.client);
      const sent = plan?.nudgesSent ?? 0;
      const next = new Date(at.getTime() + 2 * 86_400_000).toISOString().slice(0, 10);
      const base = { project: t.project, clientId: t.client, waitingOn: "them" as const, tz: null, at: at.toISOString(), batchKey: t.actionId };
      if (sent >= 3) {
        await d.repos.followUps.decide({ ...base, decision: "stop", nextAt: null, reason: "no answer to three follow-ups", stopReason: "no_answer", channel: plan?.channel ?? null, nudgeN: null, line: `${at.toISOString().slice(0, 10)} · стоп · не ответил на 3 follow-up` });
        return { kind: "decided", decision: "stop", nudge: null, costUsd: 0 };
      }
      const due = (await d.repos.followUps.due(t.project, at)).clients.find((c) => c.clientId === t.client);
      const chat = due && due.lastChannel !== "mail" ? due.chats.find((c) => c.channel === due.lastChannel) : undefined;
      if (!chat) {
        await d.repos.followUps.decide({ ...base, decision: "wait", nextAt: next, reason: "the fake brain writes no Mail", stopReason: null, channel: "mail", nudgeN: null, line: `${at.toISOString().slice(0, 10)} · Mail · жду до ${next}` });
        return { kind: "decided", decision: "wait", nudge: null, costUsd: 0 };
      }
      const row = await d.repos.messengers.chatById(t.project, chat.id);
      if (!row) return { kind: "failed", code: "failed", detail: `no chat ${chat.id}` };
      const n = sent + 1;
      const text = `Following up on my last message (${n}).`;
      const send = t.autopilotChat === chat.id;
      const { id } = await recordAgentDraft(d.repos, { project: t.project, chat: row, client: { id: t.client, name: null }, text, provider: send ? "autopilot" : "follow_up", ownerRequest: null, nudge: true, at: at.toISOString(), followUpN: n, ...(send ? { autopilot: { verdict: "send" as const, reason: "a plain follow-up" } } : {}) });
      await d.repos.followUps.decide({ ...base, decision: "nudge", nextAt: next, reason: "a plain follow-up", stopReason: null, channel: row.channel, nudgeN: n, line: `${at.toISOString().slice(0, 10)} · ${row.channel} · ${n}-й follow-up · проверка ${next}` });
      return { kind: "decided", decision: "nudge", nudge: send ? { draftId: id, text, sendAfter: at.toISOString(), chat: chat.id } : null, costUsd: 0 };
    },
  };
}
