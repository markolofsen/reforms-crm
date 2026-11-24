import { DRAFT_VIEWS, type DraftView } from "@hub/config";
import { ACTIVITY_VIEWS as TIMELINE_VIEWS, type ActivityView as TimelineView } from "@hub/contract/activity";
import { keyText, parseClientKey } from "@hub/contract/client-key";
import { LEAD_VIEWS, type LeadView } from "@hub/contract/inbound";
import { KNOWLEDGE_VIEWS, type KnowledgeView } from "@hub/contract/knowledge";
import { MESSENGER_CHANNEL_FILTERS, MESSENGER_LINK_FILTERS, MESSENGER_VIEWS, type MessengerChannelFilter, type MessengerLinkFilter, type MessengerView } from "@hub/contract/messenger-panel";

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

/** The query string (with its `?`, or empty). Empty, false and absent values are left out; a default is dropped by `searchEntries`. */
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

/** A positive integer from the address, or null. `abc`, `0`, `-1`, `1.5` and `007` are not ids. */
export function positiveInt(v: string | undefined): number | null {
  return v !== undefined && /^[1-9]\d*$/.test(v) ? Number(v) : null;
}

// ---- P127 A1 (V1): a route row states its params and search with these specs; `resolve.ts` derives the parsers, the typed
// value and `dest` from them, so no route's search or params are written twice.

/** One path parameter of a route (`[id]`, `[page]`): its text into the value, or null when the address is Not found. */
export type ParamSpec<T> = (raw: string) => T | null;
/** A client or chat id: a canonical positive integer (`abc`, `0`, `007` are Not found). */
export const positiveId: ParamSpec<number> = (v) => positiveInt(v);
/** A client's key (P103): his email, or `id-<n>` without one, in its canonical text; a bare number is Not found (no alias). */
export const clientKeyParam: ParamSpec<string> = (v) => {
  const r = parseClientKey(v);
  return r === null ? null : keyText(r);
};
/** A Notion page id: 32 hex, read with or without its dashes and in any case (P97). */
export const notionPage: ParamSpec<string> = (v) => {
  const p = v.replace(/-/g, "").toLowerCase();
  return /^[0-9a-f]{32}$/.test(p) ? p : null;
};

/** One search key of a route: how its text reads (a value outside the enum resets, rule 8) and the default, whose key the address leaves out. */
export type SearchKeySpec<T> = { readonly read: (raw: string | undefined) => T; readonly fallback: T };
export type SearchSpec = Readonly<Record<string, SearchKeySpec<unknown>>>;
/** The typed value of a search spec. */
export type SearchOf<S> = { -readonly [K in keyof S]: S[K] extends SearchKeySpec<infer T> ? T : never };

/** A view: one of the enum's values, else the default. */
export const view = <T extends string>(all: readonly T[], fallback: T): SearchKeySpec<T> => ({ read: (v) => oneOf(all, v, fallback), fallback });
/** A free text (`?q=`), empty by default. */
export const text: SearchKeySpec<string> = { read: (v) => v ?? "", fallback: "" };
/** An id in the query (`?batch=`, `?client=`), none by default. */
export const queryId: SearchKeySpec<number | null> = { read: (v) => positiveInt(v), fallback: null };
/** A Message-ID in the address (`?m=`, P99: the conversation scrolls to that message), none by default. */
const messageRef: SearchKeySpec<string | null> = { read: (v) => (v !== undefined && v.length >= 3 && v.length <= 998 && !/\s/.test(v) ? v : null), fallback: null };

/** P134 verdict 4: a brand of the list (`?brand=Carapis`), as the rows name it; none by default. Blank or longer than 100: none. */
export const brandParam: SearchKeySpec<string | null> = { read: (v) => (v !== undefined && v.trim() !== "" && v.length <= 100 ? v.trim() : null), fallback: null };

/** Mail's three routes share one search, so a person opened from the list keeps its view, search and batch. `batch` limits the list to the drafts one batch wrote. An old view value (`ready`, `inbox`, `hold`, ...) resets to Needs you; no alias. */
export const MAIL_SEARCH = { filter: view(DRAFT_VIEWS, DEFAULT_DRAFT_VIEW), q: text, batch: queryId, brand: brandParam, m: messageRef } as const;
/** P134 verdicts 6-7: Mail ▸ Leads, its view (New, the default; Not now; Spam; Replied) and a brand. */
export const LEADS_SEARCH = { view: view(LEAD_VIEWS, "new"), brand: brandParam } as const;
export { LEAD_VIEWS, type LeadView };
/** Activity (P73): the kind (P125 L3: `?kind=`, the menu column's; it was `?filter=`, no alias), and `client` narrows the timeline to one client (the draft card's history opens it). */
export const LOG_SEARCH = { kind: view(ACTIVITY_VIEWS, "all"), client: queryId } as const;
/**
 * A topic path of Knowledge's menu column (P125 L2: `api`, `all brands/pricing`): lower case, `/` between levels, at most three
 * levels and 120 characters; anything else is no topic (All). A topic the base does not have shows All too (the menu reads it).
 */
const topic: SearchKeySpec<string> = { read: (v) => (v !== undefined && v.length <= 120 && /^[^/?#]+(\/[^/?#]+){0,2}$/.test(v) ? v.toLowerCase() : ""), fallback: "" };
/** P70: the Knowledge table's view (the same enum the API validates), its title search, and the topic of the menu column (P125 L2). */
export const KNOWLEDGE_SEARCH = { filter: view(KNOWLEDGE_VIEWS, "all"), q: text, topic } as const;
export const AGENT_SEARCH = { filter: view(AGENT_VIEWS, "attention") } as const;
/**
 * The Messengers panel's view (P123 U3b: Needs you, the default, Waiting, All, Mail's words), its link state (`?link=`: any, the
 * default, Linked, Not linked, Hidden) and its channel (All, the default, Telegram, WhatsApp); the enums the API validates.
 */
export const MESSENGERS_SEARCH = { filter: view(MESSENGER_VIEWS, "needs_you"), link: view(MESSENGER_LINK_FILTERS, "any"), channel: view(MESSENGER_CHANNEL_FILTERS, "all"), q: text } as const;

export { KNOWLEDGE_VIEWS, type KnowledgeView };
export { MESSENGER_CHANNEL_FILTERS, MESSENGER_LINK_FILTERS, MESSENGER_VIEWS, type MessengerChannelFilter, type MessengerLinkFilter, type MessengerView };

/** The address's query read by a spec: every key of the spec, each parsed (a key the spec does not know is dropped, rule 8). */
export function readSearch<S extends SearchSpec>(spec: S, raw: Raw): SearchOf<S>;
// The implementation builds the object key by key, which TypeScript cannot follow through a mapped type; the overload above is
// what callers see, and each value is the spec's own `read` of that key.
export function readSearch(spec: SearchSpec, raw: Raw): Record<string, unknown> {
  const out: Record<string, unknown> = {};
  for (const [k, key] of Object.entries(spec)) out[k] = key.read(raw[k]);
  return out;
}

/** The query entries of a search value, in the spec's order, each default left out (so its key leaves the address). */
export function searchEntries(spec: SearchSpec, value: Readonly<Record<string, unknown>>): Record<string, string | number | null | undefined> {
  const out: Record<string, string | number | null | undefined> = {};
  for (const [k, key] of Object.entries(spec)) {
    const v = value[k];
    if (v === undefined || v === key.fallback) continue;
    if (typeof v === "string" || typeof v === "number" || v === null) out[k] = v;
  }
  return out;
}
