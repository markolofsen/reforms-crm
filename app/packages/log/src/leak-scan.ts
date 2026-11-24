import { readdirSync, statSync } from "node:fs";
import path from "node:path";
import { readDayFile } from "./day-file";

// P137 verdict 6 (L5): what may never be found in a log file, checked after the fact over the files themselves (the redactor is
// the one door; this is the test that the door held). Used by `test/log-privacy.test.ts` over lines the real writers wrote, and
// by the e2e run's last spec over a whole day of its stack's logs.

/** A full address: a local part that is not the redactor's `m***`. */
const ADDRESS = /\b[A-Za-z0-9._%+-]{2,}@(?:[A-Za-z0-9-]+\.)+[A-Za-z]{2,}\b/g;
/** Token shapes (the same families `@hub/connections` masks): Anthropic, OpenAI-style, Notion, GitHub, Slack, AWS, JWT, a Telegram bot token. */
const TOKEN = /\b(?:sk-ant-[A-Za-z0-9_-]{6,}|sk-[A-Za-z0-9_-]{20,}|ntn_[A-Za-z0-9]{6,}|secret_[A-Za-z0-9]{10,}|gh[pousr]_[A-Za-z0-9]{20,}|xox[abposr]-[A-Za-z0-9-]{10,}|AKIA[0-9A-Z]{16}|eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}|\d{5,}:[A-Za-z0-9_-]{20,})\b/g;
/** A body field of an ops line that holds anything but the redactor's mark. */
const BODY = /"(?:text|body|content|html|plain|message_?text|caption|snippet|excerpt|quote)":"(?!\[body omitted\])[^"]/;

export interface Leak { file: string; line: number; kind: "address" | "token" | "body" | "known"; sample: string }

/** The leaks of one file's text. `known`: strings that must never appear (the seed's client addresses, a test's token). */
export function leaksIn(text: string, file: string, o: { known?: readonly string[]; opsLog: boolean }): Leak[] {
  const out: Leak[] = [];
  text.split("\n").forEach((l, i) => {
    if (!l.trim()) return;
    const sample = (m: string) => `${m.slice(0, 3)}…`;
    for (const k of o.known ?? []) if (k && l.includes(k)) out.push({ file, line: i + 1, kind: "known", sample: sample(k) });
    for (const m of l.match(TOKEN) ?? []) out.push({ file, line: i + 1, kind: "token", sample: sample(m) });
    // The session log keeps the owner's own prompts; only the ops log is held to "no address, no body".
    if (o.opsLog) {
      for (const m of l.match(ADDRESS) ?? []) out.push({ file, line: i + 1, kind: "address", sample: sample(m) });
      if (BODY.test(l)) out.push({ file, line: i + 1, kind: "body", sample: "body field" });
    }
  });
  return out;
}

/** Every day file under `<state>/log` (the ops log at the top, the session log's project folders), plain or gzipped. */
export function scanLogs(dir: string, o: { known?: readonly string[] } = {}): Leak[] {
  const out: Leak[] = [];
  const walk = (d: string, top: boolean) => {
    let names: string[] = [];
    try { names = readdirSync(d); } catch { return; }
    for (const n of names) {
      const f = path.join(d, n);
      let dirEntry = false;
      try { dirEntry = statSync(f).isDirectory(); } catch { continue; }
      if (dirEntry) { if (top) walk(f, false); continue; }
      if (!/\.jsonl(\.gz)?$/.test(n)) continue;
      let text = "";
      try { text = readDayFile(f); } catch { continue; }
      out.push(...leaksIn(text, path.relative(dir, f), { ...o, opsLog: top && n.startsWith("ops-") }));
    }
  };
  walk(dir, true);
  return out;
}
