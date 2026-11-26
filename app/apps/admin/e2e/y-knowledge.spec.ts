import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { entryTopic, type KnowledgeListDto } from "@hub/contract/knowledge";
import { address, remember } from "./support";

// Knowledge (P70, `/<project>/knowledge`) against the real API: the spec copies the knowledge package's fixture base (acme-travel,
// 18 files, one expired; the counts come from the API) into lisbon-realty, indexes it, and removes it afterwards. Every entry is listed with its title, the
// View menu's counts are the server's, an Open records its argv with the FAKE opener (`state/opener.jsonl`), and at 360px each
// entry is two lines with no sideways scroll.

const PROJECT = "lisbon-realty";
const HOME = process.env.HUB_E2E_HOME ?? "";
const PROJECTS = process.env.HUB_E2E_PROJECTS ?? "";
const DB = process.env.HUB_E2E_DB ?? "";
const APP = join(import.meta.dirname, "..", "..", "..");
const FIXTURE = join(APP, "packages", "knowledge", "test", "fixtures", "projects", "acme-travel", "knowledge");
const LOG = join(HOME, "state", "opener.jsonl");
const folder = join(PROJECTS, PROJECT);
const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

// P126 C1: the package CLIs are `hub <group>` now (`hub knowledge index`).
const index = () => execFileSync("pnpm", ["hub", "knowledge", "--root", PROJECTS, "--db", DB, "index", PROJECT], { cwd: APP, stdio: "ignore", env: { ...process.env, HUB_HOME: HOME } });
const opened = (): string[][] => (existsSync(LOG) ? readFileSync(LOG, "utf8").trim().split("\n").filter(Boolean).map((l) => (JSON.parse(l) as { argv: string[] }).argv) : []);
const list = async (page: Page, filter = "all") => (await (await page.request.get(`${API()}/api/projects/${PROJECT}/knowledge?filter=${filter}`)).json()) as KnowledgeListDto;
const table = (page: Page) => page.getByRole("table", { name: "Knowledge entries" });
/** P74: the top headings the rows of a list should draw (the fixture's folders; its brands are all the same, so no brand level). */
const topics = (d: KnowledgeListDto) => [...new Set(d.entries.map((e) => entryTopic(e.key, e.category)[0]))].sort((a = "", b = "") => a.localeCompare(b));
const heads = (page: Page) => table(page).locator("tr[data-topic-head] th");

test.describe.configure({ mode: "serial" });

test.beforeAll(() => {
  cpSync(FIXTURE, join(folder, "knowledge"), { recursive: true });
  index();
});
test.afterAll(() => {
  rmSync(join(folder, "knowledge"), { recursive: true, force: true });
  index();
});
test.beforeEach(async ({ page }) => {
  rmSync(LOG, { force: true });
  await remember(page, PROJECT);
});

