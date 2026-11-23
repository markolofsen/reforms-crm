import { NO_APPS, type AppsDto } from "@hub/contract/local";
import type { AppProbe } from "@hub/projects/local-open";

/** How often the server asks again (P131 verdict 1): an app installed while the Hub runs is seen within ten minutes. */
export const APPS_PROBE_MS = 10 * 60_000;

export interface AppsProbe {
  /** The last answer; every app false before the first probe or when the probe failed (so the web link is used). */
  status(): AppsDto;
  /** Probes now (Settings ▸ This Mac's Check again) and returns the answer. */
  check(): AppsDto;
  stop(): void;
}

/** Probes at start and every `everyMs`; the probe itself opens, launches and reveals nothing (`@hub/projects/local-open`). */
export function startAppsProbe(probe: AppProbe, o: { everyMs?: number } = {}): AppsProbe {
  let last: AppsDto = NO_APPS;
  const check = (): AppsDto => {
    try {
      last = probe();
    } catch {
      last = NO_APPS;
    }
    return last;
  };
  check();
  const timer = setInterval(check, o.everyMs ?? APPS_PROBE_MS);
  timer.unref?.();
  return { status: () => last, check, stop: () => clearInterval(timer) };
}
