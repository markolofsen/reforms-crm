import { readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { API_VERSION } from "@hub/contract/health";
import { liveTopic, MAX_LIVE_SUBSCRIBERS, type LiveChangeDto, type LiveEvent, type LiveTopic } from "@hub/contract/live";
import { bumpTopic, liveSeq, liveSince, TOPIC_PREFIX, type Db, type LiveChange, type LiveTable } from "@hub/db";
import { errFields, ops } from "@hub/log/ops";

// Live panels (P50, decision 0028). A tailer reads the trigger counter of `@hub/db` every 200 ms and, when it moved,
// sends every subscriber one tiny frame naming the topics and projects that changed. It never sends data: the admin
// refetches through the normal API. Read-only: no route here writes a row the owner can see (a `bumpTopic` of a watched
// source writes only the live counter).

/** Each table is one topic; `tsc` fails here when a table is added to `schema.ts` without one. */
export const TABLE_TOPIC: Record<LiveTable, LiveTopic> = {
  // P55: the same store and topic as the safety rules.
  agent_settings: "rules",
  agent_events: "activity",
  agent_runs: "activity",
  batches: "batches",
  client_identifiers: "clients",
  clients: "clients",
  drafts: "drafts",
  enrollments: "follow-ups",
  inbox_rows: "inbox",
  // P96: a client message the Mail reader stored, or No reply needed: the Inbox view, its count and the status line move.
  inbound_mail: "inbox",
  knowledge_docs: "knowledge",
  // P97 S2: the Leads reader stored or closed a lead, or the owner pressed Not now or Spam: the Inbox's Leads group and the status line move.
  lead_rows: "inbox",
  // P78: the ledger moves only the Overview's LLM part; `health` is the topic whose keys hold Overview and its parts.
  llm_calls: "health",
  // P65: a version row is written exactly when the Hub wrote or moved a Mail draft, so the open card reads Mail again.
  mail_versions: "mail",
  // P65 S5: a write the Hub started or settled. Not `mail`: a start must not make the open card read a slow Mail mid-write.
  mail_writes: "drafts",
  marks: "clients",
  messenger_accounts: "messengers",
  messenger_chats: "messengers",
  messenger_drafts: "messengers",
  messenger_link_refusals: "messengers",
  messenger_messages: "messengers",
  // P71 M-P: a verdict moves the panel's counts by reason.
  messenger_triage: "messengers",
  project_addresses: "projects",
  project_questions: "projects",
  projects: "projects",
  safety_rules: "rules",
  send_control: "sends",
  send_log: "sends",
};

const isTable = (t: string): t is LiveTable => Object.hasOwn(TABLE_TOPIC, t);

/** The topic of one moved source, or null for a name this core does not know (a newer core's table). */
export function topicOf(tbl: string): LiveTopic | null {
  if (tbl.startsWith(TOPIC_PREFIX)) {
    const t = liveTopic.safeParse(tbl.slice(TOPIC_PREFIX.length));
    return t.success ? t.data : null;
  }
  return isTable(tbl) ? TABLE_TOPIC[tbl] : null;
}

/** Moved sources as topic changes, each topic and project once. */
export function changesOf(rows: LiveChange[]): LiveChangeDto[] {
  const out = new Map<string, LiveChangeDto>();
  for (const r of rows) {
    const topic = topicOf(r.tbl);
    if (topic) out.set(`${topic}\u0000${r.project}`, { topic, project: r.project === "" ? null : r.project });
  }
  return [...out.values()];
}

/** One SSE frame (unnamed event, `data:` one JSON line). A `change` carries `id:` so the browser resumes after it. */
export function frameOf(e: LiveEvent, retryMs?: number): string {
  return `${retryMs ? `retry: ${retryMs}\n` : ""}${e.type === "change" ? `id: ${e.seq}\n` : ""}data: ${JSON.stringify(e)}\n\n`;
}
export const PING_FRAME = ": ping\n\n";

/** Where a frame goes: the SSE stream of one request. `send` resolves when the socket took it. */
export interface LiveSink {
  send(frame: string): Promise<void>;
  close(): void;
}

/**
 * A source that is not a table row: its signature is compared every `everyMs`, and a change bumps its topic for the whole
 * instance. The keyed form (P59) gives one signature per project slug and bumps each project whose signature moved.
 */
export type LiveWatch = { topic: LiveTopic; everyMs: number } & ({ signature: () => string } | { signatures: () => Record<string, string> });

export interface LiveOptions {
  db: Db;
  watch?: LiveWatch[];
  pollMs?: number;
  coalesceMs?: number;
  pingMs?: number;
  retryMs?: number;
  maxSubscribers?: number;
}

type Sub = { sink: LiveSink; busy: boolean; behind: boolean };

/** The reset a resume point earns: it must be a whole number not above the counter now. */
export function resumeOf(lastId: string | undefined, now: number): "none" | "reset" | number {
  if (lastId === undefined || lastId === "") return "none";
  if (!/^\d{1,15}$/.test(lastId)) return "reset";
  const n = Number(lastId);
  return n > now ? "reset" : n;
}

export function createLive(o: LiveOptions) {
  const pollMs = o.pollMs ?? 200;
  const coalesceMs = o.coalesceMs ?? 100;
  const pingMs = o.pingMs ?? 15_000;
  const retryMs = o.retryMs ?? 1000;
  const max = o.maxSubscribers ?? MAX_LIVE_SUBSCRIBERS;
  const subs = new Set<Sub>();
  const watched = (o.watch ?? []).map((w) => ({ w, last: snapshot(w), at: 0 }));
  let last = liveSeq(o.db);
  let tailer: ReturnType<typeof setInterval> | undefined;
  let pinger: ReturnType<typeof setInterval> | undefined;
  let flushing: ReturnType<typeof setTimeout> | undefined;
  let elapsed = 0;

  function deliver(s: Sub, frame: string): void {
    if (s.busy) {
      s.behind = true; // at most one pending frame: the next one the client gets is a reset
      return;
    }
    s.busy = true;
    s.sink.send(frame).then(
      () => {
        s.busy = false;
        if (s.behind) {
          s.behind = false;
          deliver(s, frameOf({ type: "reset", seq: last }));
        }
      },
      () => drop(s),
    );
  }

  function broadcast(frame: string): void {
    for (const s of subs) deliver(s, frame);
  }

  function flush(): void {
    flushing = undefined;
    const now = liveSeq(o.db);
    if (now < last) {
      // The counter went back: a restored backup or another database file. Nothing before it means anything.
      last = now;
      broadcast(frameOf({ type: "reset", seq: now }));
      return;
    }
    const r = liveSince(o.db, last);
    last = r.seq;
    const changes = changesOf(r.changes);
    if (changes.length > 0) broadcast(frameOf({ type: "change", seq: r.seq, changes }));
  }

  function tick(): void {
    elapsed += pollMs;
    for (const x of watched) {
      if (elapsed - x.at < x.w.everyMs) continue;
      x.at = elapsed;
      const sig = snapshot(x.w);
      for (const project of movedKeys(x.last, sig)) bumpTopic(o.db, x.w.topic, project);
      x.last = sig;
    }
    if (flushing === undefined && liveSeq(o.db) !== last) flushing = setTimeout(flush, coalesceMs);
  }

  function start(): void {
    if (tailer) return;
    last = liveSeq(o.db);
    tailer = setInterval(() => {
      try {
        tick();
      } catch (e) {
        // A busy database for one tick is not worth a crash: the next tick reads again.
        ops("server").warn("live: a tick of the change feed failed; the next one reads again", errFields(e));
      }
    }, pollMs);
    pinger = setInterval(() => {
      for (const s of subs) if (!s.busy) deliver(s, PING_FRAME);
    }, pingMs);
  }

  function drop(s: Sub): void {
    if (!subs.delete(s)) return;
    s.sink.close();
  }

  return {
    full: () => subs.size >= max,
    count: () => subs.size,
    /** Adds a stream: hello first, then what moved since `lastId` (or a reset when the server cannot say). Null when full. */
    subscribe(sink: LiveSink, lastId: string | undefined): { unsubscribe: () => void } | null {
      if (subs.size >= max) return null;
      start();
      const s: Sub = { sink, busy: false, behind: false };
      subs.add(s);
      const now = liveSeq(o.db);
      const resume = resumeOf(lastId, now);
      let first = frameOf({ type: "hello", seq: now, apiVersion: API_VERSION }, retryMs);
      if (resume === "reset") first += frameOf({ type: "reset", seq: now });
      else if (typeof resume === "number" && resume < now) {
        const changes = changesOf(liveSince(o.db, resume).changes);
        if (changes.length > 0) first += frameOf({ type: "change", seq: now, changes });
      }
      deliver(s, first);
      return { unsubscribe: () => void subs.delete(s) };
    },
    stop(): void {
      clearInterval(tailer);
      clearInterval(pinger);
      clearTimeout(flushing);
      tailer = undefined;
      for (const s of [...subs]) drop(s);
    },
  };
}
export type LiveService = ReturnType<typeof createLive>;

/** A watch's signature now: one text, or one per project. A source that throws reads as empty (missing). */
function snapshot(w: LiveWatch): string | Record<string, string> {
  try {
    return "signatures" in w ? w.signatures() : w.signature();
  } catch {
    return "signatures" in w ? {} : "";
  }
}

/** What to bump between two snapshots: `null` (the instance) for a plain watch, else each project whose signature moved, came or went. */
export function movedKeys(before: string | Record<string, string>, after: string | Record<string, string>): Array<string | null> {
  if (typeof before === "string" || typeof after === "string") return before === after ? [] : [null];
  return [...new Set([...Object.keys(before), ...Object.keys(after)])].filter((k) => before[k] !== after[k]).sort();
}

/**
 * The agent session log's signature per project (P59): the names, sizes and times of the two newest day files (`*.jsonl`)
 * of each project folder under `state/log`. The `.cursor/` folder (it moves at every Codex Stop, before the lines) and
 * `_unbound` are not compared. About one `stat` per file per tick (0.006 ms measured).
 */
export function logSignatures(dir: string): Record<string, string> {
  const out: Record<string, string> = {};
  let names: string[] = [];
  try { names = readdirSync(dir, { withFileTypes: true }).filter((d) => d.isDirectory() && !d.name.startsWith(".") && !d.name.startsWith("_")).map((d) => d.name); } catch { return out; }
  for (const p of names) {
    try {
      const days = readdirSync(join(dir, p)).filter((n) => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n)).sort().slice(-2);
      out[p] = days.map((n) => { const s = statSync(join(dir, p, n)); return `${n}:${s.size}:${s.mtimeMs}`; }).join("|");
    } catch {
      out[p] = "missing";
    }
  }
  return out;
}

/** The Connections files' signature (names, sizes, times): a `hub token` in a terminal or a hand edit moves it. */
export function folderSignature(dir: string): string {
  try {
    return readdirSync(dir)
      .sort()
      .map((n) => {
        const s = statSync(join(dir, n));
        return `${n}:${s.size}:${s.mtimeMs}`;
      })
      .join("|");
  } catch {
    return "missing";
  }
}
