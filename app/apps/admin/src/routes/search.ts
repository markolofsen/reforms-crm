import { DRAFT_VIEWS, type DraftView } from "@hub/config";
import { ACTIVITY_VIEWS as TIMELINE_VIEWS, type ActivityView as TimelineView } from "@hub/contract/activity";
import { KNOWLEDGE_VIEWS, type KnowledgeView } from "@hub/contract/knowledge";
import { MESSENGER_CHANNEL_FILTERS, MESSENGER_VIEWS, type MessengerChannelFilter, type MessengerView } from "@hub/contract/messenger-panel";

// Every URL parameter name and its allowed values, in one place. No React, no URL library: plain functions, so the
// address of every screen is testable without a DOM. The enums are the ones the API validates (`@hub/config`, re-used
// by `@hub/contract`), so the address and the request share one source. A value outside its enum resets to the default.

/**
 * Activity's View menu (P73): the timeline's views by outcome, the ones the API filters by, plus Sends (UX pass 2026-11-20),
 * the send history, which is activity and not a setting (it left Settings ▸ Sending). `sends` is the admin's own view: it
 * never reaches the activity API.
 */
export { TIMELINE_VIEWS, type TimelineView };
export const ACTIVITY_VIEWS = [...TIMELINE_VIEWS, "sends"] as const;
export type ActivityView = TimelineView | "sends";

/**
 * The views of the Mail list (P99 verdict 3), in their menu order: Needs you (the default: they wrote, or a draft is ready),
 * Waiting (for them), All; then two filters, Follow-ups (`sequences`, P47) and Not by email (P48, read-only client rows). Hold,
 * Thin basis, Sent and Finished are words and chips on a row, not views. The list itself lives in `@hub/config`.
 */
export { DRAFT_VIEWS, type DraftView };
/** The one label of each view: the View menu and the dock's "Agent sees: Mail · Needs you" read it. */
export const DRAFT_VIEW_LABELS: Readonly<Record<DraftView, string>> = { needs_you: "Needs you", waiting: "Waiting", all: "All", sequences: "Follow-ups", not_by_email: "Not by email" };
/** The filters of the View menu, under their own heading (a filter of All, verdict 3). */
export const DRAFT_FILTERS: ReadonlySet<DraftView> = new Set(["sequences", "not_by_email"]);
export const DEFAULT_DRAFT_VIEW: DraftView = "needs_you";

/**
 * Settings ▸ Agent's Tools table (P75): by default only the rows that need a fix or a look, `all` every row. A View menu, like
 * Mail, Activity and Knowledge (`admin-principles.md` rule 11), not a disclosure: the table is always drawn.
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
export type DraftsSearch = { filter: DraftView; q: string; batch: number | null; m?: string | null };
/** Activity (P73): the view, and `client` narrows the timeline to one client (the draft card's history opens it). */
export type LogSearch = { filter: ActivityView; client: number | null };
/** P70: the Knowledge table's view (the same enum the API validates) and its title search. */
export type KnowledgeSearch = { filter: KnowledgeView; q: string };
export { KNOWLEDGE_VIEWS, type KnowledgeView };
export type AgentSearch = { filter: AgentView };
/** The Messengers panel's view (P84c: To do, the default, Linked, Hidden) and its channel (All, the default, Telegram, WhatsApp); the enums the API validates. */
export type MessengersSearch = { filter: MessengerView; channel: MessengerChannelFilter };
export { MESSENGER_CHANNEL_FILTERS, MESSENGER_VIEWS, type MessengerChannelFilter, type MessengerView };
export type NoSearch = Record<string, never>;

/** A Message-ID in the address (`?m=`, P99: the conversation scrolls to that message), or null. */
const messageRef = (v: string | undefined): string | null => (v !== undefined && v.length >= 3 && v.length <= 998 && !/\s/.test(v) ? v : null);

/** An old view value (`ready`, `inbox`, `hold`, ...) is not one of these and resets to Needs you (rule 8); no alias. */
export const draftsSearch = (raw: Raw): DraftsSearch => ({ filter: oneOf(DRAFT_VIEWS, raw.filter, DEFAULT_DRAFT_VIEW), q: raw.q ?? "", batch: positiveInt(raw.batch), m: messageRef(raw.m) });
export const logSearch = (raw: Raw): LogSearch => ({ filter: oneOf(ACTIVITY_VIEWS, raw.filter, "all"), client: positiveInt(raw.client) });
export const knowledgeSearch = (raw: Raw): KnowledgeSearch => ({ filter: oneOf(KNOWLEDGE_VIEWS, raw.filter, "all"), q: raw.q ?? "" });
export const agentSearch = (raw: Raw): AgentSearch => ({ filter: oneOf(AGENT_VIEWS, raw.filter, "attention") });
export const messengersSearch = (raw: Raw): MessengersSearch => ({ filter: oneOf(MESSENGER_VIEWS, raw.filter, "todo"), channel: oneOf(MESSENGER_CHANNEL_FILTERS, raw.channel, "all") });
export const noSearch = (): NoSearch => ({});
