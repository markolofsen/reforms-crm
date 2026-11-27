import { registerWatchActions } from "./watch-actions";
// P144 W3: `hub watch import <audience.sqlite> --project <slug>`: the experiment's corpus into a project's watch store, so the
// Watch section can be read and measured with no Telegram account. The lens named in the project's watch.md supplies the task
// version. Reads the experiment's file read-only; writes only `data/watch/<slug>.db` (a behind file is refused: the server migrates).
import { existsSync } from "node:fs";
import path from "node:path";
import type { Command } from "commander";
import { readWatch } from "@hub/watch/config";
import { importExperiment } from "@hub/watch/import";
import { loadLens } from "@hub/watch/lens";
import { openWatchStore, watchDbFile } from "@hub/watch/store";
import { ctxOf } from "./shared";

export function register(parent: Command): Command {
  const program = parent.command("watch").description("Public group watch (P144): import the experiment's corpus.");
  program
    .command("import")
    .description("Copy an experiment audience.sqlite (chats, messages, windows, moments) into a project's watch store.")
    .argument("<file>", "the experiment's audience.sqlite")
    .requiredOption("--project <slug>", "the project whose watch.md names the lens")
    .option("--size <n>", "the window size the experiment used (default 100)", (v) => Number.parseInt(v, 10))
    .option("--overlap <n>", "the window overlap the experiment used (default 20)", (v) => Number.parseInt(v, 10))
    .action(async (file: string, o: { project: string; size?: number; overlap?: number }) => {
      const { paths } = ctxOf();
      const w = readWatch(path.join(paths.projects, o.project));
      if (w.state === "none") throw new Error(`${o.project} has no watch.md: write one first (lens, on, account, groups)`);
      if (w.state === "invalid") throw new Error(`${o.project}/watch.md: ${w.reason}`);
      const lens = await loadLens(paths.instancePackages, w.config.lens);
      if (!lens.ok) throw new Error(`lens ${w.config.lens}: ${lens.reason}`);
      if (!existsSync(path.resolve(file))) throw new Error(`${file} does not exist: give the experiment's audience.sqlite`);
      const store = openWatchStore(watchDbFile(paths.watch, o.project), { project: o.project });
      try {
        const r = importExperiment(path.resolve(file), store, { taskVersion: lens.lens.task.version, ...(o.size ? { size: o.size } : {}), ...(o.overlap ? { overlap: o.overlap } : {}) });
        console.log(`imported into data/watch/${o.project}.db: ${r.groups} group(s), ${r.messages} message(s), ${r.windows} window(s), ${r.moments} moment(s) (known rows skipped)`);
      } finally {
        store.close();
      }
    });
  registerWatchActions(program);
  return program;
}
