import { MESSENGER_DAILY_CAP, MESSENGER_SPACING_SECONDS } from "@hub/config/chat-rules";
import { RepoError, usageRefusal, type MessengerChannel, type Repos } from "@hub/db";
import { AdapterError, type SendingAdapter } from "@hub/messengers";
import { confirmDraft, humanActor, sendConfirmed } from "@hub/messengers/human";
import { checkDraftRecipients, loadProject } from "@hub/projects";

// The send door for one messenger draft (P71 M4, decision 0036 point 7). The same door as Mail's (`routes/sends.ts`): a dry run
// that sends nothing and says exactly what would go out, then the apply with what the person saw and a single-use ticket, the
// `send_log` row first, one send, no retry. Its own guards, because a user account is the owner's personal account: the chat has an
// inbound message (the hub never makes first contact), a daily cap and a spacing per account, `draft.recipients: test` admits
// only `telegram:<id>` / `whatsapp:+<number>` entries of `allow_list`, and Stop sending stops it. Only this module mints the
// `HumanActor` and, through `confirmDraft`, the `ConfirmedDraft` of a messenger send; the agent has no path here.

/** The live send of each connected account, from the server's supervisors; nothing else holds one. */
export interface MessengerSenders {
  sender(channel: MessengerChannel, account: string): SendingAdapter | undefined;
  /** A send Telegram or WhatsApp refused with a park (logged out, banned, a long flood wait): the supervisor parks the account. */
  failed?(channel: MessengerChannel, account: string, err: AdapterError): Promise<void>;
}

export interface MessengerDoorDeps {
  repos: Repos;
  projectsDir: string;
  policyDir: string;
  allowList: string[];
  senders?: MessengerSenders | undefined;
  now?: () => Date;
}

const KIND = { telegram_bot: "telegram", telegram_user: "telegram", whatsapp: "whatsapp" } as const;
const WORD: Record<MessengerChannel, string> = { telegram_user: "Telegram", telegram_bot: "Telegram bot", whatsapp: "WhatsApp" };
const LIMITS = { dailyCap: MESSENGER_DAILY_CAP, spacingSeconds: MESSENGER_SPACING_SECONDS };
const ACTOR = "admin";

export interface MessengerAssessment {
  reasons: string[];
  preview: { channel: MessengerChannel; chatId: string; account: string; to: string; text: string } | null;
}

const STATE_WORDS: Record<string, string> = {
  confirmed: "it is being sent right now",
  sent: "it was sent already",
  copied: "it was copied to be sent by hand",
  discarded: "it was skipped",
};

/** Who the chat is: the linked client, else the chat's title, else its id (as the panel names it). */
async function nameOf(repos: Repos, project: string, channel: MessengerChannel, chatId: string, title: string | null): Promise<string> {
  const id = await repos.messengers.clientByIdentifier(project, KIND[channel], chatId);
  const client = id === null ? null : await repos.clients.get(project, id);
  return client?.name || client?.email || title || `chat ${chatId}`;
}

/** The account a chat's messages came through: the newest inbound row's (a chat is read by one account). */
async function accountOf(repos: Repos, project: string, channel: MessengerChannel, chatId: string): Promise<string | null> {
  const rows = await repos.messengers.messagesOf(project, [{ channel, chatId }], { limit: 50 });
  return (rows.find((m) => m.direction === "in") ?? rows[0])?.account ?? null;
}

/**
 * Every reason the draft may not go out now, in the owner's words, and what would go out when there is none. The dry run shows
 * it; the apply runs it again on fresh reads. Null when the draft is not this project's (the route's 404).
 */
