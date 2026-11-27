import type { PublicReplySender } from "./public-reply";
import { unresolvedMarkers } from "@hub/config";
import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { AUTOPILOT_ACCOUNT_SHARE } from "@hub/config/autopilot";
import { RepoError, usageRefusal, type MessengerChannel, type Repos, type SendRow } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";
import { AdapterError, type SendingAdapter } from "./adapter";
import { actorOf, mintAuthorization, referenceOf, textHash, type MessengerAuthority, type SendAuthorization } from "./authorization";
import { confirmDraft, sendConfirmed } from "./send-confirmed";

export type { MessengerAuthority } from "./authorization";

// The send door for one messenger draft (P71 M4, decision 0036 point 7; P126 D1 moved it from the server next to its send; P112 S2
// split it into stages). The same door as Mail's (`routes/sends.ts`): a dry run that sends nothing and says exactly what would go
// out, then the apply. Its own guards, because a user account is the owner's personal account: the project is active, the chat
// has an inbound message (the hub never makes first contact), a daily cap and a spacing per account, `draft.recipients: test`
// admits only `telegram:<id>` / `whatsapp:+<number>` entries of `allow_list`, and Stop sending stops it.
//
// The stages, each a function of its own, in this order, every one on fresh reads:
//   1. assessment (`assessMessenger`): every reason the draft may not go out now, and what would go out;
//   2. authorization (`authorize`): the caller's stated authority and confirmation against the assessment; mints the one
//      `SendAuthorization`, bound to the draft, the chat, the account, the text hash and the send-policy generation;
//   3. the final checks (`finalChecks`): the project's lifecycle and its policy generation read again, right before the row;
//   4. audit (`audit`): the `send_log` row first, its Stop sending, cap, spacing and one-reference-per-send re-checked in the write;
//   5. delivery (`deliver`): the confirm and the one send, each re-checking the authorization's text hash on the stored row; no retry.
// The ticket is not a stage here: it proves an `owner_click` and is taken by the route before the door is called. Who may ask
// is `MessengerAuthority` (`./authorization.ts`): the owner's click, the agent on the owner's word (decision 0046), or the
// server's autopilot in a chat the owner switched on (decision 0048), never a default. All pass the same five stages; the
// autopilot's audit row is also held to its share of the account. The door knows no session mode, so a session's
// deny lists (which bind the model's processes) do not reach it.

/** The live send of each connected account, from the server's supervisors; nothing else holds one. */
export interface MessengerSenders {
  sender(channel: MessengerChannel, account: string): SendingAdapter | undefined;
  /** Decision 0061: a separate public target capability, still held only by this door. */
  publicSender?(account: string): PublicReplySender | undefined;
  /** A send Telegram or WhatsApp refused with a park (logged out, banned, a long flood wait): the supervisor parks the account. */
  failed?(channel: MessengerChannel, account: string, err: AdapterError): Promise<void>;
}

/** What the door needs to know of a project (P126 D1, P112 S2: passed in by composition, so this package reads no project file). */
export interface MessengerProjectPolicy {
  /** Null while the project may send (its status is active), else the owner's sentence why not (paused, archived, unreadable). */
  lifecycle: string | null;
  /** The send policy's generation (its file's stamp, `default` without one): a send is judged and committed under one. */
  generation: string;
  /** Null when `entry` (`telegram:<id>`, `whatsapp:+<number>`) is permitted, else the owner's sentence why not. */
  recipients(entry: string): string | null;
}

export interface MessengerDoorDeps {
  repos: Repos;
  /** The project's lifecycle, policy generation and recipients, read live on every call (never cached). */
  policy(project: string): MessengerProjectPolicy;
  senders?: MessengerSenders | undefined;
  now?: () => Date;
}

const KIND = { telegram_bot: "telegram", telegram_user: "telegram", whatsapp: "whatsapp" } as const;
const WORD: Record<MessengerChannel, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };
const LIMITS = { dailyCap: MESSENGER_DAILY_CAP, spacingSeconds: MESSENGER_SPACING_SECONDS };
/** The audit stage's limits for an authority: autopilot's sends also stop at its share of the account (verdict 11). */
const limitsOf = (a: MessengerAuthority) => (a.kind === "autopilot" ? { ...LIMITS, actorCap: AUTOPILOT_ACCOUNT_SHARE } : LIMITS);
const log = ops("send");

export interface MessengerAssessment {
  reasons: string[];
  preview: { channel: MessengerChannel; chatId: string; account: string; to: string; text: string } | null;
  /** What an authorization of this assessment is bound to: the text's hash and the policy generation it was judged under. */
  bound: { textHash: string; policyGeneration: string } | null;
}

const STATE_WORDS: Record<string, string> = {
  confirmed: "it is being sent right now",
  sent: "it was sent already",
  copied: "it was copied to be sent by hand",
  discarded: "it was skipped",
};

/** Who the chat is: the linked client, else the chat's title, else its id (as the panel names it). */
async function nameOf(repos: Repos, project: string, clientId: number | null, chatId: string, title: string | null): Promise<string> {
  const client = clientId === null ? null : await repos.clients.get(project, clientId);
  return client?.name || client?.email || title || `chat ${chatId}`;
}

