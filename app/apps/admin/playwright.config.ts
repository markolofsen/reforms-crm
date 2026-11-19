import { defineConfig } from "@playwright/test";
import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { writeSendPolicy } from "./e2e/send-policy";

// The flows run against their own Hono API on a throwaway instance (`HUB_HOME`) and database (never a real instance) and a PRODUCTION build of the
// admin served by `next start` from its own `distDir`, so a running `next dev` is never disturbed (decision 0015, P32 N6).
const API_PORT = 4499;
const UI_PORT = 5199;
// The config is loaded again inside every worker (another pid), so the main process names the files once and workers inherit them.
const DB = (process.env.HUB_E2E_DB ??= join(tmpdir(), `hub-e2e-${process.pid}.db`));
// The throw-away instance every `hub` command of the stack needs (`HUB_HOME`); projects and the database are redirected below.
const HOME = (process.env.HUB_E2E_HOME ??= join(tmpdir(), `hub-e2e-home-${process.pid}`));
mkdirSync(HOME, { recursive: true });
// The server's project folders (project.md): Send reads the project's accounts and sender from here. Seeded projects only.
const PROJECTS = (process.env.HUB_E2E_PROJECTS ??= join(tmpdir(), `hub-e2e-projects-${process.pid}`));
for (const slug of ["lisbon-realty", "demo-shop"]) {
  mkdirSync(join(PROJECTS, slug), { recursive: true });
  writeFileSync(
    join(PROJECTS, slug, "project.md"),
    ["# E2E project", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", `| mail.accounts | ${slug}@example.test | 2026-11-14 | agent |`, `| mail.addresses | ${slug}@example.test | 2026-11-14 | owner |`, `| mail.sender | ${slug}@example.test | 2026-11-14 | owner |`, "| tone | brief | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "- reports: 00000000-0000-4000-8000-000000000002", ""].join("\n"),
  );
}
// P49 S11: the send policy is the server's file, not a row of project.md (recipients = any, drafts only, as the seeded flows expect).
for (const slug of ["lisbon-realty", "demo-shop"]) writeSendPolicy(HOME, slug);
// The instance config: the embedded terminal on (P49; the server runs the fake shell below), agent sessions unattended.
mkdirSync(join(HOME, "config"), { recursive: true });
writeFileSync(join(HOME, "config", "config.json"), JSON.stringify({ terminal: { enabled: true }, agent: { default: "claude", unattended: true } }, null, 2));
// P47: lisbon-realty gets the core's starter sequence, so its seeded follow-ups (Tiago due, Ines a candidate) have a definition.
mkdirSync(join(PROJECTS, "lisbon-realty", "sequences"), { recursive: true });
copyFileSync(join(import.meta.dirname, "..", "..", "projects", "_template", "sequences", "answered-enquiry-no-reply.md"), join(PROJECTS, "lisbon-realty", "sequences", "answered-enquiry-no-reply.md"));
// the specs read the ports from here (the loopback test, the Host and Origin test)
process.env.HUB_E2E_UI_PORT = String(UI_PORT);
process.env.HUB_E2E_API_PORT = String(API_PORT);

export default defineConfig({
  testDir: "./e2e",
  workers: 1, // the flows share one seeded database
  retries: 0,
  reporter: "list",
  // Every screen is looked at at three widths (rules: ui-specifications 4). The flows that change data run once, at 1280;
  // the layout and console specs run at all three.
  projects: [
    { name: "w1280", use: { viewport: { width: 1280, height: 800 } }, testIgnore: /zz-live/ },
    { name: "w768", use: { viewport: { width: 768, height: 1024 } }, testMatch: /(a-layout|c-console)/ },
    { name: "w360", use: { viewport: { width: 360, height: 740 }, hasTouch: true }, testMatch: /(a-layout|c-console)/ },
    // P50: the live flow stops and restarts the API, so it is the last project (one worker runs the projects in this order).
    { name: "live", use: { viewport: { width: 1280, height: 800 } }, testMatch: /zz-live/ },
  ],
  use: {
    baseURL: `http://127.0.0.1:${UI_PORT}`,
    channel: "chrome", // the installed Chrome: no browser download
    trace: "retain-on-failure",
  },
  webServer: [
    {
      // Fresh seeded database, `hub project sync` so the registry lists the seeded projects, then the API.
      command: `rm -f ${DB} ${DB}-wal ${DB}-shm && pnpm --filter @hub/db seed && pnpm hub project sync && pnpm --filter @hub/server start`,
      cwd: "../..",
      // HUB_CONFIG_DIR pins the secrets folder inside the throwaway home, so a Connections flow can never write a real instance's keys; HUB_CONNECTIONS_PROBE=fake
      // makes every Test a stub that never leaves the process. HUB_MAILER=fake is the only way the e2e run sends: the fake Mailer never leaves the process (the server refuses it without HUB_DB).
      // P49: HUB_ADMIN_PORT is the one Origin the terminal socket and its tickets accept; HUB_TERMINAL_SHELL=fake runs `test-support/fake-shell.mjs`
      // instead of a login shell, and HUB_AGENT_TOOLS=fake answers the Agent tools checks with fixed rows (a red one among them), never a real CLI.
      // P61: HUB_OPENER=fake records each Open's argv in <HOME>/state/opener.jsonl and opens nothing (z-local-actions.spec.ts reads it).
      env: {
        HUB_HOME: HOME,
        HUB_CONFIG_DIR: join(HOME, "secrets"),
        HUB_CONNECTIONS_PROBE: "fake",
        HUB_DB: DB,
        HUB_PORT: String(API_PORT),
        HUB_ADMIN_PORT: String(UI_PORT),
        HUB_MAILER: "fake",
        HUB_PROJECTS: PROJECTS,
        HUB_TERMINAL_SHELL: "fake",
        HUB_AGENT_TOOLS: "fake",
        HUB_OPENER: "fake",
      },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 180_000, // seed + project sync + tsx start take over 60 s on a loaded machine
    },
    {
      // One production build into `.next-e2e`, then `next start` on loopback only. The `/api` rewrite target is fixed at build time.
      command: "pnpm --filter @hub/admin build && pnpm --filter @hub/admin start",
      cwd: "../..",
      env: { HUB_PORT: String(API_PORT), HUB_ADMIN_PORT: String(UI_PORT), HUB_NEXT_DIST: ".next-e2e" },
      url: `http://127.0.0.1:${UI_PORT}`,
      reuseExistingServer: false,
      timeout: 300_000,
    },
  ],
});
