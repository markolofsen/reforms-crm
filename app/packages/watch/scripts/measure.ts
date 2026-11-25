// P144 W5: measure the window analysis on a scratch copy of a corpus, never on a live store.
//
//   tsx packages/watch/scripts/measure.ts import  <audience.sqlite> <scratch.db> <instance-packages> <lens> <project>
//   tsx packages/watch/scripts/measure.ts analyse <scratch.db> <scratch-home> <instance-packages> <lens> <project> <model> <summary.json>
//
// `import` loads the experiment's corpus into a fresh scratch store (windows and moments included; clear them before analysing).
// `analyse` runs the real job (`analyseGroup`, its keep-filter and dedupe) over every group with the `window` preset pinned to
// one model through `<scratch-home>/config/config.json` and an in-memory ledger, so nothing reaches an instance's app.db.
// The summary holds numbers only (messages, windows, cost from the ledger, outcomes, models); the moments stay in the scratch db.
import { mkdirSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { createLlm, memoryLedger } from "@hub/llm";
import { analyseGroup } from "@hub/watch/analyse";
import { importExperiment } from "@hub/watch/import";
import { loadLens } from "@hub/watch/lens";
import { openWatchStore } from "@hub/watch/store";

const [cmd, ...a] = process.argv.slice(2);

async function lensOf(packages: string, name: string) {
  const r = await loadLens(resolve(packages), name);
  if (!r.ok) throw new Error(`lens ${name}: ${r.reason}`);
  return r.lens;
}

if (cmd === "import") {
  const [audience, db, packages, lensName, project] = a;
  if (!audience || !db || !packages || !lensName || !project) throw new Error("import <audience.sqlite> <scratch.db> <instance-packages> <lens> <project>");
  const lens = await lensOf(packages, lensName);
  const store = openWatchStore(resolve(db), { project, migrate: true });
  try {
    const r = importExperiment(resolve(audience), store, { taskVersion: lens.task.version });
    console.log(JSON.stringify(r));
  } finally {
    store.close();
  }
} else if (cmd === "analyse") {
  const [db, home, packages, lensName, project, model, out] = a;
  if (!db || !home || !packages || !lensName || !project || !model || !out) throw new Error("analyse <scratch.db> <scratch-home> <instance-packages> <lens> <project> <model> <summary.json>");
  mkdirSync(join(home, "config"), { recursive: true });
  writeFileSync(join(home, "config", "config.json"), JSON.stringify({ llm: { monthly_cap_usd: 1.5, presets: { window: [model] } } }));
  const lens = await lensOf(packages, lensName);
  const ledger = memoryLedger();
  const llm = createLlm({ ledger, env: { ...process.env, HUB_HOME: resolve(home) } });
  if (llm.transport !== "openrouter") throw new Error(`transport is ${llm.transport}, not openrouter`);
  const store = openWatchStore(resolve(db), { project, migrate: true });
  const started = Date.now();
  let messages = 0;
  let windows = 0;
  let failed = 0;
  let moments = 0;
  const stops: string[] = [];
  try {
    for (const g of store.groups()) {
      const n = store.messagesOf(g.username).length;
      if (n === 0) continue;
      messages += n;
      const r = await analyseGroup({ llm, store, lens, now: () => new Date() }, g.username);
      windows += r.windows;
      failed += r.failedWindows;
      moments += r.moments;
      if (r.stopped) {
        stops.push(r.stopped);
        break;
      }
      process.stderr.write(`group ${windows} windows so far, $${(ledger.rows.reduce((s, x) => s + x.costMicroUsd, 0) / 1e6).toFixed(4)}\n`);
    }
  } finally {
    store.close();
  }
  const rows = ledger.rows;
  const cost = rows.reduce((s, r) => s + r.costMicroUsd, 0) / 1e6;
  const count = (k: (r: (typeof rows)[number]) => string) => rows.reduce<Record<string, number>>((m, r) => ({ ...m, [k(r)]: (m[k(r)] ?? 0) + 1 }), {});
  const summary = {
    model,
    taskVersion: lens.task.version,
    messages,
    windows,
    failedWindows: failed,
    moments,
    stops,
    attempts: rows.length,
    outcomes: count((r) => r.outcome),
    models: count((r) => r.model ?? "none"),
    tokensIn: rows.reduce((s, r) => s + r.tokensIn, 0),
    tokensOut: rows.reduce((s, r) => s + r.tokensOut, 0),
    costUsd: cost,
    usdPer1000Messages: messages ? (cost / messages) * 1000 : null,
    seconds: Math.round((Date.now() - started) / 1000),
  };
  writeFileSync(resolve(out), JSON.stringify(summary, null, 2));
  console.log(JSON.stringify(summary));
} else {
  throw new Error("measure.ts import|analyse …");
}
