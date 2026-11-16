import { expect, test, type Page } from "@playwright/test";
import { address, remember } from "./support";

// Navigation contract (rules: routes-and-url-state): deep links survive a reload in a real browser, Back returns from
// a subject to its list, an unknown path or a bad id is Not found (never Drafts), keys and the skip link keep the
// address honest, and the title follows the route. Named b-* so it runs before the specs that create data.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const cards = (page: Page) => page.locator('ul[aria-label="Drafts"] > li');

async function firstDraftId(page: Page): Promise<string> {
  await page.goto("/drafts");
  await expect(cards(page).first()).toBeVisible();
  const id = (await cards(page).nth(1).getAttribute("id"))?.replace("draft-", "");
  if (!id) throw new Error("the seeded list has no second draft");
  return id;
}

test("the address names the project (Overview excepted), and the empty address is the Overview while there are two projects", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => address(page)).toBe("/overview");
  await page.goto("/drafts");
  await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty");
  await page.goto("/log");
  await expect.poll(() => address(page)).toBe("/log?project=lisbon-realty");
});

test("a Drafts deep link with filter and selected draft survives a reload", async ({ page }) => {
  const id = await firstDraftId(page);
  await page.goto(`/drafts/${id}?project=lisbon-realty`);
  const current = page.locator(`ul[aria-label="Drafts"] > li#draft-${id}`);
  await expect(current).toHaveAttribute("data-open", "true");
  await page.reload();
  await expect(current).toHaveAttribute("data-open", "true");
  await expect.poll(() => address(page)).toBe(`/drafts/${id}?project=lisbon-realty`);
  await expect(page).toHaveTitle(new RegExp(`^Draft ${id} · Drafts · lisbon-realty · Hub Workflow$`));
});

test("a filter in the address survives a reload, and a bad one resets", async ({ page }) => {
  await page.goto("/drafts?project=lisbon-realty&filter=ready");
  await expect(page.getByRole("radio", { name: /^To review/ })).toBeChecked();
  await page.reload();
  await expect(page.getByRole("radio", { name: /^To review/ })).toBeChecked();
  await page.goto("/drafts?project=lisbon-realty&filter=zzz");
  await expect(page.getByRole("radio", { name: /^To review/ })).toBeChecked();
  await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty");
  // To review is the default and drops its key; All is a choice and keeps it.
  await page.goto("/drafts?project=lisbon-realty&filter=all");
  await expect(page.getByRole("radio", { name: /^All\s*\d+$/ })).toBeChecked();
  await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty&filter=all");
});

test("picking a draft pushes, a filter replaces, and Back from the draft lands on the list", async ({ page }) => {
  await page.goto("/drafts?project=lisbon-realty");
  await expect(cards(page).first()).toBeVisible();
  await page.keyboard.press("j"); // the first move from the list names a draft: a subject, so a new history entry
  await expect.poll(() => address(page)).toMatch(/^\/drafts\/\d+\?project=lisbon-realty$/);
  await page.goBack();
  await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty");
  const entries = await page.evaluate(() => window.history.length);
  await page.getByRole("radio", { name: /^Hold/ }).click();
  await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty&filter=hold");
  expect(await page.evaluate(() => window.history.length)).toBe(entries); // a filter is not a page: no new entry
});

