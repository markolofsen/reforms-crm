import { expect, test, type Page } from "@playwright/test";
import { address, at, remember } from "./support";

// Navigation contract (rules: routes-and-url-state): the e2e instance has two projects, so a scoped address names its project
// in the path (`/lisbon-realty/drafts/42`), never in a query; deep links survive a reload, Back returns from a subject to its
// list, an unknown path or a bad id is Not found (never Drafts), keys and the skip link keep the address honest, and the
// title follows the route. Named b-* so it runs before the specs that create data.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const P = "lisbon-realty";
const cards = (page: Page) => page.locator('ul[aria-label="Drafts"] > li');
const viewMenu = (page: Page) => page.getByRole("button", { name: /^View:/ });
/** P53: at 1280 the Drafts list opens its first row and the address names it (`/drafts/42`); a bare `/drafts` only while loading or empty. */
const listed = (project: string | null, query = "") => new RegExp(`^${project ? `/${project}` : ""}/drafts(/\\d+)?${query.replace(/[?]/g, "\\?")}$`);

async function firstDraftId(page: Page): Promise<string> {
  await page.goto(at(P, "/drafts"));
  await expect(cards(page).first()).toBeVisible();
  const id = (await cards(page).nth(1).getAttribute("id"))?.replace("draft-", "");
  if (!id) throw new Error("the seeded list has no second draft");
  return id;
}

test("two projects: the entry is the Overview, a bare scoped address gets the remembered project in its path", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => address(page)).toBe("/overview");
  await page.goto("/drafts");
  await expect.poll(() => address(page)).toMatch(listed(P));
  await page.goto("/log");
  await expect.poll(() => address(page)).toBe(at(P, "/log"));
  await page.goto("/connections");
  await expect.poll(() => address(page)).toBe("/connections");
  // P63: the new pages, each a cold load in its canonical form (Agents and the Project children are scoped, Help is not).
  await page.goto("/agents");
  await expect.poll(() => address(page)).toBe(at(P, "/agents"));
  await page.goto("/project/setup");
  await expect.poll(() => address(page)).toBe(at(P, "/project/setup"));
  await page.goto(at(P, "/project/knowledge"));
  await expect.poll(() => address(page)).toBe(at(P, "/project/knowledge"));
  await page.reload();
  await expect(page).toHaveTitle(`Knowledge · ${P} · Hub Workflow`);
  await page.goto("/help");
  await expect.poll(() => address(page)).toBe("/help");
  await expect(page).toHaveTitle("Help · Hub Workflow");
});

test("saved links of the query era (until 2026-11-18) open the same view in the path form", async ({ page }) => {
  const id = await firstDraftId(page);
  await page.goto(`/drafts/${id}?project=${P}&filter=all`);
  await expect.poll(() => address(page)).toBe(at(P, `/drafts/${id}?filter=all`));
  await page.goto("/drafts?project=demo-shop");
  await expect.poll(() => address(page)).toMatch(listed("demo-shop"));
  await page.goto(`/drafts?project=${P}&new=1`); // the batch builder's address: gone, the list opens
  await expect.poll(() => address(page)).toMatch(listed(P));
});

test("a Drafts deep link with a selected draft survives a reload", async ({ page }) => {
  const id = await firstDraftId(page);
  await page.goto(at(P, `/drafts/${id}`));
  const current = page.locator(`ul[aria-label="Drafts"] > li#draft-${id}`);
  await expect(current).toHaveAttribute("data-open", "true");
  await page.reload();
  await expect(current).toHaveAttribute("data-open", "true");
  await expect.poll(() => address(page)).toBe(at(P, `/drafts/${id}`));
  await expect(page).toHaveTitle(new RegExp(`^Draft ${id} · Drafts · ${P} · Hub Workflow$`));
});

test("a view in the address survives a reload, and a bad one resets", async ({ page }) => {
  await page.goto(at(P, "/drafts?filter=hold"));
  await expect(viewMenu(page)).toContainText("Hold");
  await page.reload();
  await expect(viewMenu(page)).toContainText("Hold");
  await page.goto(at(P, "/drafts?filter=zzz"));
  await expect(viewMenu(page)).toContainText("To review");
  await expect.poll(() => address(page)).toMatch(listed(P));
});

