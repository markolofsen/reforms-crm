import { FOLLOW_UP_PREFETCH_MESSAGES } from "@hub/config/follow-ups";
import type { DueClient, Repos } from "@hub/db";
import type { ProjectConfig } from "@hub/projects/model";
import { clientBrand } from "@hub/agent/drafts/booking";
import { bookingFor, bookingOffers } from "@hub/projects/brands";
import { bookingLine } from "../passes/prefetch";
import type { ConversationMail } from "../mail/context";
import { LABEL_MAILBOXES } from "../mail/inbound";

// The prefetch of one sweep turn (decision 0050 point 3, P142 verdict 5): the client's last 30 messages across Mail and the
// linked chats, the plan and its dated lines, the Notion facts the server holds in memory, and our last Mail message's ids (what a
// Mail nudge replies to), rendered as the prompt's data block. The turn then needs no Mail reader. Nothing here writes.

export interface PrefetchDeps {
  repos: Repos;
  project: (slug: string) => ProjectConfig | undefined;
  /** The server's Mail reader (absent, or Mail closed: the block says so and the turn decides from the chats and the plan). */
  mail?: ConversationMail | undefined;
  /** The Notion facts of the client's card the server's directory holds (Relationship, the CRM's Follow-up on, Do not follow up). */
  notionFacts?: ((project: string, c: { email: string | null; pageId: string | null }) => string[]) | undefined;
}

/** `full`: the uncut text (P155 counts a booking link there: the sentence sits at the end of a body that `text` may cut). */
type Line = { at: string; who: "us" | "them"; via: string; text: string; full?: string };

const cut = (s: string, n: number) => s.replace(/\s+/g, " ").trim().slice(0, n);

/** Our newest Mail message's ids as `draft_write` takes them (kind reply, `message`), when Mail was read. */
export type MailRef = { account: string; mailbox_path: string[]; message_id: number } | null;

async function mailLines(d: PrefetchDeps, slug: string, c: DueClient): Promise<{ lines: Line[]; ref: MailRef; note: string | null }> {
  const cfg = d.project(slug)?.mail;
  if (!c.email || !cfg) return { lines: [], ref: null, note: c.email ? "this project has no Mail settings" : "the client has no email" };
  if (!d.mail) return { lines: [], ref: null, note: "this server does not read Mail" };
  const drafts = await d.repos.drafts.ofClient(slug, c.clientId);
  const read = await d.mail.history({ accounts: cfg.accounts, inboundBoxes: [...cfg.mailboxes, ...LABEL_MAILBOXES], sentMailbox: cfg.sentMailbox, address: c.email, subjects: drafts.map((x) => x.subject) }).catch((e: unknown) => ({ note: e instanceof Error ? e.message : String(e) }));
  if ("note" in read) return { lines: [], ref: null, note: cut(read.note, 200) };
  const msgs = [...read.messages].sort((a, b) => a.date.localeCompare(b.date)).slice(-FOLLOW_UP_PREFETCH_MESSAGES);
  const lines: Line[] = [];
  for (const m of msgs) {
    const t = await d.mail.text({ account: m.account, mailbox: m.mailbox, mailId: m.mailId }).catch(() => ({ note: "unreadable" }));
    lines.push({ at: m.date, who: m.ours ? "us" : "them", via: "Mail", text: "text" in t ? cut(t.text, 1_200) : `(${t.note}) subject: ${cut(m.subject, 120)}`, ...("text" in t ? { full: t.text } : {}) });
  }
  const ours = msgs.filter((m) => m.ours).at(-1);
  return { lines, ref: ours ? { account: ours.account, mailbox_path: ours.mailbox.split("/"), message_id: ours.mailId } : null, note: null };
}

/** The data block of one turn and our last Mail message's ids. */
export async function prefetch(d: PrefetchDeps, slug: string, c: DueClient): Promise<{ context: string; mailRef: MailRef }> {
  const mail = await mailLines(d, slug, c);
  const chats: Line[] = [];
  for (const ch of c.chats) {
    const rows = await d.repos.messengers.messagesOf(slug, [{ channel: ch.channel, chatId: ch.chatId }], { limit: FOLLOW_UP_PREFETCH_MESSAGES });
    for (const m of rows) chats.push({ at: m.sentAt, who: m.direction === "out" ? "us" : "them", via: `${ch.channel} chat:${ch.id}`, text: cut(m.text || `(${m.kind})`, 1_200), full: m.text ?? "" });
  }
  const all = [...mail.lines, ...chats].sort((a, b) => a.at.localeCompare(b.at)).slice(-FOLLOW_UP_PREFETCH_MESSAGES);
  const plan = await d.repos.followUps.get(slug, c.clientId);
  const lines = await d.repos.followUps.lines(slug, c.clientId);
  const client = await d.repos.clients.get(slug, c.clientId);
  const notion = d.notionFacts?.(slug, { email: c.email ?? client?.email ?? null, pageId: null }) ?? [];
  // P155 verdict 3: offered already in what WE wrote (mail and chats): a nudge may repeat the link once, never more.
  const cfg = d.project(slug);
  const booking = cfg ? bookingFor(cfg, await clientBrand(d.repos, slug, c.clientId, cfg), bookingOffers([...mail.lines, ...chats].filter((l) => l.who === "us").map((l) => l.full ?? l.text), cfg), { followUp: true }) : null;
  const out = [
    `Client ${c.clientId}: ${cut(c.name, 120)}${c.email ? ` <${c.email}>` : ""}.`,
    `Our last message: ${c.ourLastAt} on ${c.lastChannel}. Their last: ${c.theirLastAt ?? "never"}.`,
    `Linked chats: ${c.chats.length ? c.chats.map((x) => `chat:${x.id} ${x.channel} (reply mode ${x.replyMode})`).join(", ") : "none"}.`,
    mail.ref ? `Our last Mail message, what a Mail nudge replies to (draft_write kind reply, message): ${JSON.stringify(mail.ref)}.` : `No Mail message of ours to reply to${mail.note ? ` (${mail.note})` : ""}.`,
    plan ? `The plan: ${plan.state}, next ${plan.nextAt ?? "none"}, ${plan.nudgesSent} nudge(s) sent${plan.lastNudgeAt ? `, the last ${plan.lastNudgeAt}` : ""}, waiting on ${plan.waitingOn ?? "?"}, by ${plan.decidedBy}: ${plan.reason ?? ""}.` : "No plan yet: this is the first sweep for this client.",
    ...(lines.length ? ["Earlier decisions:", ...lines.map((l) => `- ${l.at.slice(0, 10)} ${l.line ?? l.summary}`)] : []),
    ...(notion.length ? ["Notion card:", ...notion.map((n) => `- ${n}`)] : []),
    ...(booking ? [bookingLine(booking)] : []),
    `The history, oldest first (${all.length} message${all.length === 1 ? "" : "s"}):`,
    ...all.map((l) => `[${l.at}] ${l.who === "us" ? "WE" : "THEY"} via ${l.via}: ${l.text}`),
  ];
  return { context: out.join("\n"), mailRef: mail.ref };
}