test("knowledge: every entry is a row with its title, its status in words and its Open; the header has the search and Open folder", async ({ page }) => {
  const d = await list(page);
  expect(d.entries.length).toBeGreaterThan(10);
  await page.goto(`/${PROJECT}/knowledge`);
  await expect(page).toHaveTitle(`Knowledge · ${PROJECT} · Hub`);
  await expect(table(page).locator("tbody tr[data-entry]")).toHaveCount(d.entries.length);
  for (const e of d.entries) {
    const row = table(page).locator(`tr[data-entry="${e.key}"]`);
    await expect(row, e.key).toContainText(e.title);
    await expect(row).toHaveAttribute("data-status", e.status);
  }
  await expect(table(page).locator('tr[data-status="expired"]')).toContainText("Expired");
  // P74: a heading per folder, in label order, each with its count; a heading is not a ref and not a tab stop.
  const want = topics(d).map((t) => new RegExp(`^${t}\\s*${d.entries.filter((e) => entryTopic(e.key, e.category)[0] === t).length}$`));
  expect(want.length).toBeGreaterThan(1);
  await expect(heads(page)).toHaveText(want);
  await expect(table(page).locator("tr[data-topic-head][data-agent-ref], tr[data-topic-head] [tabindex]")).toHaveCount(0);
  await expect(page.getByRole("searchbox", { name: "Search knowledge" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Open folder" })).toBeVisible();
  // No status sentence: the numbers are the View menu's (admin-principles rule 10).
  await expect(page.getByTestId("knowledge-status")).toHaveCount(0);
});

test("knowledge: the menu column's view counts are the server's, and each view lists exactly its count (P125 L2)", async ({ page }) => {
  const d = await list(page);
  await page.goto(`/${PROJECT}/knowledge`);
  const nav = page.getByRole("navigation", { name: "Knowledge topics" });
  await expect(page.getByRole("button", { name: /^View:/ })).toHaveCount(0);
  const want = [["All", d.counts.all], ["Needs attention", d.counts.attention]] as const;
  for (const [label, n] of want) await expect(nav.getByRole("link", { name: new RegExp(`^${label}\\s*${n}$`) })).toBeVisible();
  await page.getByRole("button", { name: /^Knowledge filter:/ }).click();
  await page.getByRole("menuitemradio", { name: /^Expired/ }).click();
  await expect.poll(() => address(page)).toBe(`/${PROJECT}/knowledge?filter=expired`);
  await expect(table(page).locator("tbody tr[data-entry]")).toHaveCount(d.counts.expired);
  for (const view of ["attention", "unapproved"] as const) {
    expect((await list(page, view)).entries.length, view).toBe(d.counts[view]);
  }
});

test("knowledge: choosing a topic lists exactly its rows, without heading rows, and Back restores All (P125 L2)", async ({ page }) => {
  const d = await list(page);
  const first = topics(d)[0];
  if (!first) throw new Error("the fixture base has no topic");
  const n = d.entries.filter((e) => entryTopic(e.key, e.category)[0] === first).length;
  await page.goto(`/${PROJECT}/knowledge`);
  const nav = page.getByRole("navigation", { name: "Knowledge topics" });
  await nav.getByRole("link", { name: new RegExp(`^${first}\\s*${n}$`) }).click();
  await expect.poll(() => address(page)).toBe(`/${PROJECT}/knowledge?topic=${encodeURIComponent(first.toLowerCase())}`);
  await expect(table(page).locator("tbody tr[data-entry]")).toHaveCount(n);
  await expect(heads(page)).toHaveCount(0);
  await expect(nav.getByRole("link", { name: new RegExp(`^${first}`) })).toHaveAttribute("aria-current", "page");
  await page.goBack();
  await expect.poll(() => address(page)).toBe(`/${PROJECT}/knowledge`);
  await expect(table(page).locator("tbody tr[data-entry]")).toHaveCount(d.entries.length);
  await expect(nav.getByRole("link", { name: "All topics" })).toHaveAttribute("aria-current", "page");
});

test("knowledge: the search narrows by title and the address keeps it", async ({ page }) => {
  await page.goto(`/${PROJECT}/knowledge`);
  await page.getByRole("searchbox", { name: "Search knowledge" }).fill("spring");
  await expect.poll(() => address(page)).toBe(`/${PROJECT}/knowledge?q=spring`);
  await expect(table(page).locator("tbody tr[data-entry]")).toHaveCount(1);
  await expect(table(page)).toContainText("Spring sale 2025");
  // P74: only the heading that holds the match is drawn, with its count.
  await expect(heads(page)).toHaveText([/^Prices\s*1$/]);
});

test("knowledge: an entry's Open opens its file (the fake opener records the argv)", async ({ page }) => {
  await page.goto(`/${PROJECT}/knowledge`);
  await table(page).getByRole("button", { name: "Open Spring sale 2025" }).click();
  await expect.poll(opened).toEqual([["/usr/bin/open", join(folder, "knowledge", "files", "prices", "springsale.md")]]);
});

test("knowledge: at 360px each entry is at most two lines (title and Open, then who, status, date when it has any) and nothing scrolls sideways", async ({ page }) => {
  const d = await list(page);
  await page.setViewportSize({ width: 360, height: 800 });
  await page.goto(`/${PROJECT}/knowledge`);
  const rows = page.getByRole("list", { name: "Knowledge entries" }).locator("li[data-entry]");
  await expect(rows).toHaveCount(d.entries.length);
  await expect(table(page)).toHaveCount(0);
  // P74: the same headings over the list.
  await expect(page.getByRole("list", { name: "Knowledge entries" }).locator("[data-topic-head]")).toHaveCount(topics(d).length);
  const first = rows.first();
  // UX pass: a row with nothing to add (no date, the shared audience, approved) is one line; an expired one says so on its second.
  expect(await first.locator("p").count()).toBeLessThanOrEqual(2);
  await expect(first.locator("p").first().getByRole("button", { name: /^Open / })).toBeVisible();
  await expect(page.getByRole("list", { name: "Knowledge entries" }).locator('li[data-status="expired"] p')).toHaveCount(2);
  expect(await page.evaluate(() => document.documentElement.scrollWidth <= document.documentElement.clientWidth)).toBe(true);
});

test("knowledge: a row opens its text under itself, read only, and Enter closes it again; Open stays on the row (P128 X6)", async ({ page }) => {
  const d = await list(page);
  const e = d.entries[0];
  if (!e) throw new Error("the fixture base is empty");
  await page.goto(`/${PROJECT}/knowledge`);
  const row = table(page).locator(`tr[data-entry="${e.key}"]`);
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await row.locator("td").first().click();
  await expect(row).toHaveAttribute("aria-expanded", "true");
  const text = table(page).locator(`tr[data-entry-text="${e.key}"]`).getByTestId("knowledge-text");
  await expect(text).toBeVisible();
  await expect(text.locator("textarea, input, [contenteditable=true]")).toHaveCount(0);
  await expect(row.getByRole("button", { name: `Open ${e.title}` })).toBeVisible();
  await row.focus();
  await page.keyboard.press("Enter");
  await expect(row).toHaveAttribute("aria-expanded", "false");
  await expect(table(page).locator(`tr[data-entry-text="${e.key}"]`)).toHaveCount(0);
});
