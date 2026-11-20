import { DRAFT_VIEWS, RUN_STATUSES, type DraftView, type RunStatus } from "@hub/config";
import { KNOWLEDGE_VIEWS, type KnowledgeView } from "@hub/contract/knowledge";

// Every URL parameter name and its allowed values, in one place. No React, no URL library: plain functions, so the
// address of every screen is testable without a DOM. The enums are the ones the API validates (`@hub/config`, re-used
// by `@hub/contract`), so the address and the request share one source. A value outside its enum resets to the default.

export const RUN_FILTERS = ["all", ...RUN_STATUSES] as const;
export type RunFilter = "all" | RunStatus;
/**
 * Activity's View menu (UX pass 2026-11-20): the session views the API filters by, plus Sends, the send history, which is
 * activity and not a setting (it left Settings ▸ Sending). `sends` is the admin's own view: it never reaches the activity API.
 */
export const ACTIVITY_VIEWS = [...RUN_FILTERS, "sends"] as const;
export type ActivityView = RunFilter | "sends";

/**
 * The four views of the Drafts list (research 16 section 6.3): To review (`ready`), Hold, Finished (done, sent and skipped
 * together) and All. The server filters by one status, so `finished` is narrowed in the page. The default is To review
 * (owner decision Q5, P29): a bare `/drafts` shows what needs the owner, so `ready` drops its key and `all` keeps it.
 */
// `sequences` (P47, label Follow-ups): the open steps of follow-up sequences and the enrolments, read-only. `not_by_email` (P48):
// the clients the agent did not answer by email (calls, no reply needed), read-only rows instead of drafts.
// The list itself lives in `@hub/config` (the shared focus names a view too, P51).
export { DRAFT_VIEWS, type DraftView };
export const DEFAULT_DRAFT_VIEW: DraftView = "ready";

/**
 * Settings ▸ Agent's Tools table (P75): by default only the rows that need a fix or a look, `all` every row. A View menu, like
 * Drafts, Activity and Knowledge (`admin-principles.md` rule 11), not a disclosure: the table is always drawn.
 */
export const AGENT_VIEWS = ["attention", "all"] as const;
export type AgentView = (typeof AGENT_VIEWS)[number];

export type Raw = Readonly<Record<string, string>>;

/** `a=1&b=2` into a flat record. The last value of a repeated name wins. */
export function parseQuery(query: string): Raw {
  const out: Record<string, string> = {};
  for (const [k, v] of new URLSearchParams(query)) out[k] = v;
  return out;
}

/** The query string (with its `?`, or empty). Empty, false and absent values are left out; a default is dropped by the caller (`unlessDefault`). */
export function formatQuery(entries: Readonly<Record<string, string | number | boolean | null | undefined>>): string {
  const q = new URLSearchParams();
  for (const [k, v] of Object.entries(entries)) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    q.set(k, v === true ? "1" : String(v));
  }
  const s = q.toString();
  return s ? `?${s}` : "";
}

/** `v` when it is one of `all`, else the fallback. Narrows a string to a union without a cast. */
export function oneOf<T extends string>(all: readonly T[], v: string | undefined, fallback: T): T {
  return all.find((x) => x === v) ?? fallback;
}

/** `undefined` when the value is the screen's default, so its key leaves the address. */
export const unlessDefault = <T extends string>(v: T | undefined, fallback: T): T | undefined => (v === fallback ? undefined : v);

/** A positive integer from the address, or null. `abc`, `0`, `-1`, `1.5` and `007` are not ids. */
export function positiveInt(v: string | undefined): number | null {
  return v !== undefined && /^[1-9]\d*$/.test(v) ? Number(v) : null;
}

/** `batch` limits the list to the drafts one batch wrote (one queue: a batch is a read-only view, not a second place). */
export type DraftsSearch = { filter: DraftView; q: string; batch: number | null };
export type LogSearch = { filter: ActivityView; run: number | null };
/** P70: the Knowledge table's view (the same enum the API validates) and its title search. */
export type KnowledgeSearch = { filter: KnowledgeView; q: string };
export { KNOWLEDGE_VIEWS, type KnowledgeView };
export type AgentSearch = { filter: AgentView };
export type NoSearch = Record<string, never>;

/**
 * Saved links: the view now called `thin_basis` was `?filter=evidence` until 2026-11-18 (renamed to plain words). The old value is read
 * as the new one here, and only here; no other address is aliased. Delete this line when no saved link can still hold it.
 */
const renamedView = (v: string | undefined): string | undefined => (v === "evidence" ? "thin_basis" : v);

export const draftsSearch = (raw: Raw): DraftsSearch => {
  // `?new=1` (the batch builder, deleted 2026-11-18, P48) is not read: the guard writes the address back without it.
  return { filter: oneOf(DRAFT_VIEWS, renamedView(raw.filter), DEFAULT_DRAFT_VIEW), q: raw.q ?? "", batch: positiveInt(raw.batch) };
};
export const logSearch = (raw: Raw): LogSearch => ({ filter: oneOf(ACTIVITY_VIEWS, raw.filter, "all"), run: positiveInt(raw.run) });
export const knowledgeSearch = (raw: Raw): KnowledgeSearch => ({ filter: oneOf(KNOWLEDGE_VIEWS, raw.filter, "all"), q: raw.q ?? "" });
export const agentSearch = (raw: Raw): AgentSearch => ({ filter: oneOf(AGENT_VIEWS, raw.filter, "attention") });
export const noSearch = (): NoSearch => ({});
