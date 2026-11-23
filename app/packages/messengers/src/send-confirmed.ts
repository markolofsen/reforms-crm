import type { Repos } from "@hub/db";
import { isSending, type MessengerAdapter, type SentReceipt } from "./adapter";
import { MessengersError } from "./errors";
import { assertHuman, confirmedFrom, type HumanActor } from "./human";
import { RETENTION_DAYS } from "./types";

// P126 D1: the one messenger send of a confirmed draft, reachable only through the door (`./door.ts`): this module is not in the
// package's exports, so no other caller can skip the door's guards (first contact, Stop sending, cap, spacing, test recipients,
// the send_log row first). The draft-only pin allows `sendConfirmed` here and in the door only.

export interface SendDeps {
  repos: Repos;
  adapter: MessengerAdapter;
  now?: () => Date;
}

/**
 * Sends an already confirmed draft through the adapter and records it as an outbound message in the history.
 * The `ConfirmedDraft` is rebuilt from the stored row, so a restart between approval and send loses nothing.
 */
export async function sendConfirmed(deps: SendDeps, actor: HumanActor, input: { project: string; draftId: number }): Promise<SentReceipt> {
  assertHuman(actor);
  const { repos, adapter } = deps;
  const row = await repos.messengers.getDraft(input.project, input.draftId);
  if (!row || row.status !== "confirmed") throw new MessengersError("not_confirmed", `not_confirmed: draft ${input.draftId} is not approved`);
  if (!isSending(adapter)) throw new MessengersError("no_send_channel", `no_send_channel: ${row.channel} cannot send`);
  if (adapter.channel !== row.channel) throw new MessengersError("adapter_mismatch", `adapter_mismatch: draft is ${row.channel}, adapter is ${adapter.channel}`);
  if (!(await repos.messengers.isAllowed(row.project, row.channel, row.chatId))) {
    throw new MessengersError("chat_not_allowed", `chat_not_allowed: chat ${row.chatId} is no longer on the allow-list`);
  }
  const receipt = await adapter.send(confirmedFrom(row));
  await repos.messengers.markDraftSent(row.project, row.id, receipt.remoteMessageId, receipt.at);
  const now = (deps.now ?? (() => new Date()))();
  await repos.messengers.insertMessage({
    project: row.project,
    channel: row.channel,
    account: adapter.account,
    chatId: row.chatId,
    remoteMessageId: receipt.remoteMessageId,
    direction: "out",
    kind: "text",
    text: row.text,
    sentAt: receipt.at,
    retainUntil: new Date(now.getTime() + RETENTION_DAYS * 86_400_000).toISOString(),
  });
  return receipt;
}
