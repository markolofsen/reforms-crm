import { expect, test, type Page } from "@playwright/test";
import { basename } from "node:path";
import { at, remember } from "./support";

// The embedded terminal (P49 T3) on the fake shell (`HUB_TERMINAL_SHELL=fake`, `test-support/fake-shell.mjs`): it prints the
// line `exec [argv]` when it stands in for an agent preset (`--exec`), then the prompt `fake$ `, echoes each line as `> <line>`, answers `size` with `<cols> <rows>`, `pwd` with its folder, and `[esc]` for
// a lone Escape. Named z-* because it starts sessions on the server; every test ends them again (the cap is eight).
test.describe.configure({ mode: "serial" });

const P = "lisbon-realty";
/** The strip ("Terminal", or "Terminal, <the open tab's program>") or the phone's button. */
const toggle = (page: Page) => page.getByRole("button", { name: /^Terminal(, [A-Za-z ]+)?$/ });
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
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  await expect(dock(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toHaveCount(0);
  // Collapsed, the dock is the strip again and focus is on it.
  await expect(toggle(page)).toBeFocused();
  await expect(page.locator('[data-slot="terminal-strip"]')).toBeVisible();
  await page.keyboard.press("Control+Backquote");
  await expect(dock(page)).toBeVisible();
  await expect(input(page)).toBeFocused();
  // Hiding only detaches: the session still runs on the server.
  expect(await sessions(page)).toHaveLength(1);
});

test("terminal: the width and the open column survive a reload, and the reload re-attaches with the earlier output", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  await typeLine(page, "e2e-before-reload");
  await separator(page).focus();
  for (let i = 0; i < 3; i++) await page.keyboard.press("ArrowLeft");
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "472");
  await page.reload();
  await expect(dock(page)).toBeVisible();
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "472");
  await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain("> e2e-before-reload");
  // P57: the restored column reattached; it started nothing new.
  expect(await sessions(page)).toHaveLength(1);
  await separator(page).focus();
  await page.keyboard.press("Home");
  await expect(separator(page)).toHaveAttribute("aria-valuenow", "400");
});

test("terminal: a reload shows the tab he had open, not the project's first session (P88, research 27 B7)", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  await page.getByRole("button", { name: "New terminal" }).click();
  await page.getByRole("menuitem", { name: "Shell" }).click();
  await expect(page.getByRole("tab")).toHaveCount(2);
  const second = await page.getByRole("tab").nth(1).getAttribute("id");
  await expect(page.getByRole("tab", { selected: true })).toHaveAttribute("id", second ?? "");
  await page.reload();
  await expect(dock(page)).toBeVisible();
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toHaveAttribute("id", second ?? "");
});

test("terminal: a press on the column while a page menu is open closes the menu and the keys go to the terminal (P88, research 27 B7)", async ({ page }) => {
  // P134: Mail's header has no View menu from 640px; Messengers' View menu is the page menu here.
  await page.goto(at(P, "/messengers"));
  await openTerminal(page);
  await page.getByRole("button", { name: /^View:/ }).click();
  await expect(page.getByRole("menu")).toBeVisible();
  // The menu's backdrop covers the column, so the press is by position (a locator click would see the backdrop intercept it).
  const box = await page.getByRole("tabpanel").locator(".xterm-screen").boundingBox();
  if (!box) throw new Error("no terminal screen");
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await expect(page.getByRole("menu")).toHaveCount(0);
  await expect(input(page)).toBeFocused();
  await page.keyboard.type("hand off");
  await page.keyboard.press("Enter");
  await expect.poll(() => screenText(page)).toContain("> hand off");
});

test("terminal: a wider column is a wider grid (the size the program sees follows the separator)", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  const before = await sizeReply(page);
  expect(before.cols).toBeGreaterThan(20);
  await separator(page).focus();
  for (let i = 0; i < 5; i++) await page.keyboard.press("ArrowLeft");
  await expect.poll(async () => (await sizeReply(page)).cols).toBeGreaterThan(before.cols);
});

/** The argv the server spawned for an agent preset, as the fake shell printed it (joined: a long line wraps). */
const execOf = async (page: Page, cli: string) => {
  const flat = (await rows(page)).join("");
  return flat.includes(`"agent","${P}","--cli","${cli}"]`);
};