export async function assessMessenger(deps: MessengerDoorDeps, project: string, draftId: number): Promise<MessengerAssessment | null> {
  const { repos } = deps;
  const d = await repos.messengers.getDraft(project, draftId);
  if (!d) return null;
  const reasons: string[] = [];
  const at = (deps.now ?? (() => new Date()))().toISOString();
  if (d.status !== "draft") reasons.push(`the draft does not wait any more: ${STATE_WORDS[d.status] ?? d.status}`);
  if (!d.text.trim()) reasons.push("the draft text is empty");
  const chat = await repos.messengers.chat(project, d.channel, d.chatId);
  if (!chat) reasons.push("the chat is no longer linked to a client");
  else if ((await repos.messengers.activity(project, d.channel, d.chatId)).inbound === 0) reasons.push("nobody wrote in this chat yet: the hub never makes the first contact");
  if (await repos.sends.isStopped(project)) reasons.push("Stop sending is on");

  try {
    const config = loadProject(deps.projectsDir, project, { policyDir: deps.policyDir }).parsed.config;
    const entry = `${KIND[d.channel]}:${d.chatId}`;
    if (!checkDraftRecipients(config, [entry], deps.allowList).ok) {
      reasons.push(config.draft.recipients === "test" ? `this project sends in test mode (draft.recipients: test) and ${entry} is not on allow_list in config/config.json` : `draft.recipients of ${project} does not permit ${entry}`);
    }
  } catch {
    reasons.push(`the project file of ${project} cannot be read, so who it may send to is unknown`);
  }

  const account = await accountOf(repos, project, d.channel, d.chatId);
  if (!account) reasons.push("no stored message tells which account reads this chat");
  else {
    if (!deps.senders?.sender(d.channel, account)) reasons.push(`the ${WORD[d.channel]} account ${account} is not connected (Messengers ▸ Settings)`);
    const refused = usageRefusal(await repos.sends.messengerUsage(d.channel, account, at), LIMITS, at);
    if (refused) reasons.push(refused);
  }
  const to = await nameOf(repos, project, d.channel, d.chatId, chat?.title ?? null);
  return { reasons, preview: account ? { channel: d.channel, chatId: d.chatId, account, to, text: d.text } : null };
}

export type MessengerApply = { sendId: number } | { refused: string[] } | { failed: string; sendId: number } | null;

/**
 * The apply: the guards again, the text the person saw against the draft's, the `send_log` row first (its guards re-checked in the
 * same write), then the one send. A failure is recorded on the row and the draft waits again; nothing is retried.
 */
export async function applyMessenger(deps: MessengerDoorDeps, project: string, draftId: number, confirm: { chatId: string; text: string }): Promise<MessengerApply> {
  const a = await assessMessenger(deps, project, draftId);
  if (!a) return null;
  const changed = a.preview && (a.preview.chatId !== confirm.chatId || a.preview.text !== confirm.text);
  const reasons = [...(changed ? ["the draft changed after you read it: read it again and press Send again"] : []), ...a.reasons];
  if (reasons.length || !a.preview) return { refused: reasons.length ? reasons : ["nothing to send"] };
  const p = a.preview;
  const adapter = deps.senders?.sender(p.channel, p.account);
  if (!adapter) return { refused: [`the ${WORD[p.channel]} account ${p.account} is not connected (Messengers ▸ Settings)`] };
  const { repos } = deps;
  const at = (deps.now ?? (() => new Date()))().toISOString();

  let row;
  try {
    row = await repos.sends.beginMessage({ project, channel: p.channel, messengerDraftId: draftId, account: p.account, to: `${KIND[p.channel]}:${p.chatId}`, name: p.to, text: p.text, actor: ACTOR, at, limits: LIMITS });
  } catch (e) {
    if (e instanceof RepoError) return { refused: [e.message] };
    throw e;
  }
  const human = humanActor(ACTOR);
  try {
    await confirmDraft(repos, human, { project, draftId, at });
    const receipt = await sendConfirmed({ repos, adapter, ...(deps.now ? { now: deps.now } : {}) }, human, { project, draftId });
    await repos.sends.markSent(row.id, receipt.remoteMessageId);
    return { sendId: row.id };
  } catch (e) {
    const message = e instanceof Error ? e.message : String(e);
    await repos.sends.markFailed(row.id, message);
    const cur = await repos.messengers.getDraft(project, draftId);
    if (cur?.status === "confirmed") await repos.messengers.unconfirmDraft(project, draftId);
    if (e instanceof AdapterError) await deps.senders?.failed?.(p.channel, p.account, e);
    return { failed: message, sendId: row.id };
  }
}
