import { hubPaths } from "@hub/config/paths";
import { isOpsLevel, isOpsSource, OPS_LEVELS, OPS_SOURCES, opsStoreOf, readOps, type OpsFilter, type OpsLevel, type OpsLine, type OpsSource } from "@hub/log/ops";
import { localStamp, sinceOf } from "./log-command";
import { c, UsageError } from "./term";

// `hub logs` (P86): read the ops log, what failed or happened in the server and every package (`state/log/ops-<day>.jsonl`).
// Not `hub log`, which reads the agent session log. Read only.

export interface LogsOptions { level?: string; source?: string; since?: string; limit?: string; json?: boolean; follow?: boolean }

export function opsFilterOf(o: LogsOptions, now: Date = new Date()): OpsFilter {
  if (o.level !== undefined && !isOpsLevel(o.level)) throw new UsageError(`--level takes ${OPS_LEVELS.join(", ")}, got "${o.level}"`);
  const sources: OpsSource[] = [];
  for (const s of (o.source ?? "").split(",").map((x) => x.trim()).filter(Boolean)) {
    if (!isOpsSource(s)) throw new UsageError(`--source takes ${OPS_SOURCES.join(", ")}, got "${s}"`);
    sources.push(s);
  }
  const level: OpsLevel | undefined = o.level !== undefined && isOpsLevel(o.level) ? o.level : undefined;
  return {
    ...(level ? { level } : {}),
    ...(sources.length ? { sources } : {}),
    since: sinceOf(o.since ?? "1d", now),
  };
}

const LEVEL_COLOR: Record<OpsLevel, (s: string) => string> = { error: c.red, warn: c.yellow, info: (s) => s, debug: c.dim };
const flat = (v: unknown): string => (typeof v === "string" ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v) ?? "");

/** `2026-11-20 18:07:12  error  whatsapp      socket closed status=401 reason=...` (local time; the file keeps UTC). */
export function opsLineText(l: OpsLine): string {
  const fields = l.fields ? Object.entries(l.fields).filter(([k]) => k !== "stack").map(([k, v]) => `${k}=${flat(v)}`).join(" ") : "";
  return `${c.dim(localStamp(l.time))}  ${LEVEL_COLOR[l.level](l.level.padEnd(5))}  ${l.source.padEnd(12)}  ${l.message}${fields ? c.dim(` ${fields}`) : ""}`;
}

/** Prints the matching lines (the newest `--limit`, 200 by default); `--follow` then prints new ones until the process stops. */
export async function runLogsCommand(o: LogsOptions, out: (s: string) => void = console.log, env: NodeJS.ProcessEnv = process.env): Promise<number> {
  const limit = o.limit === undefined ? 200 : Number(o.limit);
  if (!Number.isInteger(limit) || limit < 1) throw new UsageError(`--limit takes a whole number, got "${o.limit}"`);
  const store = opsStoreOf(hubPaths({ env }));
  const f = opsFilterOf(o);
  const lines = readOps(store, f);
  const print = (l: OpsLine) => out(o.json ? JSON.stringify(l) : opsLineText(l));
  const last = lines.slice(-limit);
  if (!last.length && !o.follow) out(c.dim("no ops lines for this filter (state/log/ops-<day>.jsonl)"));
  for (const l of last) print(l);
  if (!o.follow) return 0;
  let seen = lines.length;
  for (;;) {
    await new Promise((r) => setTimeout(r, 1000));
    const now = readOps(store, f);
    for (const l of now.slice(seen)) print(l);
    seen = now.length;
  }
}
