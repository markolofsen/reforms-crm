/**
 * The human path. Everything that links a chat to a client, lists a chat, approves a reply or sends one lives here
 * and needs a `HumanActor`. This module is a separate package entry (`@hub/messengers/human`): the agent-facing
 * entry (`@hub/messengers`) does not export it. A `HumanActor` is minted only by `humanActor()`, which an entry
 * point calls once it knows a person is present (the CLI checks for a terminal; the server mints one behind the admin
 * gate for a Telegram user account's link, and in its send door for the one send a person confirmed: decision 0036 point 7,
 * P71 M4). Do not import this file from anything an agent can call.
 * The login of a user account, the WhatsApp pairing and their session writes are exported here too, for the same reason: only a
 * person logs in or scans a QR code.
 */
import type { IdentifierKind, MessengerChannel, Repos } from "@hub/db";
import { isSending, type InboundMessage, type MessengerAdapter, type SentReceipt } from "./adapter";
import { mintConfirmed, type ConfirmedDraft } from "./confirmed";
import { MessengersError } from "./errors";
import { normalizeIdentifier } from "./normalize";
import { channelsOf, RETENTION_DAYS } from "./types";
import { ingest } from "./ingest";
import { IMPORT_DAYS } from "./telegram-user";

declare const humanBrand: unique symbol;

export interface HumanActor {
  readonly [humanBrand]: true;
  readonly name: string;
}

const humans = new WeakSet<object>();

export function humanActor(name: string): HumanActor {
  const n = name.trim();
  if (!n) throw new MessengersError("not_human", "not_human: an actor needs a name");
  const a = Object.freeze({ name: n });
  humans.add(a);
  return a as unknown as HumanActor;
}

function assertHuman(a: unknown): asserts a is HumanActor {
  if (typeof a !== "object" || a === null || !humans.has(a)) {
    throw new MessengersError("not_human", "not_human: this needs a human actor token");
  }
}

// ---- linking and the allow-list

export interface LinkInput {
  project: string;
  clientId: number;
  kind: IdentifierKind;
  value: string;
  /** For a Telegram chat: `telegram_bot` (default) or `telegram_user`. */
  channel?: MessengerChannel;
  title?: string;
}

/**
 * Links a chat, number or address to a client. The only writer of `client_identifiers`: nothing matches
 * automatically. For a chat kind it also puts the chat on the inbound allow-list, since the owner just named it.
 */
export async function linkIdentifier(repos: Repos, actor: HumanActor, input: LinkInput) {
  assertHuman(actor);
  await repos.projects.requireProject(input.project);
  const value = normalizeIdentifier(input.kind, input.value);
  const identifierId = await repos.messengers.addIdentifier(input.project, input.clientId, input.kind, value);
  let channel: MessengerChannel | null = null;
  if (input.kind === "telegram" || input.kind === "whatsapp") {
    channel = input.channel ?? channelsOf(input.kind)[0]!;
    if (!channelsOf(input.kind).includes(channel)) throw new MessengersError("bad_identifier", `bad_identifier: ${input.kind} does not use channel ${channel}`);
    await repos.messengers.allowChat(input.project, channel, value, input.title ?? null);
  }
  return { identifierId, value, allowedChannel: channel };
}

/** Removes the link and takes the chat off the allow-list; its stored messages and drafts go with it, in one transaction (P71 M2b). */
export async function unlinkIdentifier(repos: Repos, actor: HumanActor, input: { project: string; kind: IdentifierKind; value: string }) {
  assertHuman(actor);
  const value = normalizeIdentifier(input.kind, input.value);
  const removed = await repos.messengers.removeIdentifier(input.project, input.kind, value);
  let disallowed = 0;
  for (const ch of channelsOf(input.kind)) if (await repos.messengers.disallowChat(input.project, ch, value)) disallowed++;
  return { removed: removed !== null, disallowed };
}

/** Lists a chat without linking it to a client (a first message from a new chat, before the client exists). */
export async function allowChat(repos: Repos, actor: HumanActor, input: { project: string; channel: MessengerChannel; chatId: string; title?: string }) {
  assertHuman(actor);
  await repos.projects.requireProject(input.project);
  const chatId = normalizeIdentifier(CHANNEL_KIND[input.channel], input.chatId);
  await repos.messengers.allowChat(input.project, input.channel, chatId, input.title ?? null);
  return chatId;
}