test("the first draft opens in the address without a history entry; moving between drafts and views replaces (P53)", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await expect(cards(page).first()).toBeVisible();
  const first = (await cards(page).first().getAttribute("id"))?.replace("draft-", "");
  await expect.poll(() => address(page)).toBe(at(P, `/drafts/${first}`)); // the card on screen is the one the address names
  await expect(cards(page).first()).toHaveAttribute("data-open", "true");
  const entries = await page.evaluate(() => window.history.length);
  await page.keyboard.press("j");
  await expect.poll(() => address(page)).toMatch(new RegExp(`^/${P}/drafts/(?!${first}$)\\d+$`));
  await viewMenu(page).click();
  await page.getByRole("menuitemradio", { name: /^Hold/ }).click();
  await expect.poll(() => address(page)).toMatch(listed(P, "?filter=hold"));
  expect(await page.evaluate(() => window.history.length)).toBe(entries); // neither the auto-open, a move nor a view is a page
});

test("the Activity deep link keeps its view and opened session", async ({ page }) => {
  await page.goto(at(P, "/log?filter=all&run=1"));
  await expect.poll(() => address(page)).toBe(at(P, "/log?run=1"));
  await page.reload();
  await expect(page.getByRole("region", { name: "Session", exact: true })).toBeVisible();
  await expect(page).toHaveTitle(`Activity · ${P} · Hub Workflow`);
});

test("the Project screen survives a reload", async ({ page }) => {
  await page.goto(at(P, "/project"));
  await page.reload();
  await expect(page.getByTestId("project-status")).toBeVisible();
  await expect(page).toHaveTitle(`Project · ${P} · Hub Workflow`);
});

for (const bad of ["/clients", "/nope", "/drafts/abc", "/drafts/1/2", `/${P}/overview`, `/${P}/help`, "/project/nope"]) {
  test(`${bad} is Not found, with a way back, never Drafts`, async ({ page }) => {
    await page.goto(bad);
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.locator('ul[aria-label="Drafts"]')).toHaveCount(0);
    await expect(page).toHaveTitle("Not found · Hub Workflow");
    await page.getByRole("link", { name: "Go to Drafts" }).click();
    await expect.poll(() => address(page)).toMatch(listed(P));
    await expect(cards(page).first()).toBeVisible();
  });
}

test("a draft id that is not in the list says so and keeps the list", async ({ page }) => {
  await page.goto(at(P, "/drafts/99999"));
  await expect(page.getByText("Draft 99999 is not in this list")).toBeVisible();
  await expect(cards(page).first()).toBeVisible();
});

test("g then d / a / p / t move between screens; typing in a field is left alone", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await expect(cards(page).first()).toBeVisible();
  for (const [key, path] of [["a", "/log"], ["p", "/project"], ["t", "/agents"], ["d", "/drafts"]] as const) {
    await page.keyboard.press("g");
    await page.keyboard.press(key);
    await expect.poll(() => address(page)).toMatch(path === "/drafts" ? listed(P) : new RegExp(`^${at(P, path)}$`));
  }
  await expect(cards(page).first()).toBeVisible();
  await page.getByRole("searchbox", { name: "Search drafts" }).fill("g");
  await page.keyboard.type("b");
  // The letters went into the field (the search is in the address as `q`); no chord moved the screen.
  await expect.poll(() => address(page)).toMatch(listed(P, "?q=gb"));
});

test("the skip link moves focus and leaves the address alone", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await expect(cards(page).first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  expect(await address(page)).toMatch(listed(P));
});

