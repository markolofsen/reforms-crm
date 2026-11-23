import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, existsSync, readFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { at, remember } from "./support";

// P72 (decision 0038): the agent's pointer, end to end. A scripted agent (`test-support/fake-agent.mjs --highlight`) calls
// `highlight` of `hub mcp`; the admin reads `GET /api/pointer` on the live topic and draws a ring on the row with the note as
// text; Escape removes it and the outcome reaches the next focus post. A ref that is not on this screen is offered in the dock
// ("Agent points at … · Show"); only the click navigates. While he types, a highlight does not scroll. Named z-* because it writes.

// P129 A3: `hub record-draft` is gone (the agent records through draft_write); flows seed a draft row with the same writer.
const seedDraft = fileURLToPath(new URL("../../installer/test/support/seed-draft.mjs", import.meta.url));
const fakeAgent = fileURLToPath(new URL("../../../test-support/fake-agent.mjs", import.meta.url));
const APP = fileURLToPath(new URL("../../..", import.meta.url));
const PROJECTS = process.env.HUB_E2E_PROJECTS ?? "";
const HOME = process.env.HUB_E2E_HOME ?? "";
const kbFolder = join(PROJECTS, "demo-shop", "knowledge");
const env = { ...process.env, HUB_HOME: HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: PROJECTS, HUB_PROJECT: "demo-shop", NO_COLOR: "1" };
const focusFile = join(HOME, "state", "focus.json");
const pointerFile = join(HOME, "state", "pointer.json");
const indexKb = () => execFileSync("pnpm", ["--filter", "@hub/knowledge", "knowledge", "--root", PROJECTS, "--db", process.env.HUB_E2E_DB ?? "", "index", "demo-shop"], { cwd: APP, stdio: "ignore", env: { ...process.env, HUB_HOME: HOME } });
const highlight = (refs: string[], note?: string) => JSON.parse(execFileSync("node", [fakeAgent, "--highlight", JSON.stringify(refs), ...(note ? [note] : [])], { env, encoding: "utf8" })) as { highlight: { id: string; refs: string[] } };
const outcome = () => (existsSync(focusFile) ? (JSON.parse(readFileSync(focusFile, "utf8")) as { focus: { pointer?: { id: string; outcome: string } } }).focus.pointer : undefined);
const record = (payload: object) => JSON.parse(execFileSync("node", [seedDraft, "--project", "demo-shop"], { env, input: JSON.stringify(payload), encoding: "utf8" })) as { draftId: number };
// Entry rows only: since P74 each topic is its own tbody whose first row is the heading (no td).
const rows = (page: Page) => page.getByRole("table", { name: "Knowledge entries" }).locator("tbody tr[data-entry]");
const ring = (page: Page) => page.locator("[data-spotlight]");

test.describe.configure({ mode: "serial" });
test.beforeAll(() => {
  cpSync(fileURLToPath(new URL("../../../packages/knowledge/test/fixtures/projects/acme-travel/knowledge", import.meta.url)), kbFolder, { recursive: true });
  indexKb();
});
test.afterAll(() => {
  rmSync(kbFolder, { recursive: true, force: true });
  rmSync(pointerFile, { force: true });
  indexKb();
});

test("a highlight draws a ring and the note on the row, changes nothing else, and Escape removes it; the outcome comes back", async ({ page }) => {
  await remember(page, "demo-shop");
  await page.goto(at("demo-shop", "/knowledge"));
  const row = rows(page).nth(2);
  await expect(row).toBeVisible();
  await rows(page).nth(0).locator("td").first().click(); // a fresh focus: he is looking
  await expect.poll(() => existsSync(focusFile)).toBe(true);
  const ref = (await row.getAttribute("data-agent-ref")) ?? "";
  const url = page.url();
  const h = highlight([ref], "this entry");
  expect(readFileSync(pointerFile, "utf8")).not.toMatch(/"title"/);
  await expect(ring(page)).toHaveCount(1);
  await expect(page.getByText("Agent: this entry")).toBeVisible();
  await expect.poll(() => outcome()).toEqual({ id: h.highlight.id, outcome: "shown" });
  // The ring sits on the row and moved neither focus nor the address.
  const [r, b] = [await row.boundingBox(), await ring(page).boundingBox()];
  expect(Math.abs((r?.y ?? 0) - (b?.y ?? -99))).toBeLessThan(2);
  expect(page.url()).toBe(url);
  expect(await page.evaluate(() => document.activeElement?.closest("[data-spotlight]") ?? null)).toBeNull();
  await page.keyboard.press("Escape");
  await expect(ring(page)).toHaveCount(0);
  await expect.poll(() => outcome()).toEqual({ id: h.highlight.id, outcome: "dismissed" });
});

test("while he types in the search box a highlight does not scroll", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 420 });
  await remember(page, "demo-shop");
  await page.goto(at("demo-shop", "/knowledge"));
  const last = rows(page).last();
  await expect(last).toBeAttached();
  await page.getByRole("searchbox", { name: "Search knowledge titles" }).click();
  await expect.poll(() => existsSync(focusFile)).toBe(true);
  const scrolled = () => page.evaluate(() => [...document.querySelectorAll("#main *")].reduce((n, el) => n + el.scrollTop, 0));
  const before = await scrolled();
  highlight([(await last.getAttribute("data-agent-ref")) ?? ""]);
  await page.waitForTimeout(1200); // past the 800 ms wait for visibility
  expect(await scrolled()).toBe(before);
  await expect(page.getByRole("searchbox", { name: "Search knowledge titles" })).toBeFocused();
});

test("a row on another screen is offered in the dock with Show; only his click goes there, and the ring is drawn there", async ({ page }) => {
  const d = record({ email: "polly@example.com", name: "Polly Pointer", subject: "Re: Where", mailRef: "<pointer-1@example.com>", reason: "A question.", excerpt: "Hi Polly.", repliesOwed: true, skill: "triage-mail" });
  await remember(page, "demo-shop");
  await page.goto(at("demo-shop", "/knowledge"));
  await rows(page).nth(0).locator("td").first().click();
  await page.getByRole("button", { name: /^Terminal(, [A-Za-z ]+)?$/ }).click();
  const points = page.getByTestId("agent-points");
  const h = highlight([`draft:${d.draftId}`], "his draft");
  await expect(points).toContainText("Agent points at: Polly Pointer <polly@example.com> · Re: Where");
  await expect.poll(() => outcome()).toEqual({ id: h.highlight.id, outcome: "not-on-screen" });
  expect(page.url()).toMatch(/\/knowledge/);
  await points.getByRole("link", { name: /^Show/ }).click();
  // P99: a draft is a part of a conversation; Show opens that client's conversation, whose unsent message carries the ref.
  await expect(page).toHaveURL(/\/mail\/c\/\d+$/);
  // One ring per element that carries the ref (the open unsent message; a person's row carries the client ref).
  await expect(ring(page).first()).toBeVisible();
  await expect(ring(page)).toHaveCount(await page.locator(`#main [data-agent-ref="draft:${d.draftId}"]`).count());
  // End the dock's sessions again (the cap is eight).
  for (const s of ((await (await page.request.get("/api/terminal")).json()) as { sessions: { id: string }[] }).sessions) await page.request.delete(`/api/terminal/sessions/${encodeURIComponent(s.id)}`);
});
