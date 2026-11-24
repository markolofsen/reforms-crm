import { copyFileSync, mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { writeSendPolicy } from "./send-policy";

// P121 T4: one stack per Playwright worker. Stack i is its own throwaway instance (`HUB_HOME`), project folders, database, API port
// and `next start` of the ONE e2e build; worker i (its `TEST_PARALLEL_INDEX`) talks only to stack i, so the flows of two workers never
// share a row. Every stack lives under the run's temp root, which `temp-teardown.ts` removes.

export const API_BASE = 4499;
export const UI_BASE = 5199;

export interface Stack {
  index: number;
  home: string;
  db: string;
  projects: string;
  apiPort: number;
  uiPort: number;
}

export function stackOf(root: string, index: number): Stack {
  const dir = join(root, `w${index}`);
  return { index, home: join(dir, "home"), db: join(dir, "hub.db"), projects: join(dir, "projects"), apiPort: API_BASE + index, uiPort: UI_BASE + index };
}

// The server's project folders (project.md): Send reads the project's accounts and sender from here. Seeded projects only.
const projectMd = (slug: string): string =>
  ["# E2E project", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", "| schema | 1 | 2026-11-14 | agent |", "| status | active | 2026-11-15 | agent |", `| mail.accounts | ${slug}@example.test | 2026-11-14 | agent |`, `| mail.addresses | ${slug}@example.test | 2026-11-14 | owner |`, `| mail.sender | ${slug}@example.test | 2026-11-14 | owner |`, "| tone | brief | 2026-11-14 | owner |", "", "## Notion databases", "", "- clients: 00000000-0000-4000-8000-000000000001", "- reports: 00000000-0000-4000-8000-000000000002", ""].join("\n");

/** Writes a stack's instance: the two seeded projects, their send policies, the instance config and lisbon-realty's starter sequence. */
export function prepareStack(s: Stack, starterSequence: string): void {
  mkdirSync(s.home, { recursive: true });
  for (const slug of ["lisbon-realty", "demo-shop"]) {
    mkdirSync(join(s.projects, slug), { recursive: true });
    writeFileSync(join(s.projects, slug, "project.md"), projectMd(slug));
    // P49 S11: the send policy is the server's file, not a row of project.md (recipients = any, drafts only, as the seeded flows expect).
    writeSendPolicy(s.home, slug);
  }
  // The instance config: agent sessions unattended. The embedded terminal is always on (decision 0032; the server runs the fake shell).
  mkdirSync(join(s.home, "config"), { recursive: true });
  writeFileSync(join(s.home, "config", "config.json"), JSON.stringify({ agent: { default: "claude", unattended: true } }, null, 2));
  // P47: lisbon-realty gets the core's starter sequence, so its seeded follow-ups (Tiago due, Ines a candidate) have a definition.
  mkdirSync(join(s.projects, "lisbon-realty", "sequences"), { recursive: true });
  copyFileSync(starterSequence, join(s.projects, "lisbon-realty", "sequences", "answered-enquiry-no-reply.md"));
}

/** The variables the specs read (`HUB_E2E_*`): set once per process, for the stack that process talks to. */
export function exportStack(s: Stack): void {
  process.env.HUB_E2E_HOME = s.home;
  process.env.HUB_E2E_DB = s.db;
  process.env.HUB_E2E_PROJECTS = s.projects;
  process.env.HUB_E2E_API_PORT = String(s.apiPort);
  process.env.HUB_E2E_UI_PORT = String(s.uiPort);
}

/** The API of a stack: a fresh seeded database, `hub project sync` so the registry lists the seeded projects, then the server. */
export function apiServer(s: Stack) {
  return {
    command: `rm -f ${s.db} ${s.db}-wal ${s.db}-shm && pnpm --filter @hub/db seed && pnpm hub project sync && pnpm --filter @hub/server start`,
    cwd: "../..",
    // HUB_CONFIG_DIR pins the secrets folder inside the throwaway home, so a Connections flow can never write a real instance's keys; HUB_CONNECTIONS_PROBE=fake
    // makes every Test a stub that never leaves the process. HUB_MAILER=fake is the only way the e2e run sends: the fake Mailer never leaves the process (the server refuses it without HUB_DB).
    // P49: HUB_ADMIN_PORT is the one Origin the terminal socket and its tickets accept; HUB_TERMINAL_SHELL=fake runs `test-support/fake-shell.mjs`
    // instead of a login shell, and HUB_AGENT_TOOLS=fake answers the Agent tools checks with fixed rows (a red one among them), never a real CLI.
    // P61: HUB_OPENER=fake records each Open's argv in <HOME>/state/opener.jsonl and opens nothing (z-local-actions.spec.ts reads it).
    // P67: HUB_LAUNCHCTL=fake records each launchctl argv in <HOME>/state/autostart/launchctl.jsonl, reaches no launchd, and keeps its
    // LaunchAgents folder in <HOME>/state/autostart/LaunchAgents (z-autostart.spec.ts writes the plist there).
    env: {
      HUB_HOME: s.home,
      HUB_CONFIG_DIR: join(s.home, "secrets"),
      HUB_CONNECTIONS_PROBE: "fake",
      HUB_DB: s.db,
      HUB_PORT: String(s.apiPort),
      HUB_ADMIN_PORT: String(s.uiPort),
      HUB_MAILER: "fake",
      // P71 M-P: the pre-analysis' model is the fake transport of `@hub/llm`: no request leaves the process.
      HUB_LLM: "fake",
      // P85b: the batch send's spacing (20 s) shortened to 1 s; the server honours it with the fake Mailer only.
      HUB_BATCH_SPACING_SECONDS: "1",
      HUB_PROJECTS: s.projects,
      HUB_TERMINAL_SHELL: "fake",
      HUB_AGENT_TOOLS: "fake",
      HUB_OPENER: "fake",
      HUB_LAUNCHCTL: "fake",
    },
    url: `http://127.0.0.1:${s.apiPort}/api/health`,
    reuseExistingServer: false,
    timeout: 180_000, // seed + project sync + tsx start take over 60 s on a loaded machine
  };
}

/**
 * The admin of a stack: `next start` on loopback of the one production build in `.next-e2e`. Stack 0 builds it first (the
 * servers start in order, so the build is done before stack 1 starts). The build bakes its `/api` rewrite to stack 0's port;
 * `HUB_E2E_RUNTIME_API=1` makes `src/proxy.ts` send `/api` to this stack's `HUB_PORT` instead, read at request time.
 */
export function uiServer(s: Stack) {
  const start = "pnpm --filter @hub/admin start";
  return {
    command: s.index === 0 ? `pnpm --filter @hub/admin build && ${start}` : start,
    cwd: "../..",
    env: { HUB_PORT: String(s.apiPort), HUB_ADMIN_PORT: String(s.uiPort), HUB_NEXT_DIST: ".next-e2e", HUB_E2E_RUNTIME_API: "1" },
    url: `http://127.0.0.1:${s.uiPort}`,
    reuseExistingServer: false,
    timeout: 300_000,
  };
}