test("terminal: on a project's screen the presets are Claude Code, Codex, Shell; each agent preset is spawned as argv (nothing typed) and starts in the instance root", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  // Opening an empty column starts the default (`agent.default`: Claude Code).
  await openTerminal(page);
  await expect.poll(() => execOf(page, "claude")).toBe(true);
  // Nothing was typed into the shell: no `> ` echo of a launch line.
  expect(await screenText(page)).not.toContain("> ");
  await typeLine(page, "pwd");
  // A long path wraps at the column's width, so the rows are joined without breaks for this one.
  await expect.poll(async () => (await rows(page)).join("")).toContain(basename(process.env.HUB_E2E_HOME ?? "hub-e2e-home"));
  await page.getByRole("button", { name: "New terminal" }).click();
  // The server's order, the default first (marked "default").
  await expect(page.getByRole("menuitem")).toHaveText([/^Claude Code\s*default$/, "Codex", "Shell"]);
  await page.getByRole("menuitem", { name: "Codex" }).click();
  await expect.poll(() => execOf(page, "codex"), { timeout: 15_000 }).toBe(true);
  const list = await sessions(page);
  expect(list.map((s) => [s.preset, s.project])).toEqual([["claude", P], ["codex", P]]);
  await expect(page.getByRole("tab")).toHaveCount(2);
  await expect(page.getByRole("tab", { selected: true })).toContainText(P);
});

test("terminal: the tab's tips (P63): its CLI's rows and the Hub's, from one list; the desktop handoff row says why it is not offered", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  await expect.poll(() => execOf(page, "claude")).toBe(true);
  await page.getByRole("button", { name: "Tips for Claude Code" }).click();
  const tips = page.getByTestId("terminal-tips");
  await expect(tips.getByRole("heading", { name: "Tips for Claude Code" })).toBeVisible();
  await expect(tips.locator("[data-tip]")).toHaveCount(6);
  await expect(tips.locator('[data-tip="claude:voice"]')).toContainText("/voice");
  await expect(tips.locator('[data-tip="claude:desktop"]')).toContainText("The Hub does not offer it");
  await expect(tips.locator('[data-tip^="codex:"]')).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(tips).toBeHidden();
});

test("terminal: with no project in the address (Settings ▸ Connections) only Shell is offered", async ({ page }) => {
  await page.goto("/settings/connections");
  await openTerminal(page);
  expect((await sessions(page)).map((s) => [s.preset, s.project])).toEqual([["shell", null]]);
  await page.getByRole("button", { name: "New terminal" }).click();
  await expect(page.getByRole("menuitem")).toHaveText(["Shell"]);
  await page.keyboard.press("Escape");
});

test("terminal: keys typed in it are the program's: ? opens no help, Escape reaches the shell", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  await typeLine(page, "?");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await input(page).focus();
  await page.keyboard.press("Escape");
  await expect.poll(() => screenText(page)).toContain("[esc]");
  await expect(dock(page)).toBeVisible();
});

test("terminal: Close ends the session on the server; closing the last one hides the column", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  expect(await sessions(page)).toHaveLength(1);
  await dock(page).getByRole("button", { name: /^Close / }).click();
  await expect.poll(async () => (await sessions(page)).length).toBe(0);
  await expect(dock(page)).toHaveCount(0);
  await expect(toggle(page)).toBeFocused();
});

test("terminal: at 360px it is a full-screen layer with no sideways scroll, and Hide gives the screen back", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(at(P, "/mail"));
  await page.locator('ul[aria-label="People"] > li').first().waitFor();
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

test("terminal: keys pressed while a Claude Code session starts cannot corrupt its argv (v0.9.1: \"д/Users/...\")", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await page.locator('ul[aria-label="People"] > li').first().waitFor();
  await toggle(page).click();
  // At once, before the session is ready: a Russian-layout key and a few more.
  await page.keyboard.type("дl l");
  await expect.poll(() => execOf(page, "claude"), { timeout: 15_000 }).toBe(true);
  const flat = (await rows(page)).join("");
  const exec = flat.slice(flat.indexOf("exec ["), flat.indexOf("]", flat.indexOf("exec [")) + 1);
  expect(JSON.parse(exec.slice(5)) as string[]).toEqual([expect.stringMatching(/node$/), expect.stringMatching(/hub\.mjs$/), "agent", P, "--cli", "claude"]);
});

test("terminal: collapsed it is a full-height strip on the right edge (no button in the sidebar); Enter expands it, Hide collapses it back, the session keeps running", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await page.locator('ul[aria-label="People"] > li').first().waitFor();
  const strip = page.locator('[data-slot="terminal-strip"]');
  await expect(strip).toBeVisible();
  const box = await strip.boundingBox();
  const vw = page.viewportSize()!;
  expect(Math.round((box?.x ?? 0) + (box?.width ?? 0))).toBe(vw.width);
  expect(Math.round(box?.height ?? 0)).toBe(vw.height);
  expect(box?.width).toBeLessThanOrEqual(48);
  await expect(page.locator('[data-sidebar="sidebar"], [data-slot="sidebar"]').first().getByRole("button", { name: "Terminal", exact: true })).toHaveCount(0);
  await expect(strip).toContainText("Terminal");
  // P57 2g: a page loaded with the strip collapsed starts nothing (he may only be reviewing drafts).
  expect(await sessions(page)).toHaveLength(0);
  // Keyboard: focus the strip, Enter.
  await toggle(page).focus();
  await page.keyboard.press("Enter");
  await expect(dock(page)).toBeVisible();
  await expect(strip).toHaveCount(0);
  await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain("fake$");
  await page.getByRole("button", { name: "Hide the terminal" }).click();
  await expect(strip).toBeVisible();
  await expect(strip).toContainText("Claude Code");
  await expect(page.getByTestId("terminal-strip-dot")).toBeVisible();
  await expect(toggle(page)).toBeFocused();
  expect(await sessions(page)).toHaveLength(1);
});

