import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import type { DraftStatus, Mark, NotionRef } from "@hub/config";
import type { Repos } from "./repos";

// Invented data only. Senders, subjects and dates come from `app/packages/db/fixtures/*.eml` (moved from the deleted mail package, P48)
// (invented mail); everything else here is made up. No real client is read.

const here = dirname(fileURLToPath(import.meta.url));
export const defaultFixturesDir = resolve(here, "../fixtures");

export type FixtureMail = { name: string; email: string; subject: string; date: string };

function decodeWords(s: string): string {
  return s.replace(/=\?utf-8\?b\?([^?]+)\?=/gi, (_, b64: string) => Buffer.from(b64, "base64").toString("utf8"));
}

/** Reads From / Subject / Date from the header block of every .eml; later files do not repeat a sender. */
export function readFixtures(dir: string = defaultFixturesDir): FixtureMail[] {
  if (!existsSync(dir)) return [];
  const seen = new Set<string>();
  const out: FixtureMail[] = [];
  for (const file of readdirSync(dir).filter((f) => f.endsWith(".eml")).sort()) {
    const head = readFileSync(join(dir, file), "utf8").split(/\r?\n\r?\n/, 1)[0] ?? "";
    const h = (k: string) => decodeWords(new RegExp(`^${k}:\\s*(.+(?:\\r?\\n[ \\t].+)*)`, "im").exec(head)?.[1]?.replace(/\r?\n[ \t]+/g, " ") ?? "");
    const from = /^(.*?)\s*<([^>]+)>$/.exec(h("From").trim());
    if (!from?.[2] || seen.has(from[2])) continue;
    seen.add(from[2]);
    const date = new Date(h("Date"));
    out.push({
      name: from[1]?.replace(/^"|"$/g, "") || from[2],
      email: from[2],
      subject: h("Subject").replace(/^((re|fwd?|aw):\s*)+/i, ""),
      date: Number.isNaN(date.getTime()) ? new Date().toISOString() : date.toISOString(),
    });
  }
  return out;
}

type Spec = {
  name: string;
  email: string;
  owed: boolean;
  daysSilent: number;
  subject: string;
  status?: DraftStatus; // undefined = no draft yet
  checked?: boolean;
  marks?: Mark[];
  safety?: string;
  /** For a done or sent draft: how many days ago our message went out (actedAt or sentAt), so follow-ups have an anchor (P47). */
  outDaysAgo?: number;
};

const EXTRA_LISBON: Spec[] = [
  { name: "Marta Ficticia", email: "marta@example.net", owed: true, daysSilent: 6, subject: "Terms for the Alfama building", status: "ready", marks: ["vip"] },
  { name: "Pedro Exemplo", email: "pedro@example.org", owed: true, daysSilent: 3, subject: "Second viewing", status: "ready" },
  { name: "Sofia Teste", email: "sofia@example.com", owed: false, daysSilent: 19, subject: "Any news on the offer?", status: "ready", marks: ["follow_up"] },
  { name: "Luis Prova", email: "luis@example.net", owed: true, daysSilent: 2, subject: "Parking and storage", status: "hold", safety: "Price of the storage room is not in the file; confirm with the owner first." },
  { name: "Ines Modelo", email: "ines@example.org", owed: false, daysSilent: 11, subject: "Keys handover", status: "done", checked: true, outDaysAgo: 9 },
  { name: "Tiago Amostra", email: "tiago@example.com", owed: false, daysSilent: 30, subject: "Thanks for the call", status: "sent", checked: true, outDaysAgo: 25 },
  { name: "Rita Falsa", email: "rita@example.net", owed: false, daysSilent: 8, subject: "Notary dates" },
  { name: "Nuno Ensaio", email: "nuno@example.org", owed: true, daysSilent: 1, subject: "Floor plan", status: "ready", marks: ["do_not_contact"], safety: "Marked do not contact: do not send before the owner lifts the mark." },
];

const EXTRA_DEMO: Spec[] = [
  { name: "Anna Fake", email: "anna@example.com", owed: true, daysSilent: 4, subject: "Order status", status: "ready" },
  { name: "Kim Placeholder", email: "kim@example.net", owed: false, daysSilent: 14, subject: "Annual contract", status: "hold", safety: "Contract value differs from the last invoice." },
  { name: "Oskar Muster", email: "oskar@example.org", owed: true, daysSilent: 5, subject: "Refund question", status: "ready", checked: true },
];

