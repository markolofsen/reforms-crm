import { defineConfig } from "@playwright/test";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { apiServer, exportStack, prepareStack, stackOf, uiServer } from "./e2e/stacks";

// The flows run against their own Hono API on a throwaway instance (`HUB_HOME`) and database (never a real instance) and a PRODUCTION build of the
// admin served by `next start` from its own `distDir`, so a running `next dev` is never disturbed (decision 0015, P32 N6).
// P121 T4: one stack (instance, database, API, `next start`) per worker, `e2e/stacks.ts`. Workers: `HUB_E2E_WORKERS` (default 2,
// to keep the owner's Mac usable; P121 question 1), the same number of stacks; `HUB_E2E_WORKERS=1` is the old serial run.
const WORKERS = Math.max(1, Number(process.env.HUB_E2E_WORKERS ?? 2));
const E2E_TMP = (process.env.HUB_E2E_TMPDIR ??= mkdtempSync(join(tmpdir(), "hub-e2e-t-")));
process.env.TMPDIR = E2E_TMP;
const STARTER = join(import.meta.dirname, "..", "..", "projects", "_template", "sequences", "answered-enquiry-no-reply.md");
const STACKS = Array.from({ length: WORKERS }, (_, i) => stackOf(E2E_TMP, i));
// The config is loaded again inside every worker (another pid, with its TEST_PARALLEL_INDEX): the main process writes every
// stack once, a worker only names its own, so a spec's `process.env.HUB_E2E_*` is that worker's stack.
const worker = process.env.TEST_PARALLEL_INDEX;
if (worker === undefined) for (const s of STACKS) prepareStack(s, STARTER);
const index = Number(worker ?? 0);
const mine = STACKS[index];
if (!mine) throw new Error(`worker ${index} has no stack: run with HUB_E2E_WORKERS=${index + 1} or more instead of --workers`);
exportStack(mine);

// The projects run in dependency order on every worker's own stack. The data a spec sees still depends on what ran before it
// on that stack: the read-only flows (`a-` to `y-`, smoke) see the seed as it was, so `guards` finishes on every worker before any
// `z-` flow (which creates data) starts; the 768 and 360 px passes of layout and console are read-only; `live` stops and restarts
// its stack's API, so it runs after everything else.
const AT_1280 = { viewport: { width: 1280, height: 800 } };
const READ_ONLY = /[/\\](?:[a-y]-[^/\\]*|smoke)\.spec\.ts$/;
const FLOWS = /[/\\]z-[^/\\]*\.spec\.ts$/;

export default defineConfig({
  globalTeardown: "./e2e/temp-teardown.ts",
  testDir: "./e2e",
  workers: WORKERS,
  retries: 0,
  reporter: "list",
  // Every screen is looked at at three widths (rules: ui-specifications 4). The flows that change data run once, at 1280;
  // the layout and console specs run at all three.
  projects: [
    { name: "guards", use: AT_1280, testMatch: READ_ONLY },
    { name: "flows", use: AT_1280, testMatch: FLOWS, dependencies: ["guards"] },
    { name: "w768", use: { viewport: { width: 768, height: 1024 } }, testMatch: /(a-layout|c-console)/, dependencies: ["guards"] },
    { name: "w360", use: { viewport: { width: 360, height: 740 }, hasTouch: true }, testMatch: /(a-layout|c-console)/, dependencies: ["guards"] },
    // P50: the live flow stops and restarts its stack's API, so it waits for every other project.
    { name: "live", use: AT_1280, testMatch: /zz-live/, dependencies: ["flows", "w768", "w360"] },
  ],
  use: {
    baseURL: `http://127.0.0.1:${mine.uiPort}`,
    channel: "chrome", // the installed Chrome: no browser download
    trace: "retain-on-failure",
  },
  // In order: every stack's API, then stack 0's admin (which builds once), then the other admins on the same build.
  webServer: [...STACKS.map(apiServer), ...STACKS.map(uiServer)],
});
