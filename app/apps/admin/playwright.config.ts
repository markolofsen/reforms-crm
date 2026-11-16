import { defineConfig } from "@playwright/test";
import { mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

// The flows run against their own Hono API on a throwaway database (never `app/data/app.db`) and a PRODUCTION build of the
// admin served by `next start` from its own `distDir`, so a running `next dev` is never disturbed (decision 0015, P32 N6).
const API_PORT = 4499;
const UI_PORT = 5199;
// The config is loaded again inside every worker (another pid), so the main process names the files once and workers inherit them.
const DB = (process.env.HUB_E2E_DB ??= join(tmpdir(), `hub-e2e-${process.pid}.db`));
// The server's project folders (project.md): Send reads the project's accounts and sender from here. Seeded projects only.
const PROJECTS = (process.env.HUB_E2E_PROJECTS ??= join(tmpdir(), `hub-e2e-projects-${process.pid}`));
for (const slug of ["lisbon-realty", "demo-shop"]) {
  mkdirSync(join(PROJECTS, slug), { recursive: true });
  writeFileSync(
    join(PROJECTS, slug, "project.md"),
    ["# E2E project", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", `| mail.accounts | ${slug}@example.test | 2026-11-14 | agent |`, `| mail.addresses | ${slug}@example.test | 2026-11-14 | owner |`, `| mail.sender | ${slug}@example.test | 2026-11-14 | owner |`, "| draft.recipients | any | 2026-11-14 | owner |", "| tone | brief | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "- reports: 00000000-0000-4000-8000-000000000002", ""].join("\n"),
  );
}
// The conversations the FAKE Mail holds (`HUB_FAKE_THREADS`, read only by the e2e fake mailer): the last messages Mail shows for Marta Ficticia.
const THREADS = (process.env.HUB_E2E_THREADS ??= join(tmpdir(), `hub-e2e-threads-${process.pid}.json`));
const marta = { address: "marta@example.net", subject: "Terms for the Alfama building" };
writeFileSync(
  THREADS,
  JSON.stringify([
    { ...marta, at: "2026-11-01T09:00:00", who: "Marta Ficticia <marta@example.net>", direction: "in", subject: marta.subject, excerpt: "First message: what are your terms for the Alfama building?" },
    { ...marta, at: "2026-11-02T10:30:00", who: "Lisbon Realty <lisbon-realty@example.test>", direction: "out", subject: `Re: ${marta.subject}`, excerpt: "Our terms are in the attached sheet." },
    { ...marta, at: "2026-11-09T08:15:00", who: "Marta Ficticia <marta@example.net>", direction: "in", subject: `Re: ${marta.subject}`, excerpt: "LIVE-ONLY: can we meet on Thursday to sign?" },
  ]),
);
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
    { name: "w1280", use: { viewport: { width: 1280, height: 800 } } },
    { name: "w768", use: { viewport: { width: 768, height: 1024 } }, testMatch: /(a-layout|c-console)/ },
    { name: "w360", use: { viewport: { width: 360, height: 740 }, hasTouch: true }, testMatch: /(a-layout|c-console)/ },
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
      // HUB_MAILER=fake is the only way the e2e run sends: the fake Mailer never leaves the process (the server refuses it without HUB_DB).
      env: { HUB_DB: DB, HUB_PORT: String(API_PORT), HUB_MAILER: "fake", HUB_PROJECTS: PROJECTS, HUB_FAKE_THREADS: THREADS },
      url: `http://127.0.0.1:${API_PORT}/api/health`,
      reuseExistingServer: false,
      timeout: 60_000,
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
