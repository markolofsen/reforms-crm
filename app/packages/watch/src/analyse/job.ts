import type { Llm, LlmErrorKind, WindowEntry, WindowItem } from "@hub/llm";
import type { LensFacets } from "@hub/contract/lens";
import type { LoadedLens } from "../lens/load";
import type { NewMoment, WatchMessage, WatchStore } from "../store/repo";
import { authorKey, scriptAuthors } from "./scripts";

/**
 * The window analysis of one group (P144 W5, verdicts 8 and 13): the lens's window task over the messages the store has not
 * analysed yet, with the overlap before them, then the keep-filter, then one stored window and its moments. Ported from the
 * experiment's `analyse.py`: repeated texts are dropped before windowing, ids are joined in code from `[n]`, an index outside the
 * window or the speaker's own message among the reactors is dropped, a moment seen twice (same message, same trigger) is
 * kept once, and an author who shares a script with others in the group (`facets.scripts`, the experiment's `shill.py`) loses
 * his moments. It runs inside the watcher's own poller (after at least 100 new messages, or every 6 hours), never on a timer of
 * its own, and the task's budget ($2 a month by default) is checked before every attempt by `@hub/llm`.
 */

/** A poll stored this many new messages in a group: analyse now. */
export const ANALYSE_AFTER_MESSAGES = 100;
/** Otherwise at most this long between two analyses of a group that has anything new. */
export const ANALYSE_EVERY_MS = 6 * 3_600_000;

/** Failures after which a run stops instead of trying the next window: nothing else would get through. */
const STOPS: readonly LlmErrorKind[] = ["budget", "no_key", "auth", "credits"];

export interface GroupAnalysis {
  windows: number;
  failedWindows: number;
  moments: number;
  /** Authors of the group marked by the lens's script rule (their moments are dropped). */
  scriptAuthors: number;
  costMicroUsd: number;
  /** Why the run stopped early (the cap or the task budget, no key, the key refused), else null. */
  stopped: LlmErrorKind | null;
}

/** Whether a group is due: enough new messages, or something new and the last analysis (or its adding) long enough ago. */
export function analysisDue(g: { newSinceAnalysis: number; lastAnalysisAt: string | null; addedAt: string }, now: Date): boolean {
  if (g.newSinceAnalysis >= ANALYSE_AFTER_MESSAGES) return true;
  if (g.newSinceAnalysis === 0) return false;
  return now.getTime() - Date.parse(g.lastAnalysisAt ?? g.addedAt) >= ANALYSE_EVERY_MS;
}

/** The keep-filter: every condition holds (for crypto, the speaker's own position and no promoter). */
export const kept = (entry: Record<string, unknown>, keep: LensFacets["keep"]): boolean => (keep ?? []).every((k) => entry[k.field] === k.equals);

const str = (v: unknown): string => (typeof v === "string" ? v : "");
const intensityOf = (v: unknown): number => (typeof v === "number" && Number.isFinite(v) ? Math.max(1, Math.min(5, Math.round(v))) : 1);

/** One kept entry as a stored moment, or null when the keep-filter drops it (a failed condition, or a marked script author). */
export function momentOf(e: WindowEntry, f: LensFacets, byId: ReadonlyMap<string, WatchMessage>, group: string, windowKey: string, scripted: ReadonlySet<string> = new Set()): NewMoment | null {
  if (!kept(e.entry, f.keep)) return null;
  const m = byId.get(e.itemId);
  if (!m) return null;
  const who = authorKey(m);
  if (who !== null && scripted.has(who)) return null;
  const reactors = (f.reactors ? (e.refs[f.reactors] ?? []) : []).flatMap((id) => {
    const r = byId.get(id);
    return r ? [r.senderHandle ?? (r.senderId ? `user${r.senderId}` : "someone")] : [];
  });
  return {
    groupUsername: group,
    messageId: m.messageId,
    trigger: str(e.entry[f.trigger]) || "other",
    triggerOther: f.triggerOther ? str(e.entry[f.triggerOther]).trim() : "",
    intensity: intensityOf(e.entry[f.intensity]),
    quote: str(e.entry[f.quote]).slice(0, 500),
    authorId: m.senderId,
    authorHandle: m.senderHandle,
    reactorHandles: [...new Set(reactors)].filter((h) => h !== m.senderHandle),
    context: f.context ? str(e.entry[f.context]).slice(0, 300) : "",
    why: f.why ? str(e.entry[f.why]).slice(0, 300) : "",
    windowKey,
    at: m.sentAt,
  };
}

