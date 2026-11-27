import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readWatch, watchDirections } from "@hub/watch/config";
import { loadLens } from "@hub/watch/lens";
import { readWatchPolicy, watchPolicyFile } from "@hub/watch/policy";
import type { Step } from "../types";
import { fail, pass } from "./helpers";

// P144 (draft decision 0052): `watch.lens` checks each project's watch list and the lens it names offline, the same check the
// server makes before it starts a project's watcher: the declaration's shape, the strict walk of its task (no request) and
// facets that name real fields. Nothing is read from Telegram and no model is asked.

export const watchSteps: Step[] = [
  {
    id: "watch.lens", group: "Watch", title: "Every watch direction names a lens that loads",
    why: "Each watch direction names a lens (an instance package under packages/) that says what to look for. A broken additional lens parks its own direction while the default direction keeps running.",
    verifies: "Every `projects/<slug>/watch.md` reads (shared account, poll minutes, optional source_cap from 15 by default up to 60, directions with lens, switch and analysis minutes), and every lens including disabled directions loads and passes the check. An existing protected `state/projects/<slug>/watch-policy.json` must validate, including the strategy digest for enabled replies. Reads no database or Telegram history. PASS when no project has a watch list.",
    manual: { steps: ["Fix the line the row names: in watch.md, in the lens's `lens.json`, or in its code (`packages/<lens>/src/index.ts`).", "Run `./run.sh doctor --only watch.lens` again. The running server takes a fixed watch.md or lens.json within seconds; a change to the lens's code needs a server restart."] },
    async check(ctx) {
      const dir = ctx.paths.projects;
      const slugs = existsSync(dir) ? readdirSync(dir, { withFileTypes: true }).filter((e) => e.isDirectory() && !e.name.startsWith(".") && !e.name.startsWith("_")).map((e) => e.name).sort() : [];
      const lines: string[] = [];
      let broken = 0;
      for (const slug of slugs) {
        const w = readWatch(path.join(dir, slug));
        if (w.state === "none") continue;
        if (w.state === "invalid") {
          broken += 1;
          lines.push(`${slug}: watch.md: ${w.reason}`);
          continue;
        }
        for (const direction of watchDirections(w.config)) {
          const lens = await loadLens(ctx.paths.instancePackages, direction.lens);
          if (!lens.ok) {
            broken += 1;
            lines.push(`${slug}/${direction.id}: lens ${direction.lens}: ${lens.reason}`);
          } else lines.push(`${slug}/${direction.id}: ${lens.lens.title}, ${direction.groups.length} group(s), ${direction.on ? "on" : "off"}`);
        }
        const policy = readWatchPolicy(path.join(dir, slug), watchPolicyFile(ctx.paths.stateProjects, slug));
        if (policy.state === "invalid") { broken += 1; lines.push(`${slug}: watch-policy.json: ${policy.reason}`); }
      }
      if (lines.length === 0) return pass("no project watches public groups");
      return broken > 0 ? fail(lines.join("; ")) : pass(lines.join("; "));
    },
  },
];