test("the nav links are real anchors in the path form; two projects show the switcher and Overview", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  await expect(nav.getByRole("link", { name: "Drafts" })).toHaveAttribute("aria-current", "page");
  await expect(nav.getByRole("link", { name: "Activity" })).toHaveAttribute("href", at(P, "/log"));
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/overview");
  await expect(nav.getByRole("link", { name: "Agents" })).toHaveAttribute("href", at(P, "/agents"));
  await expect(nav.getByRole("link", { name: "Help" })).toHaveAttribute("href", "/help");
  await expect(page.getByRole("button", { name: P }).first()).toBeVisible();
});

// P63 N1: the nested nav. Project's children show under it in the open sidebar only while Project is active (no tab stop on
// any other screen), never on the rail; every Project page carries the sub-nav in its header line, on every width.
test("the nested nav: Knowledge and Setup under an active Project, and the sub-nav on every Project page", async ({ page }) => {
  const wide = (page.viewportSize()?.width ?? 0) >= 1280;
  await page.goto(at(P, "/drafts"));
  await expect(cards(page).first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  await expect(nav.getByRole("link", { name: "Setup" })).toHaveCount(0);
  for (const [name, path] of [["Project", "/project"], ["Knowledge", "/project/knowledge"], ["Setup", "/project/setup"]] as const) {
    await page.goto(at(P, path));
    const sub = page.getByRole("navigation", { name: "Project pages" });
    await expect(sub.getByRole("link", { name, exact: true })).toHaveAttribute("aria-current", "page");
    await expect(sub.getByRole("link")).toHaveText(["Project", "Knowledge", "Setup"]);
    if (wide) await expect(nav.getByRole("link", { name: "Setup", exact: true })).toHaveAttribute("href", at(P, "/project/setup"));
  }
  // Keyboard alone: from the landing's sub-nav to Knowledge.
  await page.goto(at(P, "/project"));
  const knowledge = page.getByRole("navigation", { name: "Project pages" }).getByRole("link", { name: "Knowledge" });
  await knowledge.focus();
  await page.keyboard.press("Enter");
  await expect.poll(() => address(page)).toBe(at(P, "/project/knowledge"));
});

// Status policy for a not-found page. A route Next does not match (/nope/x/y) answers a real 404. A route that matches but
// whose id is not a number (/drafts/abc) is decided on the client, after the shell has streamed, so its status is already
// sent: 200 with the Not-found body, title and a way back.
test("status policy: an unmatched path is a real 404; a streamed bad id is 200 with the Not-found body", async ({ page }) => {
  expect((await page.request.get("/nope/x/y")).status()).toBe(404);
  const streamed = await page.request.get(at(P, "/drafts/abc"));
  expect(streamed.status()).toBe(200);
  expect(await streamed.text()).not.toContain("Sofia Teste");
});

// One project (P48 point 15): the project leaves the address, the entry is Drafts, and there is no switcher. Overview is in the
// nav and is a page (P63), not the entry. The e2e instance has two, so the answer is patched; the pages still read the real project's data.
test("one project: no project in the address, no switcher, Overview in the nav but not the entry, and a path-form link folds back", async ({ page }) => {
  await page.route(/\/api\/projects$/, (route) => route.fulfill({ json: { projects: [P] } }));
  await page.goto("/");
  await expect.poll(() => address(page)).toMatch(listed(null));
  await expect(cards(page).first()).toBeVisible();
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  await expect(nav.getByRole("link", { name: "Activity" })).toHaveAttribute("href", "/log");
  await expect(nav.getByRole("link", { name: "Overview" })).toHaveAttribute("href", "/overview");
  await expect(page.getByRole("button", { name: P })).toHaveCount(0);
  await page.goto("/overview");
  await expect.poll(() => address(page)).toBe("/overview");
  // With one project the page is the parts table alone: no project sentence and no project table (they would repeat Project).
  await expect(page.getByRole("table", { name: "Parts" }).or(page.getByRole("list", { name: "Parts" })).first()).toBeVisible();
  await expect(page.getByTestId("overview-sentence")).toHaveCount(0);
  await page.goto(at(P, "/project/setup"));
  await expect.poll(() => address(page)).toBe("/project/setup");
  await page.goto(at(P, "/log?run=1"));
  await expect.poll(() => address(page)).toBe("/log?run=1");
});