/** What the model sees of a message: the handle, or a stable alias for a person with none; never a phone or a name. */
export const authorOf = (m: WatchMessage): string | null => m.senderHandle ?? (m.senderId ? `user${m.senderId}` : null);

export async function analyseGroup(d: { llm: Llm; store: WatchStore; lens: LoadedLens; now: () => Date }, username: string): Promise<GroupAnalysis> {
  const { size, overlap } = d.lens.task.shape;
  const all = d.store.messagesOf(username);
  const done = d.store.windowsLastMessage(username);
  const firstNew = all.findIndex((m) => m.messageId > done);
  const out: GroupAnalysis = { windows: 0, failedWindows: 0, moments: 0, scriptAuthors: 0, costMicroUsd: 0, stopped: null };
  if (firstNew < 0) {
    d.store.setGroup(username, { newSinceAnalysis: 0, lastAnalysisAt: d.now().toISOString() });
    return out;
  }
  // The script rule reads every stored message of the group: a template shows across days, not inside one window.
  const scripted = scriptAuthors(all, d.lens.facets.scripts);
  out.scriptAuthors = scripted.size;
  const slice = all.slice(Math.max(0, firstNew - overlap));
  const byId = new Map(slice.map((m) => [String(m.messageId), m]));
  const items: WindowItem[] = slice.map((m) => ({ id: String(m.messageId), text: m.text, author: authorOf(m) }));
  const results = await d.llm.run(d.lens.task, { project: d.store.project, items, dedupe: true });
  for (const w of results) {
    if (!w.ok) {
      out.failedWindows += 1;
      if (STOPS.includes(w.error.code)) out.stopped = w.error.code;
      continue;
    }
    const first = byId.get(w.itemIds[0] ?? "");
    const last = byId.get(w.itemIds.at(-1) ?? "");
    if (!first || !last) continue;
    const windowKey = `w${size}o${overlap}:${username}:${first.messageId}-${last.messageId}`;
    const moments = w.entries.flatMap((e) => momentOf(e, d.lens.facets, byId, username, windowKey, scripted) ?? []);
    const topicsField = d.lens.window.topics;
    const moodField = d.lens.window.mood;
    const value: unknown = w.value;
    const rec = typeof value === "object" && value !== null ? Object.fromEntries(Object.entries(value)) : {};
    const topicsRaw = topicsField ? rec[topicsField] : undefined;
    const topics = Array.isArray(topicsRaw) ? topicsRaw.filter((t): t is string => typeof t === "string").slice(0, 10) : [];
    const mood = moodField && typeof rec[moodField] === "string" ? String(rec[moodField]).slice(0, 120) : null;
    out.moments += d.store.recordWindow({ windowKey, groupUsername: username, firstMessageId: first.messageId, lastMessageId: last.messageId, messages: w.itemIds.length, taskVersion: d.lens.task.version, model: w.model, costMicroUsd: w.costMicroUsd, topics, mood, firstAt: first.sentAt, lastAt: last.sentAt }, moments, d.now());
    out.windows += 1;
    out.costMicroUsd += w.costMicroUsd;
  }
  // A run the cap or the key stopped leaves the count, so the next due run asks again; otherwise the group is up to date.
  if (out.stopped === null) d.store.setGroup(username, { newSinceAnalysis: 0, lastAnalysisAt: d.now().toISOString() });
  return out;
}