export async function disallowChat(repos: Repos, actor: HumanActor, input: { project: string; channel: MessengerChannel; chatId: string }) {
  assertHuman(actor);
  const chatId = normalizeIdentifier(CHANNEL_KIND[input.channel], input.chatId);
  return repos.messengers.disallowChat(input.project, input.channel, chatId);
}

const CHANNEL_KIND: Record<MessengerChannel, IdentifierKind> = { telegram_bot: "telegram", telegram_user: "telegram", whatsapp: "whatsapp" };

// ---- drafts: approve, send, copy

function confirmedFrom(d: { id: number; project: string; channel: MessengerChannel; chatId: string; text: string; confirmedBy: string | null; confirmedAt: string | null }): ConfirmedDraft {
  return mintConfirmed({ id: d.id, project: d.project, channel: d.channel, chatId: d.chatId, text: d.text, confirmedBy: d.confirmedBy ?? "unknown", confirmedAt: d.confirmedAt ?? "" });
}

/** The owner approves a draft (the send door does, right before the one send). */
export async function confirmDraft(repos: Repos, actor: HumanActor, input: { project: string; draftId: number; at?: string }): Promise<ConfirmedDraft> {
  assertHuman(actor);
  const cur = await repos.messengers.getDraft(input.project, input.draftId);
  if (!cur) throw new MessengersError("not_confirmed", `not_confirmed: draft ${input.draftId} not found`);
  if (!(await repos.messengers.isAllowed(cur.project, cur.channel, cur.chatId))) {
    throw new MessengersError("chat_not_allowed", `chat_not_allowed: ${cur.channel} chat ${cur.chatId} is no longer on the allow-list`);
  }
  const row = await repos.messengers.confirmDraft(input.project, input.draftId, actor.name, input.at);
  return confirmedFrom(row);
}

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

export async function discardDraft(repos: Repos, actor: HumanActor, input: { project: string; draftId: number }): Promise<void> {
  assertHuman(actor);
  await repos.messengers.discardDraft(input.project, input.draftId);
}

// ---- user accounts: the login and the session file (P71, decision 0036 points 4 and 5)
export { createLoginFlows, LOGIN_TTL_MS, type LoginDeps, type LoginFlows } from "./telegram-user-login";
export { removeSession, writeSession } from "./sessions";
export { createWaPairing, PAIRING_TTL_MS, qrRows, type PairingDeps, type PairingStep, type WaPairing } from "./whatsapp-pairing";

/** What a link needs of a user account's adapter (Telegram or WhatsApp): its channel, the allow-list re-read, the import. */
export interface LinkableAdapter {
  readonly channel: "telegram_user" | "whatsapp";
  refreshAllowed(): Promise<void>;
  history(chatId: string, o: { since: Date }): Promise<InboundMessage[]>;
}

const KIND_OF = { telegram_user: "telegram", whatsapp: "whatsapp" } as const;

/**
 * Links a user account's private chat to a client (0036 point 3): writes `client_identifiers` (kind `telegram` with the chat's user
 * id, or `whatsapp` with its number), allows the chat on the adapter's channel, then imports its last `days` (default 30) through
 * the one ingest. The chat is chosen by the owner from the picker; nothing is matched for him.
 */
export async function linkUserChat(
  deps: { repos: Repos; adapter: LinkableAdapter; now?: () => Date },
  actor: HumanActor,
  input: { project: string; clientId: number; chatId: string; title?: string; days?: number },
): Promise<{ identifierId: number; imported: number; importError: string | null }> {
  assertHuman(actor);
  const linked = await linkIdentifier(deps.repos, actor, { project: input.project, clientId: input.clientId, kind: KIND_OF[deps.adapter.channel], value: input.chatId, channel: deps.adapter.channel, ...(input.title ? { title: input.title } : {}) });
  await deps.adapter.refreshAllowed();
  const now = (deps.now ?? (() => new Date()))();
  // The link stands even when the import fails: new messages arrive anyway, and the poller's catch-up reads from its cursor.
  try {
    const rows = await deps.adapter.history(linked.value, { since: new Date(now.getTime() - (input.days ?? IMPORT_DAYS) * 86_400_000) });
    const r = await ingest({ project: input.project, repos: deps.repos, now: () => now }, rows);
    return { identifierId: linked.identifierId, imported: r.stored, importError: null };
  } catch (e) {
    return { identifierId: linked.identifierId, imported: 0, importError: e instanceof Error ? e.message : "the import failed" };
  }
}
