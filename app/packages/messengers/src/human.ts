/**
 * The human path. Everything that links a chat to a client, lists a chat or sets a draft aside lives here and needs a
 * `HumanActor`. This module is a separate package entry (`@hub/messengers/human`): the agent-facing entry (`@hub/messengers`)
 * does not export it. A `HumanActor` is minted only by `humanActor()`, which an entry point calls once it knows a person is
 * present (the CLI checks for a terminal; the server mints one behind the admin gate for a link). Approving and sending a draft
 * are not here: they take the send door's `SendAuthorization` (`./door.ts`, P112 S2), never a `HumanActor`.
 * Do not import this file from anything an agent can call.
 * The login of a user account, the WhatsApp pairing and their session writes are exported here too, for the same reason: only a
 * person logs in or scans a QR code.
 */
import { RepoError, type IdentifierKind, type MessengerChannel, type Repos } from "@hub/db";
import type { InboundMessage } from "./adapter";
import { MessengersError } from "./errors";
import { normalizeIdentifier } from "./normalize";
import { channelsOf } from "./types";
import { ingest } from "./ingest";
import { IMPORT_DAYS } from "@hub/config/chat-rules";

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

export function assertHuman(a: unknown): asserts a is HumanActor {
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
 * Links a chat, number or address to a client. The owner's writer of `client_identifiers` (the autolink is the other, on an exact
 * match). For a chat kind it also makes the chat known, since the owner just named it, and gives its waiting draft the client.
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
    await repos.messengers.knowChat(input.project, channel, value, { title: input.title ?? null });
    await repos.messengers.adoptChatDrafts(input.project, channel, value, input.clientId);
  }
  return { identifierId, value, allowedChannel: channel };
}

/**
 * Removes the link (decision 0049 point 10): only the identifier goes, so a chat goes back to "Not linked" with its cached messages
 * under the cache's TTL. Forgetting a chat (its row, messages and drafts) is Hide's and Never link's (`forgetChat`).
 */
export async function unlinkIdentifier(repos: Repos, actor: HumanActor, input: { project: string; kind: IdentifierKind; value: string }) {
  assertHuman(actor);
  const value = normalizeIdentifier(input.kind, input.value);
  const removed = await repos.messengers.removeIdentifier(input.project, input.kind, value);
  return { removed: removed !== null };
}

/** Makes a chat known without linking it to a client (the CLI's `allow`: a first message from a new chat, before the client exists). */
export async function knowChat(repos: Repos, actor: HumanActor, input: { project: string; channel: MessengerChannel; chatId: string; title?: string }) {
  assertHuman(actor);
  await repos.projects.requireProject(input.project);
  const chatId = normalizeIdentifier(CHANNEL_KIND[input.channel], input.chatId);
  await repos.messengers.knowChat(input.project, input.channel, chatId, { title: input.title ?? null });
  return chatId;
}

/** Forgets a chat: its row, its cached messages and its drafts, in one transaction (Hide, Never link, the CLI's `remove`). */
export async function forgetChat(repos: Repos, actor: HumanActor, input: { project: string; channel: MessengerChannel; chatId: string }) {
  assertHuman(actor);
  const chatId = normalizeIdentifier(CHANNEL_KIND[input.channel], input.chatId);
  return (await repos.messengers.forgetChat(input.project, input.channel, chatId)).removed;
}

const CHANNEL_KIND: Record<MessengerChannel, IdentifierKind> = { telegram_bot: "telegram", telegram_user: "telegram", whatsapp: "whatsapp" };

// ---- drafts: set one aside (approving and sending one is the door's, `./door.ts`, P112 S2)

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
  /** The cache's TTL of this channel's rows (decision 0049); absent, `RETENTION_DAYS`. */
  readonly cacheDays?: number;
  refreshKnown(): Promise<void>;
  /** `before`: the chat's oldest cached message, the anchor WhatsApp's on-demand history needs (P141 verdict 1). */
  history(chatId: string, o: { since: Date; before?: { id: string; fromMe: boolean; at: Date } | null }): Promise<InboundMessage[]>;
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
  await deps.repos.projects.requireProject(input.project);
  return linkAndImport(deps, input);
}

/** P131 O5: a chat's own Telegram username and phone as the account saw them (either may be unknown). */
export type ChatOwnIdentity = { username: string | null; phone: string | null };