/** The account that reads the chat: the chat row's `account` (decision 0049, it outlives the cache), else the newest inbound row's. */
async function accountOf(repos: Repos, project: string, channel: MessengerChannel, chatId: string): Promise<string | null> {
  const stored = (await repos.messengers.chat(project, channel, chatId))?.account;
  if (stored) return stored;
  const rows = await repos.messengers.messagesOf(project, [{ channel, chatId }], { limit: 50 });
  return (rows.find((m) => m.direction === "in") ?? rows[0])?.account ?? null;
}

/**
 * Stage 1, the assessment: every reason the draft may not go out now, in the owner's words, and what would go out when there is
 * none. The dry run shows it; the apply runs it again on fresh reads. Null when the draft is not this project's (the route's 404).
 */
export async function assessMessenger(deps: MessengerDoorDeps, project: string, draftId: number): Promise<MessengerAssessment | null> {
  const { repos } = deps;
  const d = await repos.messengers.getDraft(project, draftId);
  if (!d) return null;
  const reasons: string[] = [];
  const at = (deps.now ?? (() => new Date()))().toISOString();
  const policy = deps.policy(project);
  if (policy.lifecycle) reasons.push(policy.lifecycle);
  if (d.status !== "draft") reasons.push(`the draft does not wait any more: ${STATE_WORDS[d.status] ?? d.status}`);
  if (!d.text.trim()) reasons.push("the draft text is empty");
  // The mail door's rule (3i P1) at this door too (2026-11-25: a WhatsApp reply went out with "[Owner: …]" in it): a placeholder
  // the owner did not fill never goes out, whoever sends (his click, his word, autopilot).
  const left = unresolvedMarkers(d.text);
  if (left.length) reasons.push(`a placeholder is left in the text: ${left[0]}`);
  const chat = await repos.messengers.chat(project, d.channel, d.chatId);
  // Decision 0049 point 7: the door needs a known chat, not a linked one; a hidden or forgotten chat has no row.
  if (!chat) reasons.push("the chat is no longer known to the Hub (hidden or forgotten)");
  // Decision 0049 (P141 W4): the chat row's `last_inbound_at` is the proof, so a pruned cache does not turn a reply into first contact.
  else if ((await repos.messengers.activity(project, d.channel, d.chatId)).lastInAt === null) reasons.push("nobody wrote in this chat yet: the hub never makes the first contact");
  // Provenance: a draft written for one client never goes to a chat that now belongs to another (Change client, P102).
  const linked = await repos.messengers.clientByIdentifier(project, KIND[d.channel], d.chatId);
  if (d.clientId !== null && linked !== null && linked !== d.clientId) reasons.push("the chat was moved to another client after this draft was written: write the reply again for the new client");
  if (await repos.sends.isStopped(project)) reasons.push("Stop sending is on");

  const refusedRecipient = policy.recipients(`${KIND[d.channel]}:${d.chatId}`);
  if (refusedRecipient) reasons.push(refusedRecipient);

  const account = await accountOf(repos, project, d.channel, d.chatId);
  if (!account) reasons.push("no stored message tells which account reads this chat");
  else {
    if (!deps.senders?.sender(d.channel, account)) reasons.push(`the ${WORD[d.channel]} account ${account} is not connected (Settings ▸ Messengers)`);
    const refused = usageRefusal(await repos.sends.messengerUsage(d.channel, account, at), LIMITS, at);
    if (refused) reasons.push(refused);
  }
  const to = await nameOf(repos, project, linked ?? d.clientId, d.chatId, chat?.title ?? chat?.profileName ?? null);
  return {
    reasons,
    preview: account ? { channel: d.channel, chatId: d.chatId, account, to, text: d.text } : null,
    bound: { textHash: textHash(d.text), policyGeneration: policy.generation },
  };
}

type Refused = { refused: string[] };
type Preview = NonNullable<MessengerAssessment["preview"]>;

/**
 * Stage 2, the authorization: the caller's confirmation (the chat and the exact text it saw, or, for the agent and a future server
 * authority, the draft's own) must be what the assessment found, and the assessment must have no reason left. Mints the one value
 * the confirm and the send accept.
 */
function authorize(a: MessengerAssessment, project: string, draftId: number, confirm: { chatId: string; text: string }, authority: MessengerAuthority): { auth: SendAuthorization; preview: Preview } | Refused {
  const changed = a.preview && a.bound && (a.preview.chatId !== confirm.chatId || a.bound.textHash !== textHash(confirm.text));
  const reasons = [...(changed ? ["the draft changed after you read it: read it again and press Send again"] : []), ...a.reasons];
  if (reasons.length || !a.preview || !a.bound) return { refused: reasons.length ? reasons : ["nothing to send"] };
  const p = a.preview;
  return { preview: p, auth: mintAuthorization({ authority, project, draftId, channel: p.channel, chatId: p.chatId, account: p.account, textHash: a.bound.textHash, policyGeneration: a.bound.policyGeneration }) };
}

