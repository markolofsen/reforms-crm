import { expect, test, type Locator, type Page } from "@playwright/test";
import { at, remember } from "./support";

// P76, decision 0041: a file dropped on the terminal is copied under state/drops and its path pasted; a file dropped
// anywhere else does nothing; a text drag into an input is left alone. On the fake shell (`HUB_TERMINAL_SHELL=fake`): it
// echoes each line as `> <line>`, so a pasted path shows once Enter is pressed. A drop is dispatched with a real
// `DataTransfer` built in the page (a Finder drag cannot be scripted). Named z-* because it starts sessions; each test ends them.
test.describe.configure({ mode: "serial" });

const P = "lisbon-realty";
const toggle = (page: Page) => page.getByRole("button", { name: /^Terminal(, [A-Za-z ]+)?$/ });
const input = (page: Page) => page.getByRole("textbox", { name: "Terminal input" });
const screenText = (page: Page) =>
  page.getByRole("tabpanel").locator(".xterm-rows").evaluate((el) => [...el.children].map((r) => (r.textContent ?? "").replace(/ /g, " ").trimEnd()).join("\n"));
/** The screen with wrapped rows joined: a long path spans rows at the dock's width. */
// Rows untrimmed: a full row has no padding, so a wrapped path joins back whole (a short row's padding becomes spaces).
const flatText = (page: Page) =>
  page.getByRole("tabpanel").locator(".xterm-rows").evaluate((el) => [...el.children].map((r) => (r.textContent ?? "").replace(/\u00a0/g, " ")).join(""));
const dropBox = (page: Page) => page.getByRole("tabpanel").locator('[data-slot="terminal-drop"]');

async function endAll(page: Page) {
  const res = await page.request.get("/api/terminal");
  for (const s of ((await res.json()) as { sessions: { id: string }[] }).sessions) await page.request.delete(`/api/terminal/sessions/${encodeURIComponent(s.id)}`);
}

/** Dispatches dragenter, dragover and drop on `target` with files (name and text) or text; true when the page cancelled the drop. */
function drop(target: Locator, what: { files?: Array<[string, string]>; text?: string }): Promise<boolean> {
  return target.evaluate((el, w) => {
    const dt = new DataTransfer();
    for (const [name, body] of w.files ?? []) dt.items.add(new File([body], name, { type: "image/png" }));
    if (w.text !== undefined) dt.setData("text/plain", w.text);
    for (const type of ["dragenter", "dragover"]) el.dispatchEvent(new DragEvent(type, { dataTransfer: dt, bubbles: true, cancelable: true }));
    return !el.dispatchEvent(new DragEvent("drop", { dataTransfer: dt, bubbles: true, cancelable: true }));
  }, what);
}

test.beforeEach(async ({ page }) => {
  await remember(page, P);
  await endAll(page);
});
test.afterEach(async ({ page }) => {
  await endAll(page);
});

async function openTerminal(page: Page) {
  await page.goto(at(P, "/drafts"));
  await toggle(page).click();
  await expect.poll(() => screenText(page), { timeout: 15_000 }).toContain("fake$");
}

test("terminal drop: a PNG is copied under state/drops/<project>/<session>/ and its path pasted; nothing runs before Enter", async ({ page }) => {
  await openTerminal(page);
  expect(await drop(dropBox(page), { files: [["Screen shot 1.png", "PNG"]] })).toBe(true);
  await expect(page.getByRole("tabpanel").getByRole("status")).toHaveText("1 file pasted.");
  await expect(input(page)).toBeFocused();
  await expect.poll(() => flatText(page)).toMatch(/state\/drops\/lisbon-realty\/[\w-]+\/Screen-shot-1\.png/);
  expect(await screenText(page)).not.toContain("> ");
  await page.keyboard.press("Enter");
  await expect.poll(() => flatText(page)).toMatch(/> \S+\/state\/drops\/lisbon-realty\/[\w-]+\/Screen-shot-1\.png/);
});

test("terminal drop: three files, three paths one space apart, in order", async ({ page }) => {
  await openTerminal(page);
  await drop(dropBox(page), { files: [["a.png", "a"], ["b.png", "b"], ["c.png", "c"]] });
  await expect(page.getByRole("tabpanel").getByRole("status")).toHaveText("3 files pasted.");
  await page.keyboard.press("Enter");
  await expect.poll(() => flatText(page)).toMatch(/> \S+\/a\.png\s+\S+\/b\.png\s+\S+\/c\.png/);
});

test("terminal drop: text is typed as text, with no request", async ({ page }) => {
  await openTerminal(page);
  let posted = 0;
  page.on("request", (r) => { if (r.url().includes("/drops")) posted++; });
  expect(await drop(dropBox(page), { text: "hello from a page" })).toBe(true);
  await input(page).focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => screenText(page)).toContain("> hello from a page");
  expect(posted).toBe(0);
});

test("a file dropped elsewhere is swallowed; a text drag into the Drafts search box is left to the box", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  const search = page.getByRole("searchbox", { name: "Search drafts" });
  await expect(search).toBeVisible();
  expect(await drop(page.locator("#main"), { files: [["x.png", "x"]] })).toBe(true);
  expect(await drop(search, { text: "abc" })).toBe(false);
  await expect(page).toHaveURL(new RegExp(`/${P}/drafts`));
});