/** The link itself, shared by the owner's Link and the Hub's autolink: the identifier, the known row, the waiting draft's client, then the import. */
async function linkAndImport(
  deps: { repos: Repos; adapter: LinkableAdapter; now?: () => Date },
  input: { project: string; clientId: number; chatId: string; title?: string; days?: number; autolinked?: string; identity?: ChatOwnIdentity },
): Promise<{ identifierId: number; imported: number; importError: string | null }> {
  const kind = KIND_OF[deps.adapter.channel];
  const value = normalizeIdentifier(kind, input.chatId);
  const identifierId = await deps.repos.messengers.addIdentifier(input.project, input.clientId, kind, value);
  // P131 O5: the chat keeps its own username and phone, so it opens in Telegram without the client's Notion card.
  await deps.repos.messengers.knowChat(input.project, deps.adapter.channel, value, { title: input.title ?? null, autolinked: input.autolinked ?? null, username: input.identity?.username ?? null, phone: input.identity?.phone ?? null });
  // P141 U4: a draft written before the link (the owner's reply in a chat that was not linked) now belongs to the client.
  await deps.repos.messengers.adoptChatDrafts(input.project, deps.adapter.channel, value, input.clientId);
  await deps.adapter.refreshKnown();
  const now = (deps.now ?? (() => new Date()))();
  // The link stands even when the import fails: new messages arrive anyway, and the poller's catch-up reads from its cursor.
  try {
    // The messages cached before the link stay (decision 0049 point 10); the import asks for what came before the oldest of them.
    const oldest = await deps.repos.messengers.oldestMessage(input.project, deps.adapter.channel, value);
    const before = oldest ? { id: oldest.remoteMessageId, fromMe: oldest.direction === "out", at: new Date(oldest.sentAt) } : null;
    const rows = await deps.adapter.history(value, { since: new Date(now.getTime() - (input.days ?? IMPORT_DAYS) * 86_400_000), before });
    const r = await ingest({ project: input.project, repos: deps.repos, now: () => now, ...(deps.adapter.cacheDays ? { retentionDays: deps.adapter.cacheDays } : {}) }, rows);
    return { identifierId, imported: r.stored, importError: null };
  } catch (e) {
    return { identifierId, imported: 0, importError: e instanceof Error ? e.message : "the import failed" };
  }
}

/** Refuses before any row is written when the chat is already another client's identifier (rule 16: a client row is never deleted). */
async function refuseTaken(repos: Repos, project: string, channel: LinkableAdapter["channel"], chatId: string): Promise<void> {
  const kind = KIND_OF[channel];
  if ((await repos.messengers.clientByIdentifier(project, kind, normalizeIdentifier(kind, chatId))) !== null) {
    throw new MessengersError("bad_identifier", `bad_identifier: this ${kind} chat is already linked to a client in "${project}"`);
  }
}

/**
 * A client record the autolink or the owner picked (P84, P141 C3): its Notion card, its name and its email when it has one. The
 * card is the client's key in Notion; the email is not required (decision 0049: a client is reachable by any one identity).
 */
export interface AutolinkClient {
  pageId: string | null;
  email: string | null;
  name: string;
}

/**
 * The Hub's client row for a record (decision 0009 as amended: a row from a link, never a bulk copy): found by its Notion card,
 * else by its email, else made, with the name, the email when there is one and the card. A row found by its email that has no card
 * yet takes it. P141 C3.
 */
export async function ensureClient(repos: Repos, project: string, client: AutolinkClient): Promise<{ id: number; created: boolean }> {
  const email = client.email ? normalizeIdentifier("email", client.email) : null;
  const byPage = client.pageId ? await repos.clients.findByNotionPage(project, client.pageId) : undefined;
  const found = byPage ?? (email ? await repos.clients.findByIdentity(project, "email", email) : undefined);
  if (found !== undefined) {
    if (client.pageId && byPage === undefined) await repos.clients.setNotionPage(project, found, client.pageId);
    return { id: found, created: false };
  }
  const name = client.name.trim() || email || "Unnamed client";
  return { id: await repos.clients.create({ project, email, name, notionPageId: client.pageId }), created: true };
}

/**
 * The Hub's own link (P84, decision 0036 point 3 as amended 2026-11-20 on the owner's delegated word): when a connected account
 * sees a private dialog whose phone or username equals the identifier of exactly ONE client record, and the project's
 * `messengers.autolink` is on, the server links it without a click. Not a person's act, so no `HumanActor`: only the server's
 * autolink coordinator (`apps/server/src/messengers/autolink/autolink.ts`) calls it, after it checked the setting, the refusals and the match. It ensures
 * the client's row (a row from a link, decision 0009 as amended: never a bulk copy), then links and imports like the owner's Link.
 */
