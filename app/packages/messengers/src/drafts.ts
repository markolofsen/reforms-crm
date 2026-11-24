import type { MessengerDraftRow, Repos } from "@hub/db";
import { MessengersError } from "./errors";
import { MAX_TEXT, type Draft, type MessengerChannel } from "./types";

export const toDraft = (r: MessengerDraftRow): Draft => ({
  state: "draft",
  id: r.id,
  project: r.project,
  channel: r.channel,
  chatId: r.chatId,
  text: r.text,
  clientId: r.clientId,
});

export function checkText(text: string): string {
  const t = text.trim();
  if (!t) throw new MessengersError("bad_text", "bad_text: a reply cannot be empty");
  if (t.length > MAX_TEXT) throw new MessengersError("bad_text", `bad_text: ${t.length} characters, the limit is ${MAX_TEXT}`);
  return t;
}

export interface NewDraftInput {
  project: string;
  channel: MessengerChannel;
  chatId: string;
  text: string;
  /** Who wrote it: an agent run id. */
  createdBy: string;
  clientId?: number;
}

/**
 * The agent-facing way to answer a chat. It can only make a `Draft`: no state, status or approval argument exists,
 * and a `Draft` is not accepted by any adapter's `send`. The chat must be known to the project (decision 0049: linked or not).
 */
export async function createDraft(repos: Repos, input: NewDraftInput): Promise<Draft> {
  await repos.projects.requireProject(input.project);
  const text = checkText(input.text);
  if (!(await repos.messengers.isKnown(input.project, input.channel, input.chatId))) {
    throw new MessengersError("chat_not_known", `chat_not_known: ${input.channel} chat ${input.chatId} is not known to the project`);
  }
  const row = await repos.messengers.createDraft({
    project: input.project,
    channel: input.channel,
    chatId: input.chatId,
    text,
    createdBy: input.createdBy,
    ...(input.clientId !== undefined ? { clientId: input.clientId } : {}),
  });
  return toDraft(row);
}

/** Drafts waiting for the owner. */
export async function listOpenDrafts(repos: Repos, project: string): Promise<Draft[]> {
  return (await repos.messengers.listDrafts(project, ["draft"])).map(toDraft);
}
