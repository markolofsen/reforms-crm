import { existsSync, readdirSync } from "node:fs";
import path from "node:path";
import { readWatch } from "@hub/watch/config";
import { loadLens } from "@hub/watch/lens";
import type { Step } from "../types";
import { fail, pass } from "./helpers";

// P144 (draft decision 0052): `watch.lens` checks each project's watch list and the lens it names offline, the same check the
// server makes before it starts a project's watcher: the declaration's shape, the strict walk of its task (no request) and
// facets that name real fields. Nothing is read from Telegram and no model is asked.

export const watchSteps: Step[] = [
  {
    id: "watch.lens", group: "Watch", title: "Each watch list names a lens that loads",
    why: "A project that watches public groups names a lens (the instance's own package under packages/) that says what to look for. A lens that does not load parks that project's watcher, and the Watch page shows nothing for it.",
    verifies: "Every `projects/<slug>/watch.md` reads (a lens name, the on switch, the account, the poll minutes, at most 15 public group usernames), and its lens loads and passes the check: `packages/<lens>/lens.json` (version, title, prompt, triggers, keep, window, budget) and `packages/<lens>/src/index.ts` (declaration, strict schema, facets). PASS when no project has a watch list.",
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
        const lens = await loadLens(ctx.paths.instancePackages, w.config.lens);
        if (!lens.ok) {
          broken += 1;
          lines.push(`${slug}: lens ${w.config.lens}: ${lens.reason}`);
        } else lines.push(`${slug}: ${lens.lens.title}, ${w.config.groups.length} group(s), ${w.config.on ? "on" : "off"}`);
      }
      if (lines.length === 0) return pass("no project watches public groups");
      return broken > 0 ? fail(lines.join("; ")) : pass(lines.join("; "));
    },
  },
];
