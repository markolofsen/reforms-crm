import { join } from "node:path";
import type { HubPaths } from "@hub/config/paths";
import { ops } from "@hub/log/ops";
import { readWatch } from "@hub/watch/config";
import { lensDataFile, lensFile, redeclareLens, stampOf, type LensModuleFn } from "@hub/watch/lens";
import { configChanges, lensChanges } from "./changes";
import type { WatchProject } from "./start";

// P153 (plan verdict 4, D2): one ready project's change check. A valid watch.md or lens.json is taken while running and written
// as one Activity line; an invalid one keeps what runs and says why (`notice`); a change to the lens's code waits for a restart.

/** What a ready project was loaded from, to see a change: the files' stamps and the lens module already imported. */
export interface Source {
  module: LensModuleFn | null;
  watchStamp: number;
  dataStamp: number;
  codeStamp: number;
}

export interface ChangeCtx {
  paths: Pick<HubPaths, "projects" | "instancePackages">;
  timers: boolean;
  activity(project: string, summary: string, reason: string): Promise<void>;
  bump(project: string): void;
  watchFileOf(slug: string): string;
}

/** A ready project's changed watch.md or lens.json, taken while running when it is valid. */
export async function reloadReady(c: ChangeCtx, p: Extract<WatchProject, { state: "ready" }>, src: Source): Promise<void> {
  const watchStamp = stampOf(c.watchFileOf(p.slug));
  let lensName = p.config.lens;
  if (watchStamp !== src.watchStamp) {
    src.watchStamp = watchStamp;
    const w = readWatch(join(c.paths.projects, p.slug));
    if (w.state !== "ok") {
      p.notice = w.state === "none" ? "watch.md was removed: the running list is kept until the server restarts." : `watch.md: ${w.reason}. The running list is kept.`;
      ops("watch").warn("a changed watch list cannot be read: the running one is kept", { project: p.slug, reason: p.notice });
    } else if (w.config.account !== p.config.account || w.config.lens !== p.config.lens) {
      p.notice = "watch.md names another account or lens: that change is loaded at the next server restart. The running list is kept.";
      ops("watch").warn("a watch list change needs a restart", { project: p.slug });
    } else {
      const changes = configChanges(p.config, w.config);
      p.config = w.config;
      p.watcher.update({ config: w.config }, { timers: c.timers });
      p.notice = null;
      if (changes.length > 0) {
        ops("watch").info("watch list reloaded", { project: p.slug, changes: changes.length });
        await c.activity(p.slug, `Watch list changed: ${changes.join(", ")}`, "watch.md changed; the server took it without a restart.");
      }
      c.bump(p.slug);
    }
    lensName = p.config.lens;
  }
  const dataStamp = stampOf(lensDataFile(c.paths.instancePackages, lensName));
  if (dataStamp !== src.dataStamp && src.module) {
    src.dataStamp = dataStamp;
    const r = redeclareLens(src.module, c.paths.instancePackages, lensName);
    if (!r.ok) {
      p.notice = `lens ${lensName}: ${r.reason}. The running lens is kept.`;
      ops("watch").warn("a changed lens cannot be loaded: the running one is kept", { project: p.slug, reason: r.reason });
    } else {
      const changes = lensChanges(p.lens, r.lens);
      p.lens = r.lens;
      p.watcher.update({ lens: r.lens });
      p.notice = null;
      if (changes.length > 0) {
        ops("watch").info("watch lens reloaded", { project: p.slug, version: r.lens.task.version });
        await c.activity(p.slug, `Watch lens changed: ${changes.join(", ")}`, "lens.json changed; new windows use it, the windows already read stay as they are.");
      }
      c.bump(p.slug);
    }
  }
  const codeStamp = stampOf(lensFile(c.paths.instancePackages, lensName));
  if (codeStamp !== src.codeStamp && p.notice === null) p.notice = `The code of lens ${lensName} changed: restart the server to load it. The running lens is kept.`;
}
