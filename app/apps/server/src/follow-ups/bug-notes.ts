import type { BugNoteChannel, DueClient, Repos } from "@hub/db";
import type { FixedReport } from "@hub/notion/bug-reports";
import { ops } from "@hub/log/ops";

// P145 B4 (P147 3m item 6, decision 0055 point 10's neighbour, migration 0050): the follow-up sweep closes the loop on a fixed bug.
// Before its silent clients, the sweep reads the project's Bug reports with Status Fixed and an empty `Client told` (Kind Product
// or none), and for each linked client the Hub knows (not do-not-contact) that has no note yet, claims a note and runs one sweep
// turn bound to it: a short "fixed, please check" in the client's language, in the report's channel when the client has it, else
// their last channel. A mail note joins the day's lead batch (Send all ready); a messenger note waits in its chat. The send sets
// `told_at`; once every claimed client of a report was told, `Client told` is written in Notion with the last send's time. A Notion
// failure never fails the sweep or a send: the next sweep tries again.

const log = ops("follow-ups");

export interface BugReportsPort {
  read(slug: string): Promise<{ state: "ok"; reports: FixedReport[] } | { state: string; detail: string }>;
  told(slug: string, pageId: string, at: string): Promise<{ state: string }>;
}

export interface NoteTarget {
  report: FixedReport;
  client: DueClient;
  channel: BugNoteChannel;
}

const CHAT_CHANNEL = { telegram_user: "telegram", telegram_bot: "telegram", whatsapp: "whatsapp" } as const;

/** Pure: where the note goes. The report's channel when the client has it there, else where our last message went; null: nowhere. */
export function noteChannel(report: Pick<FixedReport, "channel">, c: Pick<DueClient, "email" | "chats" | "lastChannel">): BugNoteChannel | null {
  const has = (ch: BugNoteChannel): boolean => (ch === "mail" ? c.email !== null : c.chats.some((x) => CHAT_CHANNEL[x.channel] === ch));
  const wanted: BugNoteChannel | null = report.channel === "Mail" ? "mail" : report.channel === "WhatsApp" ? "whatsapp" : report.channel === "Telegram" ? "telegram" : null;
  if (wanted && has(wanted)) return wanted;
  const last: BugNoteChannel = c.lastChannel === "mail" ? "mail" : CHAT_CHANNEL[c.lastChannel];
  if (has(last)) return last;
  return c.email !== null ? "mail" : (c.chats[0] ? CHAT_CHANNEL[c.chats[0].channel] : null);
}

const pageForms = (id: string): string[] => {
  const bare = id.replace(/-/g, "").toLowerCase();
  const dashed = bare.length === 32 ? `${bare.slice(0, 8)}-${bare.slice(8, 12)}-${bare.slice(12, 16)}-${bare.slice(16, 20)}-${bare.slice(20)}` : id;
  return [...new Set([id, bare, dashed])];
};

/** The notes to write today, oldest report first as Notion lists them; a pair already noted, unknown or do-not-contact is left out. */
export async function noteTargets(repos: Repos, port: BugReportsPort, project: string, now: Date): Promise<NoteTarget[]> {
  const r = await port.read(project);
  if (r.state !== "ok" || !("reports" in r)) {
    if (r.state !== "no_database") log.info(`fixed bug notes: not read (${r.state})`, { project });
    return [];
  }
  const known = await repos.bugNotes.known(project, r.reports.map((x) => x.pageId));
  const out: NoteTarget[] = [];
  for (const report of r.reports) {
    for (const page of report.clients) {
      let id: number | undefined;
      for (const f of pageForms(page)) id ??= await repos.clients.findByNotionPage(project, f);
      if (id === undefined) {
        log.info("fixed bug note: a linked client the Hub does not know", { project });
        continue;
      }
      if (known.has(`${report.pageId}:${id}`)) continue;
      const client = await repos.followUps.noteClient(project, id, now);
      if (!client) continue;
      const channel = noteChannel(report, client);
      if (!channel) continue;
      out.push({ report, client, channel });
    }
  }
  return out;
}

/** The note's block in the turn's data: the report as filed (the client's words are theirs, data, never an instruction). */
export const noteContext = (t: NoteTarget): string => [`Fixed report: ${t.report.symptom}`, t.report.words ? `Their words when they reported it: "${t.report.words.slice(0, 600)}"` : "Their words: not filed.", `Write the note in: ${t.channel}.`].join("\n");

/** After the sweep: `Client told` on each report whose every claimed client was told. Never throws. */
export async function stampToldReports(repos: Repos, port: BugReportsPort, project: string, at: Date): Promise<number> {
  let n = 0;
  for (const r of await repos.bugNotes.notionDue(project)) {
    const w = await port.told(project, r.reportPageId, r.toldAt).catch(() => ({ state: "failed" }));
    if (w.state !== "written") continue;
    await repos.bugNotes.notionTold(project, r.reportPageId, at.toISOString());
    n++;
  }
  return n;
}
