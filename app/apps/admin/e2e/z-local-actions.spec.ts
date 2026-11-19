import { execFileSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { remember } from "./support";

// P61 L2: the Project screen's Open buttons against the real API, whose opener is the FAKE one (HUB_OPENER=fake in
// playwright.config.ts): each argv is appended to `state/opener.jsonl` of the e2e instance and nothing opens. The spec
// gives lisbon-realty one expired knowledge entry (the knowledge package's fixture) and indexes it, so the Knowledge line
// opens by itself; it removes both afterwards.

const PROJECT = "lisbon-realty";
const AT = `/${PROJECT}/project`;
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
const knowledgeLine = (page: Page) => page.getByRole("button", { name: /^Knowledge/ });

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

test("the Knowledge line opens its folder and an expired entry; Files opens project.md", async ({ page }) => {
  await page.goto(AT);
  await expect(knowledgeLine(page)).toHaveAttribute("aria-expanded", "true"); // the expired entry opens the line
  await page.getByRole("button", { name: "Open folder" }).click();
  await expect.poll(opened).toEqual([["/usr/bin/open", join(folder, "knowledge")]]);
  await page.getByRole("button", { name: `Open ${ENTRY}` }).click();
  await expect.poll(() => opened().length).toBe(2);
  expect(opened()[1]).toEqual(["/usr/bin/open", join(folder, ENTRY)]);
  await page.getByRole("button", { name: "Files" }).click();
  await page.getByRole("menuitem", { name: "project.md" }).click();
  await expect.poll(() => opened().at(-1)).toEqual(["/usr/bin/open", join(folder, "project.md")]);
  // Workflows and the project folder, by keyboard: one menu, one tab stop.
  await page.getByRole("button", { name: "Files" }).focus();
  await page.keyboard.press("Enter");
  await page.getByRole("menuitem", { name: "Workflows" }).press("Enter");
  await expect.poll(() => opened().at(-1)).toEqual(["/usr/bin/open", join(folder, "workflows")]);
});

test("a refusal is said in words and opens nothing", async ({ page }) => {
  // The page asks for a key the index does not hold (another spec's state, or a stale page): the server refuses it.
  await page.route(/\/api\/project\?/, async (route) => {
    const res = await route.fetch();
    const body = (await res.json()) as { knowledge: { examples?: string[] } };
    body.knowledge.examples = ["knowledge/files/not-indexed.md"];
    await route.fulfill({ json: body });
  });
  await page.goto(AT);
  await page.getByRole("button", { name: "Open knowledge/files/not-indexed.md" }).click();
  await expect(page.getByText(/not in the project's knowledge index/)).toBeVisible();
  expect(opened()).toEqual([]);
});

test("with localOpen false none of the three renders and nothing else moves", async ({ page }) => {
  await page.goto(AT);
  const status = await page.getByTestId("project-status").boundingBox();
  await page.route(/\/api\/instance$/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ json: { ...((await res.json()) as object), localOpen: false } });
  });
  await page.reload();
  await expect(knowledgeLine(page)).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByRole("button", { name: "Open folder" })).toHaveCount(0);
  await expect(page.getByRole("button", { name: `Open ${ENTRY}` })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Files" })).toHaveCount(0);
  await expect(page.getByText(ENTRY)).toBeVisible(); // the path is still shown, as before P61
  expect((await page.getByTestId("project-status").boundingBox())?.y).toBe(status?.y);
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