/** Stage 3, the final checks: right before the row, the project is still active and its send policy is the one the send was judged under. */
function finalChecks(deps: MessengerDoorDeps, auth: SendAuthorization): Refused | null {
  const policy = deps.policy(auth.project);
  if (policy.lifecycle) return { refused: [policy.lifecycle] };
  if (policy.generation !== auth.policyGeneration) return { refused: ["the project's send policy changed while this send was checked: check it again"] };
  return null;
}

/** Stage 4, the audit: the `send_log` row first; its write re-checks Stop sending, the cap, the spacing and the one-time reference. */
async function audit(deps: MessengerDoorDeps, auth: SendAuthorization, p: Preview): Promise<{ row: SendRow } | Refused> {
  const at = (deps.now ?? (() => new Date()))().toISOString();
  try {
    const row = await deps.repos.sends.beginMessage({ project: auth.project, channel: auth.channel, messengerDraftId: auth.draftId, account: auth.account, to: `${KIND[auth.channel]}:${auth.chatId}`, name: p.to, text: p.text, actor: actorOf(auth.authority), at, limits: limitsOf(auth.authority), ownerWord: referenceOf(auth.authority) });
    return { row };
  } catch (e) {
    if (e instanceof RepoError) return { refused: [e.message] };
    throw e;
  }
}

/** Stage 5, the delivery: the confirm and the one send, on the authorization. A failure is recorded on the row and the draft waits again; nothing is retried. */
async function deliver(deps: MessengerDoorDeps, auth: SendAuthorization, row: SendRow, adapter: SendingAdapter): Promise<MessengerApply> {
  const { repos } = deps;
  const at = (deps.now ?? (() => new Date()))().toISOString();
  try {
    await confirmDraft(repos, auth, { at });
    const receipt = await sendConfirmed({ repos, adapter, ...(deps.now ? { now: deps.now } : {}) }, auth);
    await repos.sends.markSent(row.id, receipt.remoteMessageId);
    // P142 verdict 11: the chat's `last_outbound_at`, a reopened plan and a nudge's count; bookkeeping, never a reason to fail the send.
    await repos.followUps.messengerSent(auth.project, auth.draftId, at).catch((e: unknown) => log.error("messenger door: the follow-up record failed; the message was sent", { project: auth.project, messengerDraft: auth.draftId, ...errFields(e) }));
    log.info("messenger door: sent", { project: auth.project, messengerDraft: auth.draftId, actor: actorOf(auth.authority), channel: auth.channel, account: auth.account, send: row.id });
    return { sendId: row.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    log.error("messenger door: the send failed; nothing was retried", { project: auth.project, messengerDraft: auth.draftId, actor: actorOf(auth.authority), channel: auth.channel, account: auth.account, send: row.id, ...errFields(e) });
    await repos.sends.markFailed(row.id, message);
    const cur = await repos.messengers.getDraft(auth.project, auth.draftId);
    if (cur?.status === "confirmed") await repos.messengers.unconfirmDraft(auth.project, auth.draftId);
    if (e instanceof AdapterError) await deps.senders?.failed?.(auth.channel, auth.account, e);
    return { failed: message, sendId: row.id };
  }
}

export type MessengerApply = { sendId: number } | { refused: string[] } | { failed: string; sendId: number } | null;

/**
 * The final door: the five stages in order, every one on fresh reads. `authority` is required: every caller states who asks
 * (the owner's click after the route took his ticket, or decision 0046's owner word the agent-send route verified). Every
 * outcome is one ops line (P137: it carries the request's action id): refused with its stage, sent, or failed.
 */
export async function applyMessenger(deps: MessengerDoorDeps, project: string, draftId: number, confirm: { chatId: string; text: string }, authority: MessengerAuthority): Promise<MessengerApply> {
  if (authority.kind === "watch_review") return { refused: ["a public reply authority cannot send a private messenger draft"] };
  const what = { project, messengerDraft: draftId, actor: actorOf(authority) };
  const refuse = (stage: string, r: Refused): Refused => {
    log.warn("messenger door: refused", { ...what, stage, reasons: r.refused });
    return r;
  };
  const a = await assessMessenger(deps, project, draftId);
  if (!a) return null;
  const granted = authorize(a, project, draftId, confirm, authority);
  if ("refused" in granted) return refuse("assessment", granted);
  const { auth, preview } = granted;
  const late = finalChecks(deps, auth);
  if (late) return refuse("final", late);
  const adapter = deps.senders?.sender(auth.channel, auth.account);
  if (!adapter) return refuse("final", { refused: [`the ${WORD[auth.channel]} account ${auth.account} is not connected (Settings ▸ Messengers)`] });
  const row = await audit(deps, auth, preview);
  if ("refused" in row) return refuse("audit", row);
  return deliver(deps, auth, row.row, adapter);
}

// Decision 0061: the public target specialization uses this door\'s authority mint and shared transactional account audit.
export { applyPublicReply, reconcilePublicReply, proposePublicReply, publicReplyHashes, type PublicReplyDoorDeps, type PublicReplyPolicy } from "./public-door";
export type { PublicReplySnapshot, PublicReplySender, PublicReplyReceipt } from "./public-reply";
