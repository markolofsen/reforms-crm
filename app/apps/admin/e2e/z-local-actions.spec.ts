import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { remember } from "./support";

// P61 L2: the Open buttons (Knowledge's folder and each entry's Open, P70 `/knowledge`; Help's "Where things live", the Files
// menu's items until P70) against the real API, whose opener is the FAKE one (HUB_OPENER=fake in playwright.config.ts): each
// argv is appended to `state/opener.jsonl` of the e2e instance and nothing opens. The spec gives lisbon-realty one expired
// knowledge entry (the knowledge package's fixture) and indexes it, so Knowledge lists it as expired; it removes both afterwards.

const PROJECT = "lisbon-realty";
const KNOWLEDGE = `/${PROJECT}/knowledge`;
const TITLE = "Spring sale 2025";
const HOME = process.env.HUB_E2E_HOME ?? "";
const PROJECTS = process.env.HUB_E2E_PROJECTS ?? "";
const DB = process.env.HUB_E2E_DB ?? "";
const APP = join(import.meta.dirname, "..", "..", "..");
const ENTRY = "knowledge/files/prices/springsale.md";
const FIXTURE = join(APP, "packages", "knowledge", "test", "fixtures", "projects", "acme-travel", ENTRY);
const LOG = join(HOME, "state", "opener.jsonl");
const folder = join(PROJECTS, PROJECT);

const index = () => execFileSync("pnpm", ["--filter", "@hub/knowledge", "knowledge", "--root", PROJECTS, "--db", DB, "index", PROJECT], { cwd: APP, stdio: "ignore", env: { ...process.env, HUB_HOME: HOME } });
const opened = (): string[][] => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { argv: string[] }).argv) : []);
const row = (page: Page) => page.getByRole("table", { name: "Knowledge entries" }).locator(`tr[data-entry$="/springsale.md"]`);

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  mkdirSync(join(folder, "knowledge", "files", "prices"), { recursive: true });
  mkdirSync(join(folder, "workflows"), { recursive: true });
  copyFileSync(FIXTURE, join(folder, ENTRY));
  index();
});
test.afterAll(() => {
  rmSync(join(folder, "knowledge"), { recursive: true, force: true });
  rmSync(join(folder, "workflows"), { recursive: true, force: true });
  index();
});
test.beforeEach(async ({ page }) => {
  rmSync(LOG, { force: true });
  await remember(page, PROJECT);
});

test("Knowledge opens its folder and an expired entry; Help's Where things live opens project.md, the folder and Workflows", async ({ page }) => {
  await page.goto(KNOWLEDGE);
  await expect(row(page)).toHaveAttribute("data-status", "expired");
  await expect(row(page)).toContainText(TITLE);
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect.poll(opened).toEqual([["/usr/bin/open", join(folder, "knowledge")]]);
  await row(page).getByRole("button", { name: `Open ${TITLE}` }).click();
  await expect.poll(() => opened().length).toBe(2);
  expect(opened()[1]).toEqual(["/usr/bin/open", join(folder, ENTRY)]);
  await page.goto("/help");
  const where = page.getByRole("region", { name: /^Where things live/ });
  await where.getByRole("button", { name: "Open project.md" }).click();
  await expect.poll(() => opened().at(-1)).toEqual(["/usr/bin/open", join(folder, "project.md")]);
  await where.getByRole("button", { name: "Open Project folder" }).click();
  await expect.poll(() => opened().at(-1)).toEqual(["/usr/bin/open", folder]);
  await where.getByRole("button", { name: "Open Workflows" }).press("Enter");
  await expect.poll(() => opened().at(-1)).toEqual(["/usr/bin/open", join(folder, "workflows")]);
  // P63: today's agent log is the fourth place (the server resolves the day's file, or says why not).
  await expect(where.getByRole("button", { name: "Open Today’s log" })).toBeVisible();
  // No Files menu anywhere since P70: its items are Help's.
  await expect(page.getByRole("button", { name: "Files", exact: true })).toHaveCount(0);
});

test("a refusal is said in words and opens nothing", async ({ page }) => {
  // The page asks for a key the index does not hold (another spec's state, or a stale page): the server refuses it.
  await page.route(/\/api\/projects\/[^/]+\/knowledge/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { entries: { key: string; title: string }[] };
    body.entries = body.entries.map((e) => ({ ...e, key: e.key.replace(/[^/]+$/, "not-indexed.md"), title: "Not indexed" }));
    await route.fulfill({ json: body });
  });
  await page.goto(KNOWLEDGE);
  await page.getByRole("button", { name: "Open Not indexed" }).click();
  await expect(page.getByText(/not in the project's knowledge index/)).toBeVisible();
  expect(opened()).toEqual([]);
});

test("with localOpen false no Open renders and the entry is still listed", async ({ page }) => {
  await page.route(/\/api\/instance$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ json: { ...((await res.json()) as object), localOpen: false } });
  });
  await page.goto(KNOWLEDGE);
  await expect(row(page)).toContainText(TITLE);
  await expect(page.getByRole("button", { name: "Open folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Open ${TITLE}` })).toHaveCount(0);
  await page.goto("/help");
  await expect(page.getByRole("heading", { name: /^Where things live/ })).toHaveCount(0);
});

test("the API door: a path in the body is refused; a page on another port cannot open", async ({ request }) => {
  const api = `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;
  const admin = `http://127.0.0.1:${process.env.HUB_E2E_UI_PORT}`;
  const foreign = await request.post(`${api}/api/local/finder.open`, { headers: { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-site" }, data: { project: PROJECT, key: "knowledge" } });
  expect(foreign.status()).toBe(403);
  const path = await request.post(`${admin}/api/local/file.open`, { headers: { origin: admin, "sec-fetch-site": "same-origin" }, data: { project: PROJECT, key: "../../config/config.json" } });
  expect(path.status()).toBe(400);
  expect(await path.text()).not.toContain(PROJECTS);
  expect(opened()).toEqual([]);
});