/** The xterm screen's background (xterm 6 paints it on its scrollable element) and the `--terminal-bg` token, both as computed colours. */
async function terminalColours(page: Page) {
  return page.evaluate(() => {
    const view = document.querySelector<HTMLElement>('[role="tabpanel"] .xterm-scrollable-element');
    const probe = document.createElement("div");
    probe.style.background = "var(--terminal-bg)";
    document.querySelector('[data-slot="terminal"]')?.appendChild(probe);
    const token = getComputedStyle(probe).backgroundColor;
    probe.remove();
    return { screen: view ? getComputedStyle(view).backgroundColor : "", token };
  });
}

test("terminal: its background follows the theme, light and dark, live when the owner switches", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await page.locator('ul[aria-label="People"] > li').first().waitFor();
  // P134 verdict 11: the theme is in the footer's "⋯" popover, open sidebar and rail alike.
  const controls = page.getByRole("button", { name: "Theme, sounds and shortcuts" });
  const theme = page.getByRole("radiogroup", { name: "Theme" });
  await controls.click();
  await theme.getByRole("radio", { name: "Light" }).click();
  await page.keyboard.press("Escape");
  await openTerminal(page);
  const light = await terminalColours(page);
  expect(light.screen).toBe(light.token);
  // The column folds the sidebar to its rail; its "⋯" holds the same theme switch.
  await controls.click();
  await theme.getByRole("radio", { name: "Dark" }).click();
  await page.keyboard.press("Escape");
  await expect.poll(async () => (await terminalColours(page)).screen).not.toBe(light.screen);
  const dark = await terminalColours(page);
  expect(dark.screen).toBe(dark.token);
  expect(dark.screen).not.toBe(light.screen);
});

test("terminal: a restored open column whose sessions were closed starts one by itself (P57 2e)", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  await endAll(page);
  await page.reload();
  await expect(dock(page)).toBeVisible();
  await expect.poll(() => execOf(page, "claude"), { timeout: 15_000 }).toBe(true);
  expect((await sessions(page)).map((s) => [s.preset, s.project])).toEqual([["claude", P]]);
});

test("terminal: two admin pages opening the column at once get one session (P57 2d)", async ({ page, context }) => {
  // Both pages load with the column remembered open, so both call `ensure` as they come up. (Clicking both strips does not
  // work: the pages share localStorage, so the first click opens the other page's column too and its strip is gone.)
  await context.addInitScript(() => window.localStorage.setItem("hub.terminal", "open"));
  const other = await context.newPage();
  await Promise.all([page.goto(at(P, "/mail")), other.goto(at(P, "/mail"))]);
  await Promise.all([expect(dock(page)).toBeVisible(), expect(dock(other)).toBeVisible()]);
  await expect.poll(async () => (await sessions(page)).length, { timeout: 15_000 }).toBe(1);
  expect((await sessions(page)).map((s) => [s.preset, s.project])).toEqual([["claude", P]]);
  await other.close();
  expect(await sessions(page)).toHaveLength(1);
});

test("P128 X0 (F2): after a reload the restored column keeps its session, not the focus: Hub keys reach the Hub; his own open moves focus in", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await openTerminal(page);
  await expect(input(page)).toBeFocused();
  await page.reload();
  await expect(dock(page)).toBeVisible();
  await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain("fake$");
  await page.waitForTimeout(1000);
  await expect(input(page)).not.toBeFocused();
  expect(await page.evaluate(() => document.activeElement?.closest('[aria-label="Terminal"]') ?? null)).toBeNull();
  // A Hub key goes to the Hub: ? opens the keyboard help, and the terminal saw no "?".
  await page.keyboard.press("?");
  await expect(page.getByRole("dialog")).toBeVisible();
  await page.keyboard.press("Escape");
  // His own open (Ctrl+` hides, Ctrl+` shows) is an opening: focus goes in.
  await page.keyboard.press("Control+Backquote");
  await page.keyboard.press("Control+Backquote");
  await expect(input(page)).toBeFocused();
});
