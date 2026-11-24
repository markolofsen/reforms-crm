import type { MessengerChannel, Repos } from "@hub/db";
import { isSending, type MessengerAdapter, type SentReceipt } from "./adapter";
import { actorOf, assertAuthorized, type SendAuthorization } from "./authorization";
import { mintConfirmed, type ConfirmedDraft } from "./confirmed";
import { MessengersError } from "./errors";
import { RETENTION_DAYS } from "./types";

// P126 D1, P112 S2: the approval and the one messenger send of a draft, reachable only through the door (`./door.ts`): this module
// is not in the package's exports, so no other caller can skip the door's guards (lifecycle, first contact, Stop sending, cap,
// spacing, test recipients, the policy generation, the send_log row first). Both steps take the door's `SendAuthorization` and
// re-check it against the stored row, its text hash included. The draft-only pin allows `sendConfirmed` here and in the door only.

export interface SendDeps {
  repos: Repos;
  adapter: MessengerAdapter;
  now?: () => Date;
}

/** The `ConfirmedDraft` an adapter's `send` takes, rebuilt from the stored row (a restart between approval and send loses nothing). */
function confirmedFrom(d: { id: number; project: string; channel: MessengerChannel; chatId: string; text: string; confirmedBy: string | null; confirmedAt: string | null }): ConfirmedDraft {
  return mintConfirmed({ id: d.id, project: d.project, channel: d.channel, chatId: d.chatId, text: d.text, confirmedBy: d.confirmedBy ?? "unknown", confirmedAt: d.confirmedAt ?? "" });
}

/** The approval the door makes right before the one send: the draft becomes `confirmed`, by the authority's actor. */
export async function confirmDraft(repos: Repos, auth: SendAuthorization, input: { at?: string }): Promise<ConfirmedDraft> {
  const cur = await repos.messengers.getDraft(auth.project, auth.draftId);
  if (!cur) throw new MessengersError("not_confirmed", `not_confirmed: draft ${auth.draftId} not found`);
  assertAuthorized(auth, cur);
  if (!(await repos.messengers.isAllowed(cur.project, cur.channel, cur.chatId))) {
    throw new MessengersError("chat_not_allowed", `chat_not_allowed: ${cur.channel} chat ${cur.chatId} is no longer on the allow-list`);
  }
  const row = await repos.messengers.confirmDraft(auth.project, auth.draftId, actorOf(auth.authority), input.at);
  // The text that was confirmed is the text the door judged (a write between the read above and the confirm would show here).
  assertAuthorized(auth, row);
  return confirmedFrom(row);
}

/**
 * Sends an already confirmed draft through the adapter and records it as an outbound message in the history. The row is read
 * again here, and the authorization checked against it once more (its text hash), right before the adapter.
 */
export async function sendConfirmed(deps: SendDeps, auth: SendAuthorization): Promise<SentReceipt> {
  const { repos, adapter } = deps;
  const row = await repos.messengers.getDraft(auth.project, auth.draftId);
  if (!row || row.status !== "confirmed") throw new MessengersError("not_confirmed", `not_confirmed: draft ${auth.draftId} is not approved`);
  assertAuthorized(auth, row);
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
