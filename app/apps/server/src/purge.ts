import { purgeNow } from "@hub/messengers";
import type { Repos } from "@hub/db";
import { ops } from "@hub/log/ops";

// The messenger retention purge of the server (P71 M2b, research 26 gap 2): it runs when the server starts and then on its
// own timer, whatever channel is connected. Before, only a running poller purged, so an instance with no bot token and no
// user account kept expired rows forever. The pollers keep their own purge; a second delete of nothing costs one indexed query.

/** How often the server purges after its start. */
export const PURGE_EVERY_MS = 3_600_000;

export interface PurgeHandle {
  /** Resolves with the count of the start's purge (tests). */
  first: Promise<number>;
  stop(): void;
}

export function startPurge(o: { repos: Repos; everyMs?: number; now?: () => Date; log?: (line: string, failed: boolean) => void }): PurgeHandle {
  const now = o.now ?? (() => new Date());
  // P86: the ops log by default (a purge is `info`, a failed one `error`); a test passes its own.
  const log = o.log ?? ((line: string, failed: boolean) => (failed ? ops("db").error(line) : ops("db").info(line)));
  const once = async (): Promise<number> => {
    try {
      const n = await purgeNow(o.repos, now());
      if (n) log(`messengers: purged ${n} message(s) past retention`, false);
      return n;
    } catch (e) {
      // A busy or failing database must not stop the server: the next tick tries again.
      log(`messengers: retention purge failed (${e instanceof Error ? e.message : String(e)}); next try in ${Math.round((o.everyMs ?? PURGE_EVERY_MS) / 60_000)} min`, true);
      return 0;
    }
  };
  const first = once();
  const timer = setInterval(() => void once(), o.everyMs ?? PURGE_EVERY_MS);
  timer.unref();
  return { first, stop: () => clearInterval(timer) };
}
