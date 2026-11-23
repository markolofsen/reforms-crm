import { CONTEXT_BLOCK_FROM } from "@hub/projects/context";
import { STATUS_KINDS, type StatusDto, type StatusKind, type StatusLevel, type StatusNext } from "@hub/contract/overview";
import type { ProjectFacts } from "./facts";

/**
 * One project's status (Overview v5): the worst of its facts, said once, in plain words. A pure function of local facts,
 * so the Mail status line and the Overview table cannot disagree, and no model writes a sentence. Worst = blocked, then
 * attention, then the facts worth naming at level `clear` (the old "watch" kinds); ties follow `STATUS_KINDS`. The slug is
 * never in the sentence: the row or the screen already names the project. `next` names the page that fixes the fact (P70):
 * Settings ▸ Sending for sending (Stop, the sends, the cap, who drafts may go to), Overview for what is fixed by a phrase in a
 * session (a failing setup check, a draft project, the evidence rule), Knowledge for the entries. A setting the owner chose (test
 * mode) is level `clear`: it is still said when nothing worse is, but it is not a fault, so it lights no dot (UX pass 2026-11-20).
 */

/** At this share of the daily cap an automatic-send project is "near" it. */
export const CAP_NEAR_PERCENT = 80;

/** What the instance adds to every project: the Sent loop's state for it, and whether the Mailer is the fake. */
/** P96: the Mail reader's line for one project (`projectReadOf` in `inbound.ts`). Absent in tests that do not set it: never read. */
export type MailRead = StatusDto["numbers"]["mailRead"];
export const NO_READ: MailRead = { at: null, reason: "Mail is not read", reading: false, unknown: 0 };
export interface InstanceFacts { sentError: boolean; fakeMailer: boolean; mailRead?: MailRead }

interface Fact { kind: StatusKind; level: StatusLevel; sentence: string; next: StatusNext | null }

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const RANK: Record<StatusLevel, number> = { blocked: 0, attention: 1, clear: 2 };

/** Every fact of one project, unsorted. A paused or archived project runs nothing, so it raises nothing. */
export function factsOf(f: ProjectFacts, sys: InstanceFacts, now: Date): Fact[] {
  if (f.archived || f.status === "archived" || f.status === "paused") return [];
  const out: Fact[] = [];
  const add = (kind: StatusKind, level: StatusLevel, sentence: string, next: StatusNext | null) => out.push({ kind, level, sentence, next });

  if (f.stopped) add("send-stopped", "blocked", "Sending is stopped", "sending");
  if (sys.sentError) add("sent-loop-error", "blocked", "Sent detection is failing: sent mail is not being noticed", "sending");
  if (f.doctorFailed.length > 0) {
    const names = f.doctorFailed.slice(0, 2).join(", ") + (f.doctorFailed.length > 2 ? ", ..." : "");
    add("doctor-fail", "blocked", `${plural(f.doctorFailed.length, "setup check fails", "setup checks fail")}: ${names}`, "overview");
  }
  if (f.injectionHeld > 0) add("injection-flagged", "attention", `${plural(f.injectionHeld, "draft is", "drafts are")} held: the mail looked like an instruction`, null);
  if (f.failed24h > 0) add("send-failed", "attention", `${plural(f.failed24h, "send", "sends")} failed in the last 24 hours`, "sending");
  if (f.stuck > 0) add("sending-stuck", "attention", `${plural(f.stuck, "send is", "sends are")} stuck in "sending": check Mail's Sent folder`, "sending");
  if (f.status === "draft") add("project-draft", "attention", f.setupQuestion ? "A setup question is open: the project is a draft" : "The project is a draft: finish its setup", "overview");
  // Test mode is a setting the owner chose, not a fault (UX pass 2026-11-20): said at level clear, so it lights no dot and is no "Needs you" item.
  if (f.status === "active" && f.recipients === "test") add("recipients-test", "clear", "Test mode: sends go to the test list only", "sending");
  if (sys.fakeMailer) add("fake-mailer", "attention", "Demo mode: nothing is really sent", null);

  const a = f.auto;
  if (a.mode === "auto" && a.used24h * 100 >= a.cap * CAP_NEAR_PERCENT) add("cap-near", "clear", `${a.used24h} of ${a.cap} automatic sends used in 24 hours`, "sending");
  // An expired entry is the owner's to renew (UX pass): attention, so the Knowledge dot lights with Overview's knowledge item.
  if (f.knowledgeExpired > 0) add("knowledge-expired", "attention", `${plural(f.knowledgeExpired, "knowledge entry has", "knowledge entries have")} expired`, "knowledge");
  if (f.status === "active" && f.lastTriageAt === null) add("never-triaged", "clear", "No triage has run yet", null);
  if (f.status === "active" && f.contextRequired === null && now.getTime() < Date.parse(CONTEXT_BLOCK_FROM)) {
    add("context-block-soon", "clear", `Drafts without evidence are refused from ${CONTEXT_BLOCK_FROM.slice(0, 10)}`, "overview");
  }
  return out;
}

export function statusOf(f: ProjectFacts, sys: InstanceFacts, now: Date): StatusDto {
  const worst = factsOf(f, sys, now).sort((a, b) => RANK[a.level] - RANK[b.level] || STATUS_KINDS.indexOf(a.kind) - STATUS_KINDS.indexOf(b.kind))[0];
  const paused = f.status === "paused" ? "Paused: nothing runs" : f.archived || f.status === "archived" ? "Archived" : "All clear";
  const head = worst ?? { kind: "clear" as const, level: "clear" as const, sentence: paused, next: null };
  return { level: head.level, kind: head.kind, sentence: head.sentence, next: head.next, numbers: { owed: f.owed, wrote: f.wrote, ...(f.leads ? { leads: f.leads } : {}), lastTriageAt: f.lastTriageAt, mailRead: sys.mailRead ?? NO_READ } };
}

/** The Overview's one sentence: it counts projects, not items. Only `attention` and `blocked` need the owner. */
export function overviewSentence(statuses: StatusDto[]): string {
  const n = statuses.filter((s) => s.level !== "clear").length;
  return n === 0 ? "All clear" : `${n} ${n === 1 ? "project needs" : "projects need"} you`;
}
