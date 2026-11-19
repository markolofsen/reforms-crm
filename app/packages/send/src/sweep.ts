import { hubAuthorship } from "@hub/config";
import type { Repos } from "@hub/db";
import { bareId, type DraftsCleaner, type MailDraft, type TrashItem } from "./mailer";

// `hub drafts sweep` (P56 S0): the hub's own leftovers in Mail's Drafts, moved to Trash (recoverable), and nothing else.
// Who wrote a draft is judged by its text only (`hubAuthorship`): its first non-empty line is a hub marker or the legacy
// run line. A draft without one is the owner's and is never listed. Dry run by default; `--apply` moves what it listed.

export type SweepKind = "superseded" | "closed" | "legacy";

export interface SweepRow {
  ref: string;
  account: string;
  subject: string;
  kind: SweepKind;
  why: string;
  /** The first line the move re-checks just before it (`TrashItem.line`). */
  line: string;
}

export interface SweepScope {
  /** The project's `mail.accounts`: marked drafts are judged only there (another instance's drafts are its own to judge). */
  accounts: readonly string[];
  /** Threads (bare, lowercased Message-IDs) whose hub draft in this project is done, sent or skipped, and none is open. */
  closed: ReadonlySet<string>;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Pure: which drafts go to Trash, and why. `superseded`: a marked draft with a newer marked draft of the same thread in
 * the same account (the writer keeps one; this is what an older run left). `closed`: every marked draft of a thread the
 * owner already closed. `legacy`: the run line of the hub's drafts before the marker (14 Nov 2026), in any account,
 * because the line itself proves the hub wrote it.
 */
export function planSweep(drafts: readonly MailDraft[], scope: SweepScope): SweepRow[] {
  const own = new Set(scope.accounts.map(lower));
  const rows: SweepRow[] = [];
  const marked = new Map<string, Array<{ d: MailDraft; line: string; thread: string }>>();
  for (const d of drafts) {
    const a = hubAuthorship(d.body);
    if (!a) continue;
    const base = { ref: d.ref, account: d.account ?? "", subject: d.subject, line: a.line };
    if (a.kind === "legacy") {
      rows.push({ ...base, kind: "legacy", why: "written by the hub before the marker existed (the run line)" });
      continue;
    }
    if (!own.has(lower(d.account))) continue;
    const key = `${lower(d.account)}\u0000${a.thread}`;
    marked.set(key, [...(marked.get(key) ?? []), { d, line: a.line, thread: a.thread }]);
  }
  for (const group of marked.values()) {
    const byAge = [...group].sort((x, y) => (Number(y.d.ref) || 0) - (Number(x.d.ref) || 0));
    for (const [i, g] of byAge.entries()) {
      const base = { ref: g.d.ref, account: g.d.account ?? "", subject: g.d.subject, line: g.line };
      if (scope.closed.has(g.thread)) rows.push({ ...base, kind: "closed", why: "its hub draft is done, sent or skipped" });
      else if (i > 0) rows.push({ ...base, kind: "superseded", why: `an older version: Mail id ${byAge[0]?.d.ref} is the newest of this thread` });
    }
  }
  return rows;
}

/** The threads of this project whose hub draft is closed and none open, from the database (read-only). */
export async function closedThreads(repos: Repos, project: string): Promise<Set<string>> {
  const page = { limit: 5000, offset: 0 };
  const closed = new Set<string>();
  for (const f of ["done", "sent", "skipped"] as const) for (const d of await repos.clients.review(project, f, page)) if (d.mailRef) closed.add(bareId(d.mailRef));
  for (const d of await repos.clients.review(project, "all", page)) if (d.mailRef && (d.status === "ready" || d.status === "hold")) closed.delete(bareId(d.mailRef));
  return closed;
}

export interface SweepResult {
  rows: SweepRow[];
  /** Only with apply: what Mail moved, and what it refused because the text changed since the read. */
  moved: string[];
  refused: string[];
}

export async function runSweep(deps: { mailer: DraftsCleaner; repos: Repos }, o: { project: string; accounts: readonly string[]; apply: boolean }): Promise<SweepResult> {
  const rows = planSweep(await deps.mailer.listHubDrafts(), { accounts: o.accounts, closed: await closedThreads(deps.repos, o.project) });
  if (!o.apply || rows.length === 0) return { rows, moved: [], refused: [] };
  const items: TrashItem[] = rows.map((r) => ({ ref: r.ref, line: r.line }));
  const r = await deps.mailer.trashDrafts(items);
  return { rows, ...r };
}
