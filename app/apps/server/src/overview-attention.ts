import { CONTEXT_BLOCK_FROM } from "@hub/projects";
import type { HealthDto } from "@hub/contract/health";
import type { AttentionItem, ProjectCardDto, Severity, VerdictDto } from "@hub/contract/overview";

/** Facts the attention list needs that the project card does not carry. */
export interface ProjectExtra {
  /** Names of the failing setup checks (names only, never a detail that could hold a value). */
  doctorFailed: string[];
  knowledgeExpired: number;
  /** `context.required` of the project; null: the default (warn until CONTEXT_BLOCK_FROM). */
  contextRequired: "warn" | "block" | null;
}

export interface AttentionInput {
  now: Date;
  cards: ProjectCardDto[];
  extra: Record<string, ProjectExtra>;
  system: HealthDto;
}

/** At this share of the daily cap an automatic-send project is "near" it. */
export const CAP_NEAR_PERCENT = 80;

const plural = (n: number, one: string, many: string) => `${n} ${n === 1 ? one : many}`;
const SEVERITY_RANK: Record<Severity, number> = { blocker: 0, "needs-owner": 1, watch: 2 };

/** A project that is paused or archived runs nothing, so it raises nothing. */
const live = (c: ProjectCardDto) => !c.archived && c.status !== "paused" && c.status !== "archived";

type Block = { state: string; code?: string; message?: string; fix?: string };
const liveBlocks = (c: ProjectCardDto): Block[] => [
  ...c.mailboxes.map((m) => m.newSinceTriage),
  ...[c.notion.clients, c.notion.leads].flatMap((s) => (s ? [s.count] : [])),
];

/**
 * The ordered list of what needs the owner, from facts the server already holds: a pure function, so the page and the
 * shell status area (one source) cannot disagree, and no model writes a sentence. Order: severity, then count (more
 * first), then project name, then kind. A sentence is "<what happened>. <what to do>": the part before the first full
 * stop is what the headline quotes.
 */
