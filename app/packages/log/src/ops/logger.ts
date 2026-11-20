import { hubPaths } from "@hub/config/paths";
import { errorFields, redactOps } from "./redact";
import { appendOps, opsStoreOf, type OpsStore } from "./store";
import { LEVEL_RANK, type OpsLevel, type OpsLine, type OpsSource } from "./line";

// The ops logger (P86): `ops("whatsapp").error("socket closed", { status: 401, reason })`. One call writes one redacted JSON
// line to `<state>/log/ops-<day>.jsonl` and a one-line human copy to stderr (what `state/autostart/launchd.log` keeps). It
// never throws and never blocks on anything but one append.
//
// The file is resolved on the first write (`hubPaths()`): a process with no instance (a CLI outside one) writes stderr only.
// Under Vitest no file and no stderr are written unless a test sets a sink (`setOpsSink`), so a test never writes into a real
// instance. `debug` lines are kept only with `HUB_OPS_DEBUG=1`.

export type OpsFields = Record<string, unknown>;

export interface OpsLogger {
  error(message: string, fields?: OpsFields): void;
  warn(message: string, fields?: OpsFields): void;
  info(message: string, fields?: OpsFields): void;
  debug(message: string, fields?: OpsFields): void;
}

interface Config {
  /** Where lines go; null: resolve from `hubPaths()` on the first write; false: no file. */
  store: OpsStore | null | false;
  stderr: boolean;
  debug: boolean;
  /** A test's capture: gets every line after redaction, instead of the file and stderr. */
  sink: ((line: OpsLine) => void) | null;
  now: () => Date;
}

const underTest = (): boolean => !!process.env.VITEST;
const fresh = (): Config => ({ store: underTest() ? false : null, stderr: !underTest(), debug: process.env.HUB_OPS_DEBUG === "1", sink: null, now: () => new Date() });
let config: Config = fresh();

/** Overrides where lines go (a test's throwaway instance, a CLI that wants no stderr copy). */
export function configureOps(o: { store?: OpsStore | false; stderr?: boolean; debug?: boolean; now?: () => Date }): void {
  config = { ...config, ...(o.store !== undefined ? { store: o.store } : {}), ...(o.stderr !== undefined ? { stderr: o.stderr } : {}), ...(o.debug !== undefined ? { debug: o.debug } : {}), ...(o.now ? { now: o.now } : {}) };
}

/** A test's capture of every line (after redaction); `null` ends it. */
export function setOpsSink(sink: ((line: OpsLine) => void) | null): void {
  config.sink = sink;
}

/** Captures lines into an array until `stop()`; for tests. */
export function captureOps(): { lines: OpsLine[]; stop: () => void } {
  const lines: OpsLine[] = [];
  setOpsSink((l) => lines.push(l));
  return { lines, stop: () => setOpsSink(null) };
}

/** Back to the defaults (tests). */
export function resetOps(): void {
  config = fresh();
}

function storeNow(): OpsStore | false {
  if (config.store === null) {
    try {
      config.store = opsStoreOf(hubPaths());
    } catch {
      config.store = false;
    }
  }
  return config.store;
}

const pad = (n: number): string => String(n).padStart(2, "0");
const flat = (v: unknown): string => (typeof v === "string" ? (/\s/.test(v) ? JSON.stringify(v) : v) : JSON.stringify(v) ?? "");

/** The stderr copy: `18:07:12 error whatsapp: socket closed status=401 reason=...`. */
export function humanLine(l: OpsLine): string {
  const d = new Date(l.time);
  const t = Number.isNaN(d.getTime()) ? l.time : `${pad(d.getHours())}:${pad(d.getMinutes())}:${pad(d.getSeconds())}`;
  const f = l.fields ? Object.entries(l.fields).filter(([k]) => k !== "stack").map(([k, v]) => `${k}=${flat(v)}`).join(" ") : "";
  return `${t} ${l.level} ${l.source}: ${l.message}${f ? ` ${f}` : ""}`;
}

/** Builds, redacts and writes one line. Exported for the CLI's own lines and the tests. Never throws. */
export function writeOps(level: OpsLevel, source: OpsSource, message: string, fields?: OpsFields): void {
  try {
    if (level === "debug" && !config.debug && !config.sink) return;
    const store = config.sink ? false : storeNow();
    const red = redactOps(message, fields, store ? store.secrets : undefined);
    const line: OpsLine = { time: config.now().toISOString(), level, source, message: red.message, ...(red.fields ? { fields: red.fields } : {}) };
    if (config.sink) return void config.sink(line);
    if (store) appendOps(store, line, config.now());
    if (config.stderr && LEVEL_RANK[level] >= LEVEL_RANK.info) process.stderr.write(humanLine(line) + "\n");
  } catch {
    // A log line never breaks its caller.
  }
}

/** The logger of one source. */
export function ops(source: OpsSource): OpsLogger {
  return {
    error: (m, f) => writeOps("error", source, m, f),
    warn: (m, f) => writeOps("warn", source, m, f),
    info: (m, f) => writeOps("info", source, m, f),
    debug: (m, f) => writeOps("debug", source, m, f),
  };
}

/** An error's fields for a line (`{ error: "Name: message", kind }`, and with `stack` its first frames). */
export const errFields = errorFields;