export async function autoLinkUserChat(
  deps: { repos: Repos; adapter: LinkableAdapter; now?: () => Date },
  input: { project: string; client: AutolinkClient; chatId: string; reason: string; title?: string; days?: number; identity?: ChatOwnIdentity },
): Promise<{ clientId: number; clientCreated: boolean; identifierId: number; imported: number; importError: string | null }> {
  await deps.repos.projects.requireProject(input.project);
  await refuseTaken(deps.repos, input.project, deps.adapter.channel, input.chatId);
  const { id: clientId, created } = await ensureClient(deps.repos, input.project, input.client);
  const r = await linkAndImport(deps, { project: input.project, clientId, chatId: input.chatId, autolinked: input.reason, ...(input.title ? { title: input.title } : {}), ...(input.days ? { days: input.days } : {}), ...(input.identity ? { identity: input.identity } : {}) });
  return { clientId, clientCreated: created, ...r };
}

/**
 * The owner's Link of a chat to a client record of the directory (P84: the Chats screen's suggestion or his choice), behind the admin
 * gate. The same as the autolink's but a person's act: no reason is recorded on the chat.
 */
export async function linkUserChatToRecord(
  deps: { repos: Repos; adapter: LinkableAdapter; now?: () => Date },
  actor: HumanActor,
  input: { project: string; client: AutolinkClient; chatId: string; title?: string; identity?: ChatOwnIdentity },
): Promise<{ clientId: number; identifierId: number; imported: number; importError: string | null }> {
  assertHuman(actor);
  await deps.repos.projects.requireProject(input.project);
  await refuseTaken(deps.repos, input.project, deps.adapter.channel, input.chatId);
  const { id: clientId } = await ensureClient(deps.repos, input.project, input.client);
  const r = await linkAndImport(deps, { project: input.project, clientId, chatId: input.chatId, ...(input.title ? { title: input.title } : {}), ...(input.identity ? { identity: input.identity } : {}) });
  return { clientId, ...r };
}

/**
 * P102 Change client: a linked chat moves to another client record (a wrong match is the common reason). Only the identifier
 * moves, so the chat's stored messages stay (they are keyed by chat, not by client); the open draft written for the old client is
 * set aside (Skip, so it can come back), and the new client's row is ensured as the owner's Link does (decision 0009). Nothing is
 * imported and nothing is deleted. A bot chat has no identifier and is refused by the caller.
 */
export async function moveChatToRecord(
  repos: Repos,
  actor: HumanActor,
  input: { project: string; channel: LinkableAdapter["channel"]; chatId: string; client: AutolinkClient },
): Promise<{ fromClientId: number; toClientId: number; skippedDraftId: number | null }> {
  assertHuman(actor);
  await repos.projects.requireProject(input.project);
  const kind = KIND_OF[input.channel];
  const value = normalizeIdentifier(kind, input.chatId);
  const from = await repos.messengers.clientByIdentifier(input.project, kind, value);
  if (from === null) throw new MessengersError("bad_identifier", `bad_identifier: this ${kind} chat is not linked to a client in "${input.project}"`);
  const byPage = input.client.pageId ? await repos.clients.findByNotionPage(input.project, input.client.pageId) : undefined;
  const found = byPage ?? (input.client.email ? await repos.clients.findByIdentity(input.project, "email", input.client.email) : undefined);
  if (found === from) throw new MessengersError("bad_identifier", "bad_identifier: this chat is already linked to that client");
  const to = found ?? (await ensureClient(repos, input.project, input.client)).id;
  await repos.messengers.moveIdentifier(input.project, kind, value, to);
  const open = (await repos.messengers.listDrafts(input.project, ["draft"])).find((d) => d.channel === input.channel && d.chatId === value);
  if (open) await repos.messengers.discardDraft(input.project, open.id);
  return { fromClientId: from, toClientId: to, skippedDraftId: open?.id ?? null };
}

/** The Undo of `moveChatToRecord`: the chat goes back to the client row it left, and the draft that was set aside waits again (when it still can). */
export async function undoMoveChat(
  repos: Repos,
  actor: HumanActor,
  input: { project: string; channel: LinkableAdapter["channel"]; chatId: string; clientId: number; draftId: number | null },
): Promise<{ draftRestored: boolean }> {
  assertHuman(actor);
  const kind = KIND_OF[input.channel];
  const value = normalizeIdentifier(kind, input.chatId);
  if ((await repos.messengers.moveIdentifier(input.project, kind, value, input.clientId)) === null) throw new MessengersError("bad_identifier", `bad_identifier: this ${kind} chat is not linked to a client in "${input.project}"`);
  if (input.draftId === null) return { draftRestored: false };
  try {
    await repos.messengers.restoreDraft(input.project, input.draftId);
    return { draftRestored: true };
  } catch (e) {
    // The owner already acted on it (or it is gone): the move is undone, the draft is not.
    if (e instanceof RepoError) return { draftRestored: false };
    throw e;
  }
}
export { addClientEmail } from "./client-email";
