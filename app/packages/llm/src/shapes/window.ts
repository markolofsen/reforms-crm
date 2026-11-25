import type { z } from "zod";
import type { CallDeps } from "../retry/ladder";
import type { Task, WindowShape } from "../task";
import { isRecord, LlmError } from "../transport/types";
import { pool } from "./batch";
import { runObject } from "./object";

/**
 * The `window` shape (decision 0051, P144): one answer about a stretch of ordered messages, not one answer per message. The
 * meaning of a public conversation sits across messages (a question, the replies, the "same here"), so a window of `size`
 * messages is read as one conversation, and the next window starts `size - overlap` later so a thread cut at one edge is whole in
 * the next. Ported from the experiment's `analyse.py`, where 100 with 20 cost $0.016 per 1 000 messages and lost no window.
 *
 * - Messages are shown as `[n] author: text`, n from 1, one line each, cut at `maxChars`; a run of one character or emoji is
 *   shortened (runs made the model loop until it was cut).
 * - The answer points at messages only by `[n]`: ids are joined here, never copied by the model. An index outside the window
 *   drops its entry.
 * - An entry seen in two windows' overlap (the same speaker message and the same `key` value) is kept once, in the first.
 * - `dedupe` drops a text already seen earlier in the list before windowing (a repeated text is spam, not conversation).
 * - One failed window never fails the others: each window is its own result.
 */

export interface WindowItem {
  /** The caller's id of the message (the store's key); returned on every entry that points at it. */
  id: string;
  text: string;
  /** How the speaker is named to the model (a handle or a stable alias); null shows as "someone". */
  author: string | null;
}

export interface WindowInput {
  project: string;
  /** One conversation's messages, oldest first. */
  items: readonly WindowItem[];
  /** Lines added after the task's system text for this call only. */
  instructions?: string;
  dedupe?: boolean;
  /** Characters per message shown (default 500). */
  maxChars?: number;
}

/** One entry of the answer's list with its indexes mapped back to item ids. */
export interface WindowEntry {
  entry: Record<string, unknown>;
  /** The id of the message `index` points at. */
  itemId: string;
  /** Each `refs` field as item ids (out-of-window indexes and the speaker's own message dropped). */
  refs: Record<string, string[]>;
}

interface WindowSpan {
  /** Positions in the (deduplicated) item list, inclusive. */
  from: number;
  to: number;
  itemIds: string[];
}

export type WindowResult<T> =
  | (WindowSpan & { ok: true; value: T; entries: WindowEntry[]; model: string; costMicroUsd: number })
  | (WindowSpan & { ok: false; error: LlmError });

/** The instruction appended to the task's system text: stable, so a provider's prompt cache can reuse the prefix. */
export const WINDOW_RULE =
  'You get one window of a conversation: numbered messages in time order, one per line, each as "[n] author: text". Read it as a conversation: meaning often sits across several messages. Point at messages only by their [n].';

const RUN = /(\S)\1{3,}|([^\w\s]{2})\2{2,}/gu;

/** One message as the model sees it. */
export const renderLine = (n: number, item: WindowItem, maxChars: number): string =>
  `[${n}] ${item.author ?? "someone"}: ${item.text.slice(0, maxChars).replace(/\s*\n\s*/g, " ").replace(RUN, (m) => m.slice(0, 3))}`;

/** The text with repeats dropped (first kept), compared trimmed and case-folded. */
export function dedupeItems(items: readonly WindowItem[]): WindowItem[] {
  const seen = new Set<string>();
  return items.filter((it) => {
    const k = it.text.trim().toLowerCase();
    if (k === "" || seen.has(k)) return false;
    seen.add(k);
    return true;
  });
}

/** Window starts over `n` items: every `size - overlap`, while a window still adds items past the overlap; a short tail (below `min(size, 10)`) is not a conversation. */
export function cutWindows(n: number, size: number, overlap: number): Array<{ from: number; to: number }> {
  const step = Math.max(1, size - overlap);
  const least = Math.min(size, 10);
  const out: Array<{ from: number; to: number }> = [];
  for (let start = 0; start < Math.max(1, n - overlap); start += step) {
    const to = Math.min(n, start + size) - 1;
    if (to - start + 1 >= least) out.push({ from: start, to });
  }
  return out;
}

const indexOf = (v: unknown, size: number): number | null => (typeof v === "number" && Number.isInteger(v) && v >= 1 && v <= size ? v : null);

/** The list's entries with `[n]` mapped to ids; entries whose speaker index is outside the window are dropped. */
export function mapEntries(value: unknown, shape: WindowShape, ids: readonly string[]): WindowEntry[] {
  const raw: unknown = isRecord(value) ? value[shape.list] : undefined;
  const list: readonly unknown[] = Array.isArray(raw) ? raw : [];
  const out: WindowEntry[] = [];
  for (const entry of list) {
    if (!isRecord(entry)) continue;
    const n = indexOf(entry[shape.index], ids.length);
    const itemId = n === null ? undefined : ids[n - 1];
    if (n === null || itemId === undefined) continue;
    const refs: Record<string, string[]> = {};
    for (const f of shape.refs ?? []) {
      const got = Array.isArray(entry[f]) ? entry[f] : [];
      const mapped = got.flatMap((v: unknown) => {
        const k = indexOf(v, ids.length);
        const id = k === null || k === n ? undefined : ids[k - 1];
        return id === undefined ? [] : [id];
      });
      refs[f] = [...new Set(mapped)];
    }
    out.push({ entry, itemId, refs });
  }
  return out;
}

const repeatKey = (e: WindowEntry, shape: WindowShape): string => `${e.itemId}\u0000${shape.key ? JSON.stringify(e.entry[shape.key] ?? null) : ""}`;

/** A `window` task's run: windows through the ladder (at most `concurrency` at once), entries mapped and deduplicated across windows. */
export async function runWindowTask<S extends z.ZodType>(task: Task<S, WindowShape>, call: WindowInput, deps: CallDeps): Promise<Array<WindowResult<z.output<S>>>> {
  const shape = task.shape;
  const items = call.dedupe ? dedupeItems(call.items) : [...call.items];
  const maxChars = call.maxChars ?? 500;
  const spans = cutWindows(items.length, shape.size, shape.overlap).map(({ from, to }): WindowSpan => ({ from, to, itemIds: items.slice(from, to + 1).map((i) => i.id) }));
  const results = await pool(
    spans.map((span) => async (): Promise<WindowResult<z.output<S>>> => {
      const text = items.slice(span.from, span.to + 1).map((it, k) => renderLine(k + 1, it, maxChars)).join("\n");
      try {
        const r = await runObject(task, { project: call.project, input: text, ...(call.instructions ? { instructions: call.instructions } : {}) }, deps, shape.maxTokens ?? 4096, WINDOW_RULE);
        return { ...span, ok: true, value: r.value, entries: mapEntries(r.value, shape, span.itemIds), model: r.model, costMicroUsd: r.costMicroUsd };
      } catch (e) {
        return { ...span, ok: false, error: e instanceof LlmError ? e : new LlmError("upstream", e instanceof Error ? e.message.slice(0, 300) : "the window failed") };
      }
    }),
    shape.concurrency ?? 2,
  );
  // Results are in window order, so the first window that saw an entry keeps it.
  const seen = new Set<string>();
  return results.map((r) => {
    if (!r.ok) return r;
    const entries = r.entries.filter((e) => {
      const k = repeatKey(e, shape);
      if (seen.has(k)) return false;
      seen.add(k);
      return true;
    });
    return { ...r, entries };
  });
}
