import type { MailVersionRow, Repos } from "@hub/db";
import type { DraftHead, TrashItem } from "@hub/mail-app/drafts";
import { bareId } from "@hub/mail-app/records";
import type { DraftsCleaner } from "./mailer";

// `hub drafts sweep` (P56 S0, P65 verdict 10): the Hub's own leftovers in Mail's Drafts, moved to Trash (recoverable),
// and nothing else. Who wrote a draft is the Hub's record (`mail_versions`, decision 0031), never its text: a draft is
// listed only when its account and its own Message-ID match a recorded version. A draft the Hub did not record is the
// owner's and is never listed. Mail is read by headers only (under 2 s). Dry run by default; `--apply` moves what it listed.

export type SweepKind = "superseded" | "closed";

export interface SweepRow {
  ref: string;
  account: string;
  subject: string;
  /** The draft's own Message-ID, as Mail gave it: what the move re-checks just before it. */
  messageId: string;
  kind: SweepKind;
  why: string;
  /** The `mail_versions` row it matched. */
  versionId: number;
}

export interface SweepScope {
  /** The project's `mail.accounts`: recorded versions are judged only there. */
  accounts: readonly string[];
  /** The project's recorded versions (`mail_versions`), any draft, trashed or not. */
  versions: readonly MailVersionRow[];
  /** Draft ids of this project that are done, sent or skipped. */
  closed: ReadonlySet<number>;
}

const lower = (s: string | null | undefined) => (s ?? "").trim().toLowerCase();

/**
 * Pure: which drafts go to Trash, and why. `closed`: every recorded version still in Drafts of a draft the owner closed
 * (done, sent or skipped). `superseded`: a recorded version of an open draft older (by Mail's id) than the newest recorded
 * version of that draft still in Drafts (the writer keeps one; this is what a failed replace or a late save left).
 */
export function planSweep(drafts: readonly DraftHead[], scope: SweepScope): SweepRow[] {
  const own = new Set(scope.accounts.map(lower));
  const byKey = new Map<string, MailVersionRow>();
  for (const v of scope.versions) byKey.set(`${lower(v.account)}\u0000${bareId(v.messageId)}`, v);
  const groups = new Map<number, Array<{ d: DraftHead; v: MailVersionRow }>>();
  for (const d of drafts) {
    if (!d.messageId || !own.has(lower(d.account))) continue;
    const v = byKey.get(`${lower(d.account)}\u0000${bareId(d.messageId)}`);
    if (!v || v.draftId === null) continue;
    groups.set(v.draftId, [...(groups.get(v.draftId) ?? []), { d, v }]);
  }
  const rows: SweepRow[] = [];
  for (const [draftId, group] of groups) {
    // Newest by Mail's id, not by the row: an adopted late save (P65 S5) is recorded after a newer version.
    const newestFirst = [...group].sort((x, y) => (Number(y.d.ref) || 0) - (Number(x.d.ref) || 0) || y.v.id - x.v.id);
    for (const [i, g] of newestFirst.entries()) {
      const base = { ref: g.d.ref, account: g.d.account ?? "", subject: g.d.subject, messageId: g.d.messageId ?? "", versionId: g.v.id };
      if (scope.closed.has(draftId)) rows.push({ ...base, kind: "closed", why: `hub draft ${draftId} is done, sent or skipped` });
      else if (i > 0) rows.push({ ...base, kind: "superseded", why: `an older version of hub draft ${draftId}: Mail id ${newestFirst[0]?.d.ref} is its newest` });
    }
  }
  return rows;
}

/** The draft ids of this project that are closed (done, sent or skipped), from the database (read-only). */
export async function closedDrafts(repos: Repos, project: string): Promise<Set<number>> {
  const page = { limit: 5000, offset: 0 };
  const closed = new Set<number>();
  for (const f of ["done", "sent", "skipped"] as const) for (const d of await repos.clients.review(project, f, page)) closed.add(d.id);
  return closed;
}

export interface SweepResult {
  rows: SweepRow[];
  /** Only with apply: what Mail moved, and what it refused because the draft changed or is gone since the read (Message-IDs). */
  moved: string[];
  refused: string[];
}

export async function runSweep(deps: { mailer: DraftsCleaner; repos: Repos }, o: { project: string; accounts: readonly string[]; apply: boolean }): Promise<SweepResult> {
  const rows = planSweep(await deps.mailer.listDrafts(), { accounts: o.accounts, versions: await deps.repos.mailVersions.ofProject(o.project), closed: await closedDrafts(deps.repos, o.project) });
  if (!o.apply || rows.length === 0) return { rows, moved: [], refused: [] };
  const items: TrashItem[] = rows.map((r) => ({ account: r.account, messageId: r.messageId }));
  const r = await deps.mailer.trashDrafts(items);
  const moved = new Set(r.moved.map(bareId));
  await deps.repos.mailVersions.markTrashed(rows.filter((x) => moved.has(bareId(x.messageId))).map((x) => x.versionId));
  return { rows, ...r };
}