export function attentionOf(input: AttentionInput): AttentionItem[] {
  const out: AttentionItem[] = [];
  const add = (item: AttentionItem) => out.push(item);

  if (input.system.sent.state === "error") {
    add({ kind: "sent-loop-error", severity: "blocker", project: null, count: input.system.sent.failures, sentence: "Sent detection is failing. Open a project's Health to see when it last ran.", focus: "project" });
  }

  for (const c of input.cards.filter(live)) {
    const x = input.extra[c.slug] ?? { doctorFailed: [], knowledgeExpired: 0, contextRequired: null };
    const p = c.slug;
    const item = (i: Omit<AttentionItem, "project">) => add({ ...i, project: p });

    const mailOff = c.mailboxes.filter((m) => m.newSinceTriage.state === "off").length;
    if (mailOff > 0) item({ kind: "mail-off", severity: "blocker", count: mailOff, sentence: `${p}: ${plural(mailOff, "mailbox has", "mailboxes have")} no login. Add the login file in state/secrets, then Refresh.`, focus: "project" });
    const mailErr = c.mailboxes.filter((m) => m.newSinceTriage.state === "error").length;
    if (mailErr > 0) item({ kind: "mail-error", severity: "blocker", count: mailErr, sentence: `${p}: mail could not be read for ${plural(mailErr, "mailbox", "mailboxes")}. Open Project to see why, then Refresh.`, focus: "project" });

    const sources = [c.notion.clients, c.notion.leads].flatMap((s) => (s ? [s.count] : []));
    const tokenErr = sources.find((b) => b.state === "error" && (b.code === "token-missing" || b.code === "token-rejected"));
    if (tokenErr?.state === "error") item({ kind: "notion-token", severity: "blocker", sentence: `${p}: ${tokenErr.message} ${tokenErr.fix}`, focus: "project" });
    if (c.sends.stopped) item({ kind: "send-stopped", severity: "blocker", sentence: `${p}: sending is stopped (Stop all). Resume it in Project when you are ready.`, focus: "project" });
    if (x.doctorFailed.length > 0) {
      const names = x.doctorFailed.slice(0, 2).join(", ");
      item({ kind: "doctor-fail", severity: "blocker", count: x.doctorFailed.length, sentence: `${p}: ${plural(x.doctorFailed.length, "setup check fails", "setup checks fail")} (${names}${x.doctorFailed.length > 2 ? ", ..." : ""}). Open Project > Health.`, focus: "project" });
    }

    if (c.status === "draft") {
      item({ kind: "project-draft", severity: "needs-owner", sentence: c.setupQuestion ? `${p}: a setup question is open (the project is a draft). Answer it in Project to finish setup.` : `${p}: the project is still a draft. Finish its setup before live work.`, focus: "project" });
    }
    if (c.injectionHeld > 0) item({ kind: "injection-flagged", severity: "needs-owner", count: c.injectionHeld, sentence: `${p}: ${plural(c.injectionHeld, "draft is", "drafts are")} held, suspicious mail. Review ${c.injectionHeld === 1 ? "it" : "them"} before anything else.`, focus: "drafts" });
    if (c.status === "active" && c.recipients === "test") item({ kind: "recipients-test", severity: "needs-owner", sentence: `${p}: replies can only go to the test allow-list. Set the recipients in project.md before live use.`, focus: "project" });
    if (c.sends.failed24h > 0) item({ kind: "send-failed", severity: "needs-owner", count: c.sends.failed24h, sentence: `${p}: ${plural(c.sends.failed24h, "send", "sends")} failed in 24 h. Open Project to see the history.`, focus: "project" });
    if (c.sends.stuck > 0) item({ kind: "sending-stuck", severity: "needs-owner", count: c.sends.stuck, sentence: `${p}: ${plural(c.sends.stuck, "send is", "sends are")} stuck in "sending". Check Mail's Sent folder, then resolve it in Project.`, focus: "project" });
    const otherErr = sources.filter((b) => b.state === "error" && b.code !== "token-missing" && b.code !== "token-rejected").length;
    if (otherErr > 0) item({ kind: "notion-error", severity: "needs-owner", count: otherErr, sentence: `${p}: Notion could not be read for ${plural(otherErr, "data source", "data sources")}. Open Project to see why, then Refresh.`, focus: "project" });
    if (c.owe.state !== "off" && c.owe.state !== "never" && c.owe.state !== "refreshing" && c.owe.state !== "error" && c.owe.value > 0) {
      item({ kind: "owe-reply", severity: "needs-owner", count: c.owe.value, sentence: `${p}: ${plural(c.owe.value, "client waits", "clients wait")} for a reply (as of the last triage). Open Drafts.`, focus: "drafts" });
    }
    if (c.drafts.ready > 0) item({ kind: "drafts-ready", severity: "needs-owner", count: c.drafts.ready, sentence: `${p}: ${plural(c.drafts.ready, "draft is", "drafts are")} ready to review. Open Drafts.`, focus: "drafts", filter: "ready" });

    const stale = liveBlocks(c).filter((b) => b.state === "stale").length;
    if (stale > 0) item({ kind: "stale-read", severity: "watch", count: stale, sentence: `${p}: ${plural(stale, "live number is", "live numbers are")} out of date. Refresh to read it again.`, focus: "overview" });
    const a = c.sends.auto;
    if (a.mode === "auto" && a.used24h * 100 >= a.cap * CAP_NEAR_PERCENT) item({ kind: "cap-near", severity: "watch", count: a.used24h, sentence: `${p}: ${a.used24h} of ${a.cap} automatic sends used in 24 h. The cap applies to automatic sends only.`, focus: "project" });
    if (x.knowledgeExpired > 0) item({ kind: "knowledge-expired", severity: "watch", count: x.knowledgeExpired, sentence: `${p}: ${plural(x.knowledgeExpired, "knowledge entry has", "knowledge entries have")} expired. Review them in the knowledge folder.`, focus: "project" });
    if (c.status === "active" && c.lastTriageAt === null) item({ kind: "never-triaged", severity: "watch", sentence: `${p}: no triage has run yet. Start one from the agent.`, focus: "project" });
    if (c.status === "active" && x.contextRequired === null && input.now.getTime() < Date.parse(CONTEXT_BLOCK_FROM)) {
      item({ kind: "context-block-soon", severity: "watch", sentence: `${p}: drafts without evidence (context) are refused from ${CONTEXT_BLOCK_FROM}. Set context.required or make sure sessions pass it.`, focus: "project" });
    }
  }

  return out.sort(
    (a, b) =>
      SEVERITY_RANK[a.severity] - SEVERITY_RANK[b.severity] ||
      (b.count ?? 0) - (a.count ?? 0) ||
      (a.project ?? "").localeCompare(b.project ?? "") ||
      a.kind.localeCompare(b.kind),
  );
}

/** The part of a sentence before its first full stop: what happened, without the next step. */
const headOf = (sentence: string): string => sentence.split(". ")[0]?.replace(/\.$/, "") ?? sentence;

/** "All clear" only when nothing blocks and nothing needs a person; watch items never stop it. */
export function verdictOf(items: AttentionItem[]): VerdictDto {
  const need = items.filter((i) => i.severity !== "watch");
  const watch = items.length - need.length;
  if (need.length === 0) return { level: "clear", headline: watch > 0 ? `All clear, ${watch} to watch` : "All clear" };
  const top = need.slice(0, 3).map((i) => headOf(i.sentence)).join("; ");
  return { level: need.some((i) => i.severity === "blocker") ? "blocked" : "attention", headline: `${plural(need.length, "thing needs", "things need")} you: ${top}${need.length > 3 ? "; ..." : ""}` };
}
