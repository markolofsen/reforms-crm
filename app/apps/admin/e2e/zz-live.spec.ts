import { expect, test, type Page } from "@playwright/test";
import { execFileSync, spawn, type ChildProcess } from "node:child_process";
import { cpSync, mkdtempSync, openSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSendPolicy } from "./send-policy";
import { at, cards } from "./support";

// P50 L4: the admin updates by itself while an agent writes from another process. Named zz-* because it adds drafts
// and restarts the API, so it runs after every other flow. The restarted API is the same command and environment as
// the one `playwright.config.ts` starts, on the same throwaway database; it is stopped at the end.
const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
const server = fileURLToPath(new URL("../../server", import.meta.url));
const API_PORT = Number(process.env.HUB_E2E_API_PORT ?? 4499);
const HOME = process.env.HUB_E2E_HOME ?? "";
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-live-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, "demo-shop"), { recursive: true });
writeSendPolicy(HOME, "demo-shop");

/** `hub record-draft` in its own process, as the agent runs it in a terminal: it writes the database file, never the API. */
const record = (name: string) => {
  const slug = name.toLowerCase().replace(/\W+/g, "-");
  const draft = { email: `${slug}@example.com`, name, subject: `Re: ${name}`, mailRef: `<${slug}@example.com>`, reason: "Asked for a viewing.", repliesOwed: true, skill: "triage-mail" };
  execFileSync("node", [hub, "record-draft", "--project", "demo-shop"], { input: JSON.stringify(draft), env: { ...process.env, HUB_HOME: HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, NO_COLOR: "1" }, encoding: "utf8" });
};

const apiUp = async () => fetch(`http://127.0.0.1:${API_PORT}/api/health`).then((r) => r.ok, () => false);
const listener = () => Number(execFileSync("lsof", ["-ti", `tcp:${API_PORT}`, "-sTCP:LISTEN"], { encoding: "utf8" }).trim().split("\n")[0]);
let restarted: ChildProcess | null = null;

/** The API again, with the environment of `playwright.config.ts` (the fake Mailer, probes, shell and tools; the throwaway home and database). */
function startApi(): ChildProcess {
  const log = openSync(join(tmpdir(), `hub-e2e-live-api-${process.pid}.log`), "a");
  return spawn(join(server, "node_modules", ".bin", "tsx"), ["src/main.ts"], {
    cwd: server,
    stdio: ["ignore", log, log],
    env: {
      ...process.env,
      HUB_HOME: HOME,
      HUB_CONFIG_DIR: join(HOME, "secrets"),
      HUB_CONNECTIONS_PROBE: "fake",
      HUB_DB: process.env.HUB_E2E_DB,
      HUB_PORT: String(API_PORT),
      HUB_ADMIN_PORT: process.env.HUB_E2E_UI_PORT,
      HUB_MAILER: "fake",
      // P71 M-P: the pre-analysis' model is the fake transport of `@hub/llm`: no request leaves the process.
      HUB_LLM: "fake",
      HUB_PROJECTS: process.env.HUB_E2E_PROJECTS,
      HUB_TERMINAL_SHELL: "fake",
      HUB_AGENT_TOOLS: "fake",
      HUB_OPENER: "fake",
    },
  });
}

test.afterAll(() => {
  restarted?.kill("SIGTERM");
});

const liveState = (page: Page) => page.getByTestId("live-state");

test("a draft recorded by another process appears within 1 s, Activity and the status line follow, two tabs share one stream, and a restart resumes", async ({ page, context }) => {
  test.setTimeout(90_000);
  const streams: string[] = [];
  context.on("request", (r) => {
    if (new URL(r.url()).pathname === "/api/live") streams.push(r.url());
  });
  const errors: string[] = [];
  page.on("console", (m) => {
    if (m.type() === "error") errors.push(m.text());
  });

  await page.goto(at("demo-shop", "/mail?filter=all"));
  await expect(liveState(page)).toHaveText("Live");
  const line = page.getByTestId("status-line");
  const before = await line.innerText();

  // A second tab on Activity: it follows the first tab's stream over the BroadcastChannel and opens none of its own.
  const log = await context.newPage();
  await log.goto(at("demo-shop", "/log"));
  await expect(log.getByRole("table", { name: "Activity" })).toBeVisible();

  record("Lena Live");
  await expect(cards(page).filter({ hasText: "Lena Live" })).toHaveCount(1, { timeout: 1_000 });
  await expect(line).not.toHaveText(before);
  await expect(log.getByTestId("activity-new")).toHaveText(/new/);
  expect(streams).toHaveLength(1);
  expect(errors).toEqual([]);

  // The server stops: the line says so after 5 s; a draft recorded while it is down shows once it is back, with no reload.
  process.kill(listener(), "SIGTERM");
  await expect.poll(apiUp, { timeout: 10_000 }).toBe(false);
  await expect(liveState(page)).toHaveText(/Reconnecting/, { timeout: 15_000 });
  record("Dora Down");
  restarted = startApi();
  await expect.poll(apiUp, { timeout: 30_000 }).toBe(true);
  await expect(liveState(page)).toHaveText("Live", { timeout: 15_000 });
  await expect(cards(page).filter({ hasText: "Dora Down" })).toHaveCount(1, { timeout: 5_000 });
  expect(page.url()).toContain("/mail");
});