test("the Activity deep link keeps its filter and opened run", async ({ page }) => {
  await page.goto("/log?project=lisbon-realty&filter=all&run=1");
  await expect(page.locator("#run-1").getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
  await page.reload();
  await expect(page.locator("#run-1").getByRole("button", { name: "Details" })).toHaveAttribute("aria-expanded", "true");
  await expect.poll(() => address(page)).toBe("/log?project=lisbon-realty&run=1");
  await expect(page).toHaveTitle("Activity · lisbon-realty · Hub Workflow");
});

test("the Project screen survives a reload", async ({ page }) => {
  await page.goto("/project?project=lisbon-realty");
  await page.reload();
  await expect(page.getByRole("switch").first()).toBeVisible();
  await expect(page).toHaveTitle("Project · lisbon-realty · Hub Workflow");
});

for (const bad of ["/clients", "/nope?project=lisbon-realty", "/drafts/abc?project=lisbon-realty", "/bulk/x", "/drafts/1/2"]) {
  test(`${bad} is Not found, with a way back, never Drafts`, async ({ page }) => {
    await page.goto(bad);
    await expect(page.getByText("Page not found")).toBeVisible();
    await expect(page.locator('ul[aria-label="Drafts"]')).toHaveCount(0);
    await expect(page).toHaveTitle("Not found · Hub Workflow");
    await page.getByRole("link", { name: "Go to Drafts" }).click();
    await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty");
    await expect(cards(page).first()).toBeVisible();
  });
}

test("a draft id that is not in the list says so and keeps the list", async ({ page }) => {
  await page.goto("/drafts/99999?project=lisbon-realty");
  await expect(page.getByText("Draft 99999 is not in this list")).toBeVisible();
  await expect(cards(page).first()).toBeVisible();
});

test("g then b / d / a / p move between screens; typing in a field is left alone", async ({ page }) => {
  await page.goto("/drafts?project=lisbon-realty");
  await expect(cards(page).first()).toBeVisible();
  await page.keyboard.press("g");
  await page.keyboard.press("b");
  await expect.poll(() => address(page)).toBe("/bulk?project=lisbon-realty");
  await page.keyboard.press("g");
  await page.keyboard.press("a");
  await expect.poll(() => address(page)).toBe("/log?project=lisbon-realty");
  await page.keyboard.press("g");
  await page.keyboard.press("p");
  await expect.poll(() => address(page)).toBe("/project?project=lisbon-realty");
  await page.keyboard.press("g");
  await page.keyboard.press("d");
  await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty");
  // The chord's second key never reaches the list's own `d` (done): nothing changed state.
  await expect(page.getByRole("radio", { name: /^All\s*11$/ })).toBeVisible();
  await page.getByRole("searchbox", { name: "Search the loaded drafts" }).fill("g");
  await page.keyboard.type("b");
  // The letters went into the field (the search is in the address as `q`); no chord moved the screen.
  await expect.poll(() => address(page)).toBe("/drafts?project=lisbon-realty&q=gb");
});

test("the skip link moves focus and leaves the address alone", async ({ page }) => {
  await page.goto("/drafts?project=lisbon-realty");
  await expect(cards(page).first()).toBeVisible();
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();
  expect(await address(page)).toBe("/drafts?project=lisbon-realty");
});

test("the nav links are real anchors with the project in their href", async ({ page }) => {
  await page.goto("/drafts?project=lisbon-realty");
  const nav = page.getByRole("navigation", { name: "Sections" });
  await expect(nav.getByRole("link", { name: "Bulk" })).toHaveAttribute("href", "/bulk?project=lisbon-realty");
  await expect(nav.getByRole("link", { name: "Drafts" })).toHaveAttribute("aria-current", "page");
});

// Status policy for a not-found page. A route Next does not match (/nope, /clients) answers a real 404. A route that matches
// but whose id is not a number (/drafts/abc) is decided on the client, after the shell has streamed, so its status is already
// sent: 200 with the Not-found body, title and a way back. That is why the assertions above are on the body and title, not the
// status, and why this test pins both facts so a change in either is noticed rather than assumed.
test("status policy: an unmatched path is a real 404; a streamed bad id is 200 with the Not-found body", async ({ page }) => {
  expect((await page.request.get("/nope")).status()).toBe(404);
  const streamed = await page.request.get("/drafts/abc?project=lisbon-realty");
  expect(streamed.status()).toBe(200);
  expect(await streamed.text()).not.toContain("Sofia Teste");
});
