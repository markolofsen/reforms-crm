import { expect, test, type Page } from "@playwright/test";
import { basename } from "node:path";
import { at, remember } from "./support";

// The embedded terminal (P49 T3) on the fake shell (`HUB_TERMINAL_SHELL=fake`, `test-support/fake-shell.mjs`): it prints the
// prompt `fake$ `, echoes each line as `> <line>`, answers `size` with `<cols> <rows>`, `pwd` with its folder, and `[esc]` for
// a lone Escape. Named z-* because it starts sessions on the server; every test ends them again (the cap is eight).
test.describe.configure({ mode: "serial" });

const P = "lisbon-realty";
const toggle = (page: Page) => page.getByRole("button", { name: "Terminal", exact: true });
const dock = (page: Page) => page.getByRole("complementary", { name: "Terminal" });
const separator = (page: Page) => page.getByRole("separator", { name: "Resize Terminal" });
const input = (page: Page) => page.getByRole("textbox", { name: "Terminal input" });
/** The rows of the open tab's screen, as text (hidden tabs are not in the accessibility tree, so `tabpanel` is the open one). */
// xterm's DOM renderer draws blank cells as no-break spaces.
const rows = (page: Page) => page.getByRole("tabpanel").locator(".xterm-rows").evaluate((el) => [...el.children].map((r) => (r.textContent ?? "").replace(/\u00a0/g, " ").trimEnd()));
const screenText = async (page: Page) => (await rows(page)).join("\n");

async function sessions(page: Page): Promise<{ id: string; preset: string; project: string | null }[]> {
  const res = await page.request.get("/api/terminal");
  expect(res.status()).toBe(200);
  return ((await res.json()) as { sessions: { id: string; preset: string; project: string | null }[] }).sessions;
}

/** Ends every session the test left running (through the API, as Close does). */
async function endAll(page: Page) {
  for (const s of await sessions(page)) await page.request.delete(`/api/terminal/sessions/${encodeURIComponent(s.id)}`);
}

/** Opens the column with the toggle and waits for the fake shell's prompt. */
async function openTerminal(page: Page) {
  await toggle(page).click();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "true");
  await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain("fake$");
}

async function typeLine(page: Page, line: string) {
  await input(page).focus();
  await page.keyboard.type(line);
  await page.keyboard.press("Enter");
  await expect.poll(() => screenText(page)).toContain(`> ${line}`);
}

/** The latest `<cols> <rows>` answer of the fake shell after one more `size`. */
async function sizeReply(page: Page): Promise<{ cols: number; rows: number }> {
  const all = async () => (await rows(page)).flatMap((r) => (/^(\d+) (\d+)$/.exec(r) ? [r] : []));
  const before = (await all()).length;
  await typeLine(page, "size");
  await expect.poll(async () => (await all()).length).toBeGreaterThan(before);
  const [cols, rowsN] = ((await all()).at(-1) ?? "0 0").split(" ").map(Number);
  return { cols: cols ?? 0, rows: rowsN ?? 0 };
}

test.beforeEach(async ({ page }) => {
  await remember(page, P);
  await endAll(page);
});
test.afterEach(async ({ page }) => {
  await endAll(page);
});

test("terminal: the toggle and Ctrl+` show and hide it; focus goes in, and back to the toggle", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await openTerminal(page);
  await expect(dock(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();
  await expect(toggle(page)).toHaveAttribute("aria-pressed", "false");
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  // Hiding only detaches: the session still runs on the server.
  expect(await sessions(page)).toHaveLength(1);
});

test("terminal: the width and the open column survive a reload, and the reload re-attaches with the earlier output", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await openTerminal(page);
  await typeLine(page, "e2e-before-reload");
  await separator(page).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "632");
  await page.reload();
  await expect(dock(page)).toBeVisible();
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "632");
  await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain("> e2e-before-reload");
  await separator(page).focus();
  await page.keyboard.press("Home");
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "560");
});

test("terminal: a wider column is a wider grid (the size the program sees follows the separator)", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await openTerminal(page);
  const before = await sizeReply(page);
  expect(before.cols).toBeGreaterThan(20);
  await separator(page).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await sizeReply(page)).cols).toBeGreaterThan(before.cols);
});

test("terminal: on a project's screen the presets are Claude Code, Codex, Shell; each agent preset types its line and starts in the instance root", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  // Opening an empty column starts the default (`agent.default`: Claude Code).
  await openTerminal(page);
  await expect.poll(() => screenText(page)).toContain(`agent ${P} --cli claude`);
  await typeLine(page, "pwd");
  // A long path wraps at the column's width, so the rows are joined without breaks for this one.
  await expect.poll(async () => (await rows(page)).join("")).toContain(basename(process.env.HUB_E2E_HOME ?? "hub-e2e-home"));
  await page.getByRole("button", { name: "New terminal" }).click();
  // The server's order, the default first (marked "default").
  await expect(page.getByRole("menuitem")).toHaveText([/^Claude Code\s*default$/, "Codex", "Shell"]);
  await page.getByRole("menuitem", { name: "Codex" }).click();
  await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain(`agent ${P} --cli codex`);
  const list = await sessions(page);
  expect(list.map((s) => [s.preset, s.project])).toEqual([["claude", P], ["codex", P]]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText(P);
});

test("terminal: with no project in the address (Connections) only Shell is offered", async ({ page }) => {
  await page.goto("/connections");
  await openTerminal(page);
  expect((await sessions(page)).map((s) => [s.preset, s.project])).toEqual([["shell", null]]);
  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Shell"]);
  await page.keyboard.press("Escape");
});

test("terminal: keys typed in it are the program's: ? opens no help, Escape reaches the shell", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await openTerminal(page);
  await typeLine(page, "?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await input(page).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => screenText(page)).toContain("[esc]");
  await expect(dock(page)).toBeVisible();
});

test("terminal: Close ends the session on the server; closing the last one hides the column", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await openTerminal(page);
  expect(await sessions(page)).toHaveLength(1);
  await dock(page).getByRole("button", { name: /^Close / }).click();
  await expect.poll(async () => (await sessions(page)).length).toBe(0);
  await expect(dock(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();
});

test("terminal: at 360px it is a full-screen layer with no sideways scroll, and Hide gives the screen back", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(at(P, "/drafts"));
  await page.locator('ul[aria-label="Drafts"] > li').first().waitFor();
  await openTerminal(page);
  const layer = page.getByTestId("terminal-layer");
  await expect(layer).toBeVisible();
  await expect(layer.getByRole("heading", { name: "Terminal" })).toBeVisible();
  expect(await layer.evaluate((e) => e.getBoundingClientRect().width)).toBe(360);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), "sideways page scroll").toBeLessThanOrEqual(0);
  await layer.getByRole("button", { name: "Hide the terminal" }).click();
  await expect(layer).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Sections" }).last()).toBeVisible();
});
