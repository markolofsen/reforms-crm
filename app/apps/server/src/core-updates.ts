import { execFile } from "node:child_process";
import { statSync } from "node:fs";
import { currentCoreUpdate, refreshCoreUpdate, uncheckedCoreUpdate, type CommandRun } from "@hub/config/core-version";
import type { HubPaths } from "@hub/config/paths";
import { CORE_CHECK_GUARD_MS, coreUpdateDto, type CoreUpdateDto } from "@hub/contract/instance";
import { ops } from "@hub/log/ops";

// P68 (decision 0034): the server's side of "the admin knows when the core can be updated". A timer runs the check of
// `@hub/config/core-version` 2 minutes after start (clear of the start-up build and P64's resume), then every 6 hours; "Check now"
// runs it at once, at most once a minute. A request never reaches the network: `GET` reads the cache file.

export const FIRST_CHECK_MS = 2 * 60_000;
export const CHECK_EVERY_MS = 6 * 60 * 60_000;

/** git through `execFile` (argv only), the server's environment plus the check's own (no prompt), and the check's timeout. */
export const execRun: CommandRun = (cmd, args, o = {}) =>
  new Promise((resolve) => {
    execFile(cmd, args, { timeout: o.timeoutMs ?? 30_000, maxBuffer: 4 * 1024 * 1024, env: { ...process.env, ...(o.env ?? {}) } }, (err, stdout, stderr) => {
      const code = !err ? 0 : typeof err.code === "number" ? err.code : 1;
      resolve({ code, stdout: String(stdout), stderr: String(stderr) || (err && err.killed ? `timed out after ${o.timeoutMs ?? 30_000} ms` : "") });
    });
  });

/**
 * The test server's runner (`HUB_MAILER=fake`, e2e and demos): local git reads run, the two calls that reach the origin fail with
 * this reason, so "Check now" shows the offline path and no test needs the network.
 */
export const offlineRun = (inner: CommandRun = execRun): CommandRun => async (cmd, args, o) =>
  args.includes("ls-remote") || args.includes("fetch") ? { code: 1, stdout: "", stderr: "a test server does not reach the origin (HUB_MAILER=fake)" } : inner(cmd, args, o);

/** "Check now" again within a minute. */
export class CheckTooSoon extends Error {
  constructor(readonly retryAfterS: number) {
    super(`Checked less than a minute ago: try again in ${retryAfterS} s.`);
  }
}

export interface CoreUpdatesOptions {
  paths: Pick<HubPaths, "home" | "core" | "coreUpdate">;
  run: CommandRun;
  /** Start the timer (`start()`); off under the fake Mailer, where only "Check now" runs (offline). */
  auto: boolean;
  now?: () => Date;
  firstMs?: number;
  everyMs?: number;
  guardMs?: number;
  log?: (line: string) => void;
}

export interface CoreUpdatesService {
  /** The cached answer; never a git call. */
  read(): CoreUpdateDto;
  /** One check now; {@link CheckTooSoon} within the guard of the last one. */
  check(): Promise<CoreUpdateDto>;
  start(): void;
  stop(): void;
  /** For the live topic `core`: moves when a check finished or the cache file changed. */
  signature(): string;
}

export function createCoreUpdates(o: CoreUpdatesOptions): CoreUpdatesService {
  const now = o.now ?? (() => new Date());
  const log = o.log ?? ((l: string) => ops("core").warn(l));
  const guardMs = o.guardMs ?? CORE_CHECK_GUARD_MS;
  let lastStart = -Infinity;
  let running: Promise<CoreUpdateDto> | null = null;
  let version = 0;
  const timers: ReturnType<typeof setTimeout>[] = [];
  const parse = (v: unknown): CoreUpdateDto => {
    const r = coreUpdateDto.safeParse(v);
    return r.success ? r.data : coreUpdateDto.parse(uncheckedCoreUpdate(o.paths.home, "the cached answer is from another core version: not checked since"));
  };
  const run = (): Promise<CoreUpdateDto> => {
    if (running) return running;
    lastStart = now().getTime();
    running = refreshCoreUpdate(o.run, o.paths, now)
      .then((r) => {
        if (r.error) log(`core update check: ${r.error.message}`);
        return parse(r);
      })
      .catch((e: unknown) => {
        log(`core update check: ${e instanceof Error ? e.message : String(e)}`);
        return parse(currentCoreUpdate(o.paths));
      })
      .finally(() => {
        version++;
        running = null;
      });
    return running;
  };
  return {
    read: () => parse(currentCoreUpdate(o.paths)),
    check() {
      if (running) return running;
      const left = lastStart + guardMs - now().getTime();
      if (left > 0) return Promise.reject(new CheckTooSoon(Math.ceil(left / 1000)));
      return run();
    },
    start() {
      if (!o.auto || timers.length) return;
      const first = setTimeout(() => {
        void run();
        const every = setInterval(() => void run(), o.everyMs ?? CHECK_EVERY_MS);
        every.unref?.();
        timers.push(every);
      }, o.firstMs ?? FIRST_CHECK_MS);
      first.unref?.();
      timers.push(first);
    },
    stop() {
      for (const t of timers.splice(0)) clearTimeout(t);
    },
    signature() {
      let file = "none";
      try {
        const st = statSync(o.paths.coreUpdate);
        file = `${st.size}:${st.mtimeMs}`;
      } catch {
        /* no check yet */
      }
      return `${version}|${file}`;
    },
  };
}
