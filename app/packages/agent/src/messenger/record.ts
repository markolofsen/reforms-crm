import { AUTOPILOT_DRAFT_AUTHOR, type AutopilotVerdict } from "@hub/config/autopilot";
import { FOLLOW_UP_DRAFT_AUTHOR } from "@hub/config/follow-ups";
import type { MessengerChannel, Repos } from "@hub/db";

// P129 verdict 14 (P133): the ONE recorder of an unsent messenger draft written by a machine: the CLI agent's
// `messenger_draft_write` and the Hub LLM's Prepare (`prepareMessengerReply` of the server). It writes the draft (or
// revises the open one) and its Activity run, and the reason names the real producer. It writes through `@hub/db` only
// (rule 17): no adapter, no send capability, no human actor. It sends nothing.

/** Who produced the text. The stored vocabulary of Activity's `provider` (`@hub/contract/activity`). */
export type MessengerDraftProvider = "runtime_agent" | "hub_llm" | "autopilot" | "follow_up";

const PRODUCERS: Record<MessengerDraftProvider, { createdBy: string; reason: string; tool: string; trigger: "agent" | "owner" }> = {
  // The agent writes in a session; `createdBy: "agent"` is the stored value the Messengers card reads.
  runtime_agent: { createdBy: "agent", reason: "Runtime agent prepared an unsent draft.", tool: "messenger_draft_write", trigger: "agent" },
  // The Hub's own LLM writes on the owner's Prepare.
  hub_llm: { createdBy: "hub_llm", reason: "Hub LLM prepared an unsent draft.", tool: "messenger_prepare", trigger: "owner" },
  // Decision 0048: an autopilot turn of the server (one headless Claude turn bound to one chat); the server may send it.
  autopilot: { createdBy: AUTOPILOT_DRAFT_AUTHOR, reason: "Autopilot prepared a reply.", tool: "messenger_draft_write", trigger: "agent" },
  // Decision 0050: a follow-up sweep turn's nudge in a chat without autopilot; it waits for the owner.
  follow_up: { createdBy: FOLLOW_UP_DRAFT_AUTHOR, reason: "The follow-up sweep prepared a nudge.", tool: "messenger_draft_write", trigger: "agent" },
};

export interface AgentDraftInput {
  project: string;
  chat: { channel: MessengerChannel; chatId: string; title: string | null };
  client: { id: number; name: string | null } | null;
  text: string;
  provider: MessengerDraftProvider;
  /** The model that wrote it, when the Hub knows (the Hub LLM's). */
  model?: string;
  ownerRequest: string | null;
  nudge: boolean;
  /** Revise this open draft instead of creating one (the caller checked it is the chat's open draft). */
  revise?: number;
  at: string;
  /** An autopilot turn's verdict on its draft (decision 0048), kept on the Activity line. */
  autopilot?: { verdict: AutopilotVerdict; reason: string };
  /** P142: a follow-up nudge and its number (`messenger_drafts.follow_up_n`); the door counts it on the plan when it is sent. */
  followUpN?: number | null;
}

/** Writes the draft and its Activity row on `repos` (the caller's write connection); returns the draft's id and what happened. */
export async function recordAgentDraft(repos: Repos, i: AgentDraftInput): Promise<{ id: number; action: "created" | "revised" }> {
  const p = PRODUCERS[i.provider];
  const extra = { ownerRequest: i.ownerRequest, nudge: i.nudge, ...(i.followUpN !== undefined ? { followUpN: i.followUpN } : {}) };
  const id =
    i.revise === undefined
      ? (await repos.messengers.createDraft({ project: i.project, channel: i.chat.channel, chatId: i.chat.chatId, text: i.text, createdBy: p.createdBy, clientId: i.client?.id ?? null, ...extra })).id
      : (await repos.messengers.reviseDraft(i.project, i.revise, i.text, { ...extra, createdBy: p.createdBy })).id;
  const action = i.revise === undefined ? "drafted" : "updated";
  const runId = await repos.runs.start({ project: i.project, startedAt: i.at, finishedAt: i.at, trigger: p.trigger, skill: "messenger-reply", status: "ok" });
  await repos.runs.addEvent({
    project: i.project,
    runId,
    at: i.at,
    kind: action === "drafted" ? "draft_created" : "decision",
    tool: p.tool,
    summary: `Drafted reply for ${i.client?.name ?? i.chat.title ?? i.chat.chatId}`,
    detail: JSON.stringify({ action, draftId: id, reason: p.reason, skill: "messenger-reply", provider: i.provider, ...(i.model ? { model: i.model } : {}), ...(i.autopilot ? { autopilot: i.autopilot } : {}), ...(i.followUpN != null ? { followUpN: i.followUpN } : {}) }),
    clientId: i.client?.id ?? null,
  });
  return { id, action: i.revise === undefined ? "created" : "revised" };
}