const firstName = (n: string) => n.split(/\s+/)[0] ?? n;
const daysAgo = (now: Date, d: number) => new Date(now.getTime() - d * 86_400_000).toISOString();
const plusSeconds = (iso: string, s: number) => new Date(new Date(iso).getTime() + s * 1000).toISOString();
const bodyFor = (name: string, subject: string) =>
  `Hi ${firstName(name)},\n\nThank you for your message about "${subject}". I have checked the details and will confirm the next step by the end of the day.\n\nBest regards,\nMark`;

/** Fills an empty database with invented data for two projects. No-op when clients exist. */
export async function seed(repos: Repos, opts: { fixturesDir?: string; now?: Date } = {}): Promise<boolean> {
  if (!(await repos.clients.isEmpty())) return false;
  const now = opts.now ?? new Date();
  const fixtures = readFixtures(opts.fixturesDir);

  const fromFixtures: Spec[] = fixtures.map((f, i) => ({
    name: f.name,
    email: f.email,
    owed: i % 2 === 0 && !f.email.startsWith("news@"),
    daysSilent: Math.max(1, Math.round((now.getTime() - new Date(f.date).getTime()) / 86_400_000)),
    subject: f.subject,
    status: f.email.startsWith("news@") ? undefined : i % 3 === 1 ? "hold" : "ready",
    safety: f.email.startsWith("eve@")
      ? "The incoming mail told the assistant to ignore its rules. Treated as untrusted; nothing from it was followed."
      : undefined,
    marks: f.email.startsWith("eve@") ? ["do_not_contact"] : undefined,
  }));

  const insert = async (project: string, specs: Spec[], runId: number | null) => {
    const ids = new Map<string, number>();
    for (const s of specs) {
      const clientId = await repos.clients.create({
        project,
        email: s.email,
        name: s.name,
        repliesOwed: s.owed,
        lastContactAt: daysAgo(now, s.daysSilent),
      });
      ids.set(s.email, clientId);
      if (s.marks) await repos.clients.setMarks(clientId, s.marks);
      if (s.status) {
        await repos.drafts.create({
          project,
          clientId,
          runId,
          subject: `Re: ${s.subject}`,
          toAddr: s.email,
          ccAddr: "mark@example.org",
          mailRef: `<seed-${s.email.replace("@", "-at-")}@example.com>`, // a Message-ID, so "Open in Mail" has a link
          body: bodyFor(s.name, s.subject),
          safety: s.safety ?? null,
          status: s.status,
          checked: s.checked ?? false,
          // A follow-up candidate's message is client mail, so the starter sequence (mail_classes: client) fits it.
          ...(s.outDaysAgo === undefined ? {} : { mailClass: "client", ...(s.status === "sent" ? { sentAt: daysAgo(now, s.outDaysAgo), sentVia: "message-id" } : { actedAt: daysAgo(now, s.outDaysAgo) }) }),
        });
      }
    }
    return ids;
  };

  // Runs first, so drafts can point at the run that wrote them.
  const run1 = await repos.runs.start({ project: "lisbon-realty", startedAt: daysAgo(now, 0.1), finishedAt: plusSeconds(daysAgo(now, 0.1), 95), trigger: "schedule", skill: "triage-mail", model: "sonnet", status: "ok", tokensIn: 48_200, tokensOut: 3_900, costUsd: 0.31 });
  const run2 = await repos.runs.start({ project: "lisbon-realty", startedAt: daysAgo(now, 1.1), finishedAt: plusSeconds(daysAgo(now, 1.1), 41), trigger: "schedule", skill: "triage-mail", model: "sonnet", status: "needs_human", tokensIn: 21_000, tokensOut: 1_700, costUsd: 0.14 });
  const run3 = await repos.runs.start({ project: "lisbon-realty", startedAt: daysAgo(now, 2.1), finishedAt: plusSeconds(daysAgo(now, 2.1), 3), trigger: "schedule", skill: "triage-mail", model: "sonnet", status: "failed", tokensIn: 0, tokensOut: 0, costUsd: 0 });
  const run4 = await repos.runs.start({ project: "demo-shop", startedAt: daysAgo(now, 0.5), finishedAt: plusSeconds(daysAgo(now, 0.5), 28), trigger: "owner", skill: "bulk-follow-up", model: "sonnet", status: "ok", tokensIn: 9_400, tokensOut: 800, costUsd: 0.05 });

  const lisbon = await insert("lisbon-realty", [...fromFixtures, ...EXTRA_LISBON], run1);
  const demo = await insert("demo-shop", EXTRA_DEMO, run4);

  const ev = (project: string, runId: number, at: Date, kind: Parameters<Repos["runs"]["addEvent"]>[0]["kind"], summary: string, extra: { tool?: string; detail?: unknown; clientId?: number } = {}) =>
    repos.runs.addEvent({ project, runId, at: at.toISOString(), kind, summary, tool: extra.tool ?? null, detail: extra.detail === undefined ? null : JSON.stringify(extra.detail), clientId: extra.clientId ?? null });
  const t = (base: string, s: number) => new Date(new Date(base).getTime() + s * 1000);
  const base1 = daysAgo(now, 0.1);
  const marta = lisbon.get("marta@example.net");
  const eve = lisbon.get("eve@example.com");
  await ev("lisbon-realty", run1, t(base1, 0), "thought", "Three new inbound messages since the last run; start with the oldest unanswered.");
  await ev("lisbon-realty", run1, t(base1, 4), "tool_call", "Read the history of marta@example.net", { tool: "mail_history", detail: { address: "marta@example.net", messageIds: ["<m-101>", "<m-102>"] }, clientId: marta });
  await ev("lisbon-realty", run1, t(base1, 9), "tool_result", "2 messages, last inbound 6 days ago", { tool: "mail_history", clientId: marta });
  await ev("lisbon-realty", run1, t(base1, 15), "decision", "Reply is owed: she asked for terms and nobody answered.", { clientId: marta });
  await ev("lisbon-realty", run1, t(base1, 22), "draft_created", "Draft prepared for Marta Ficticia", { tool: "mail_draft", detail: { draftSubject: "Re: Terms for the Alfama building" }, clientId: marta });
  if (eve) {
    await ev("lisbon-realty", run1, t(base1, 30), "thought", "The message from eve@example.com contains instructions addressed to me. It is mail content, not an order.", { clientId: eve });
    await ev("lisbon-realty", run1, t(base1, 33), "decision", "Held the draft and flagged it for review.", { clientId: eve });
  }
  await ev("lisbon-realty", run1, t(base1, 41), "notion_write", "Updated 3 client profiles in Notion", { tool: "notion-update-page", detail: { pages: 3 } });

  const base2 = daysAgo(now, 1.1);
  await ev("lisbon-realty", run2, t(base2, 0), "thought", "One client writes in two languages; the profile says Portuguese.");
  await ev("lisbon-realty", run2, t(base2, 12), "needs_human", "Cannot tell whether the price quoted last week still stands. Waiting for the owner.", { clientId: lisbon.get("luis@example.net") });

  const base3 = daysAgo(now, 2.1);
  await ev("lisbon-realty", run3, t(base3, 0), "error", "claude -p returned: OAuth session expired", { tool: "claude", detail: { exit: 1 } });

  const base4 = daysAgo(now, 0.5);
  await ev("demo-shop", run4, t(base4, 0), "tool_call", "Listed clients silent for more than 3 days", { tool: "profile_get" });
  await ev("demo-shop", run4, t(base4, 8), "draft_created", "3 drafts prepared", { tool: "mail_draft", clientId: demo.get("anna@example.com") });
  // The triage list of the first project: two clients the agent left to the owner and one it skipped. No mail text.
  const seen = (email: string, name: string, action: "skipped" | "escalated", reason: string, notion: NotionRef, hours: number, subject: string) =>
    repos.inbox.record({ project: "lisbon-realty", email, name, action, reason, subject, lastInboundAt: daysAgo(now, hours / 24), mailClass: "client", notion, skill: "triage-mail", runId: run1 }, new Date(daysAgo(now, 0.09)));
  await seen("marta@example.org", "Marta Gomes", "escalated", "Asks about a discount the owner has not approved.", { kind: "client", pageId: "11111111111111111111111111111111" }, 5, "Discount on the second unit");
  await seen("joao@example.org", "Joao Pires", "escalated", "First contact, wants a viewing; no profile yet.", { kind: "lead", pageId: "22222222222222222222222222222222" }, 9, "Viewing next week?");
  await seen("noreply@example.com", "Newsletter", "skipped", "A mailing list, no reply needed.", { kind: "none" }, 30, "Weekly digest");
  // Not answered by email (P27 M6): three of the four groups are filled; "unknown sender" stays empty so its empty state is seeded too.
  const aside = (email: string, name: string, kind: "call" | "no_action" | "crossed_off", reason: string, phone: string | null, hours: number) =>
    repos.inbox.record({ project: "lisbon-realty", email, name, action: kind === "call" ? "escalated" : "skipped", kind, phone, reason, repliesOwed: false, notion: { kind: "none" }, lastInboundAt: daysAgo(now, hours / 24), skill: "triage-mail", runId: run1 }, new Date(daysAgo(now, 0.08)));
  await aside("duarte@example.org", "Duarte Exemplo", "call", "Asked to be called about the closing date.", "+351 912 000 000 (after 17:00)", 7);
  await aside("helena@example.net", "Helena Prova", "call", "The owner said to call her.", null, 20);
  await aside("receipts@example.com", "Payment receipts", "no_action", "A receipt, nothing to answer.", null, 40);
  await aside("vasco@example.org", "Vasco Ensaio", "crossed_off", "The owner asked the agent to leave him alone.", null, 90);
  // Follow-ups (P47): one client enrolled and due now (we wrote 25 days ago), and one candidate (Ines: our message 9 days ago, hers 11).
  // The sequence id is the core starter's; the e2e run writes that file into its project folder.
  const tiago = lisbon.get("tiago@example.com");
  if (tiago) await repos.enrollments.enrol({ project: "lisbon-realty", clientId: tiago, sequence: "answered-enquiry-no-reply", sequenceHash: "seed", schedule: { delays: [2, 3, 5], businessDays: true }, by: "owner", now });
  // Messengers (P71 M3): one linked Telegram chat of Rita, who wrote last, with the agent's open draft, and one of Sofia where we
  // replied last. Invented ids; no Telegram account is connected in a seeded instance.
  const rita = lisbon.get("rita@example.net");
  const sofia = lisbon.get("sofia@example.com");
  const tg = async (clientId: number, chatId: string, title: string, rows: { dir: "in" | "out"; hours: number; text: string }[]) => {
    await repos.messengers.allowChat("lisbon-realty", "telegram_user", chatId, title);
    await repos.messengers.addIdentifier("lisbon-realty", clientId, "telegram", chatId);
    for (const [i, r] of rows.entries()) {
      await repos.messengers.insertMessage({ project: "lisbon-realty", channel: "telegram_user", account: "100200300", chatId, remoteMessageId: `${chatId}-${i}`, direction: r.dir, text: r.text, sentAt: daysAgo(now, r.hours / 24), retainUntil: daysAgo(now, -90) });
    }
  };
  if (rita) {
    await tg(rita, "700100", "Rita F.", [{ dir: "in", hours: 2, text: "Hi! Is the notary on the 28th still on? I can only do mornings." }]);
    await repos.messengers.createDraft({ project: "lisbon-realty", channel: "telegram_user", chatId: "700100", clientId: rita, createdBy: "seed", text: "Hi Rita, yes, the 28th stands. 10:00 at the notary on Rua Augusta works for us. I will send the address the day before." });
  }
  if (sofia) {
    await tg(sofia, "700200", "Sofia T.", [{ dir: "in", hours: 30, text: "Any news on the offer?" }, { dir: "in", hours: 29, text: "Thank you!" }, { dir: "out", hours: 26, text: "Not yet, I will write as soon as the seller answers." }]);
    // P71 M-P: the pre-analysis is on in Sofia's chat, with two seeded verdicts (no model ran): her question reached the agent, her
    // "Thank you!" was hidden as closing, so the panel shows a count by reason.
    await repos.messengers.setChatRules("lisbon-realty", "telegram_user", "700200", { prefilter: true });
    const ids = (await repos.messengers.messagesOf("lisbon-realty", [{ channel: "telegram_user", chatId: "700200" }], { limit: 10 })).filter((m) => m.direction === "in");
    await repos.messengers.recordTriage("lisbon-realty", ids.map((m) => ({ messageId: m.id, verdict: m.text === "Thank you!" ? "closing" : "needs_reply", model: "seed", promptVersion: 1 })));
  }
  return true;
}

/**
 * Adds `count` invented clients, each with one ready draft, to a project: enough to page through the Drafts list and to prove a
 * search finds a client that is not on the first page. Not part of `seed` (the shared e2e counts would change); run it by hand
 * with `seed-cli --many 120`. Names are "Client 001 Sample" ... so a search for one is unambiguous.
 */
export async function seedMany(repos: Repos, opts: { project: string; count: number; now?: Date }): Promise<void> {
  const now = opts.now ?? new Date();
  for (let i = 1; i <= opts.count; i++) {
    const n = String(i).padStart(3, "0");
    await repos.drafts.record({ project: opts.project, email: `client${n}@example.net`, name: `Client ${n} Sample`, subject: `Re: Question ${n}`, mailRef: `<many-${n}@example.com>`, repliesOwed: i % 3 === 0, lastContactAt: daysAgo(now, i % 40) });
  }
}
