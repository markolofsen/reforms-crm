import { bareId, FS, list, localStamp, records } from "./records";
import type { OsaRun } from "./osa";
import { ACCOUNTS_SCRIPT, CONTENT_SCRIPT, INBOUND_SCRIPT, RUNNING_SCRIPT, SENT_SCRIPT } from "./scripts/read";

// The Hub's read-only questions to Apple Mail (decision 0026), through `osascript` behind an injectable `OsaRun`: is Mail
// running, what is in an account's Sent mailbox since a date, which accounts Mail has, and (P96, the Mail reader) what
// arrived in an inbound mailbox since a date and the text of one of those messages. Nothing here launches Mail (each caller
// asks `mailRunning` first), writes, moves or sends. Moved from the server by P126 M1.

/** One message of a Sent mailbox, as the matcher needs it. Ids are bare (no angle brackets, lower case). */
export interface SentMessage {
  messageId: string;
  inReplyTo: string | null;
  /** ISO 8601 UTC. */
  date: string;
  to: string[];
  cc: string[];
  subject: string;
  account: string;
  /** P90: the References header's ids, bare (empty when absent). */
  references: string[];
  /** P90: the sender as Mail shows it (`Name <address>`), or empty. */
  from: string;
}

export async function mailRunning(osa: OsaRun): Promise<boolean> {
  return (await osa(RUNNING_SCRIPT, [])).trim() === "true";
}

export function parseSent(out: string, account: string): SentMessage[] {
  const msgs: SentMessage[] = [];
  for (const rec of records(out)) {
    const [id = "", irt = "", stamp = "", to, cc, subject = "", refs = "", from = ""] = rec.split(FS);
    const date = localStamp(stamp.trim());
    if (!bareId(id) || !date) continue;
    const references = [...refs.matchAll(/<([^<>\s]+)>/g)].map((x) => bareId(x[1])).filter(Boolean);
    msgs.push({ messageId: bareId(id), inReplyTo: bareId(irt) || null, date, to: list(to), cc: list(cc), subject, account, references, from: from.trim() });
  }
  return msgs;
}

/** The Sent mailbox of one account since `since` (local calendar parts are passed, so the script needs no date parsing). */
export async function readSent(osa: OsaRun, account: string, mailbox: string, since: Date): Promise<SentMessage[]> {
  const secs = since.getHours() * 3600 + since.getMinutes() * 60 + since.getSeconds();
  const args = [account, mailbox, String(since.getFullYear()), String(since.getMonth() + 1), String(since.getDate()), String(secs)];
  return parseSent(await osa(SENT_SCRIPT, args), account);
}

/** Mail's accounts: each name and address, lower case, in one list (what a project's `mail.accounts` may name). */
export function parseAccounts(out: string): string[] {
  const known: string[] = [];
  for (const rec of records(out)) {
    const [name = "", addrs] = rec.split(FS);
    if (name.trim()) known.push(name.trim().toLowerCase());
    known.push(...list(addrs));
  }
  return known;
}

/** The names and addresses Mail knows, or null when Mail is not running (it is never started for this). */
export async function readAccounts(osa: OsaRun): Promise<string[] | null> {
  if (!(await mailRunning(osa))) return null;
  return parseAccounts(await osa(ACCOUNTS_SCRIPT, []));
}

/** One message of an inbound mailbox, as the reader judges it. Ids bare. */
export interface ReceivedMessage {
  mailId: number;
  messageId: string;
  inReplyTo: string | null;
  references: string[];
  /** The sender's address, lower case, and the name Mail shows (empty when none). */
  email: string;
  name: string;
  /** ISO 8601 UTC. */
  receivedAt: string;
  subject: string;
  read: boolean;
  /** A bulk or automatic header was present (List-Unsubscribe, Auto-Submitted other than `no`, Precedence bulk/list/junk). */
  bulk: boolean;
  /** P145: the `X-Project-Key` header a site's lead notice carries (django_notion), as sent; null when absent. Trusted only from a notice sender. */
  projectKey: string | null;
  account: string;
  mailbox: string;
}

/** `Name <a@b>` or `a@b` into the address (lower case) and the name. */
export function senderOf(raw: string): { email: string; name: string } {
  const v = raw.trim();
  const m = /<([^<>\s]+@[^<>\s]+)>/.exec(v);
  const email = (m?.[1] ?? (/[^\s<>"]+@[^\s<>"]+/.exec(v)?.[0] ?? "")).trim().toLowerCase();
  const name = (m ? v.slice(0, m.index) : "").trim().replace(/^"|"$/g, "").trim();
  return { email, name };
}

const isBulk = (h: string): boolean => /\blist\b/.test(h) || /\bauto (?!no\b)\S/i.test(h) || /\bprec (bulk|list|junk)\b/i.test(h);

/** `null` when the mailbox does not exist in that account (a label the project never made): the reader skips it. */
export function parseInbound(out: string, account: string, mailbox: string): ReceivedMessage[] | null {
  if (out.trim() === "nobox") return null;
  const msgs: ReceivedMessage[] = [];
  const recs = records(out);
  for (const rec of recs[0]?.startsWith("ok") ? recs.slice(1) : recs) {
    const [id = "", mid = "", irt = "", refs = "", snd = "", stamp = "", subject = "", read = "", bulk = "", pkey = ""] = rec.split(FS);
    const receivedAt = localStamp(stamp.trim());
    const mailId = Number(id);
    const s = senderOf(snd);
    if (!bareId(mid) || !receivedAt || !Number.isInteger(mailId) || !s.email) continue;
    const references = [...refs.matchAll(/<([^<>\s]+)>/g)].map((x) => bareId(x[1])).filter(Boolean);
    msgs.push({ mailId, messageId: bareId(mid), inReplyTo: bareId(irt) || null, references, email: s.email, name: s.name, receivedAt, subject, read: read.trim() === "true", bulk: isBulk(bulk), projectKey: pkey.trim().slice(0, 80) || null, account, mailbox });
  }
  return msgs;
}

/** One mailbox of one account since `since` (local calendar parts, as `readSent`). `null`: no such mailbox. */
export async function readInbound(osa: OsaRun, account: string, mailbox: string, since: Date): Promise<ReceivedMessage[] | null> {
  const secs = since.getHours() * 3600 + since.getMinutes() * 60 + since.getSeconds();
  const args = [account, mailbox, String(since.getFullYear()), String(since.getMonth() + 1), String(since.getDate()), String(secs)];
  return parseInbound(await osa(INBOUND_SCRIPT, args), account, mailbox);
}

/** The text of one message, or null when Mail no longer has it there. */
export async function readMessageText(osa: OsaRun, account: string, mailbox: string, mailId: number): Promise<string | null> {
  const out = await osa(CONTENT_SCRIPT, [account, mailbox, String(mailId)]);
  const i = out.indexOf(FS);
  return out.startsWith("ok") && i >= 0 ? out.slice(i + 1) : null;
}

