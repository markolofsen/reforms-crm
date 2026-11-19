import { expect, test } from "@playwright/test";
import { address, at, remember, viewMenu } from "./support";

// Named y-* so it runs after smoke.spec.ts and before the z-* flows that change the data. Nothing here writes:
// keys only move, and the failures are mocked.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const cards = (page: import("@playwright/test").Page) => page.locator('ul[aria-label="Drafts"] > li');

test("the project and the filter live in the address", async ({ page }) => {
  await page.goto(at("lisbon-realty", "/drafts?filter=ready"));
  await expect(viewMenu(page)).toContainText("To review");
  await expect(cards(page)).toHaveCount(5);
  await viewMenu(page).click();
  await page.getByRole("menuitemradio", { name: /^Hold/ }).click();
  await expect.poll(() => address(page)).toMatch(/^\/lisbon-realty\/drafts(\/\d+)?\?filter=hold$/); // P53: the first held draft opens in the address
});

test("J and K move the cursor, ? shows the keys, and the switch turns them off", async ({ page }) => {
  await page.goto("/drafts?filter=all");
  await expect(cards(page)).toHaveCount(11);
  const current = page.locator('ul[aria-label="Drafts"] > li[data-open="true"]');
  const first = await current.getAttribute("id");
  await page.keyboard.press("j");
  await expect.poll(() => current.getAttribute("id")).not.toBe(first);
  await page.keyboard.press("k");
  await expect.poll(() => current.getAttribute("id")).toBe(first);

  await page.keyboard.press("Shift+?");
  await expect(page.getByText("reply in Mail (batch drafts)")).toBeVisible();

  await page.getByRole("switch", { name: /Shortcuts/ }).click();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("j");
  await expect.poll(() => current.getAttribute("id")).toBe(first);
});

test("a server error shows a sentence and Retry loads the list", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/drafts\?/, (route) => (fail ? route.fulfill({ status: 500, json: { error: "server error", code: "server" } }) : route.fallback()));
  await page.goto("/drafts?filter=all");
  await expect(page.getByText("Could not load drafts")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(cards(page)).toHaveCount(11);
});

test("a refusal from the server is shown as its sentence", async ({ page }) => {
  await page.route(/\/api\/drafts\/\d+\/status/, (route) => route.fulfill({ status: 409, json: { error: "That draft is already sent.", code: "wrong_state" } }));
  await page.goto("/drafts?filter=all");
  await expect(cards(page)).toHaveCount(11);
  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: "Hold for later" }).click();
  await expect(page.getByText("That draft is already sent.")).toBeVisible();
});

test("Project · Setup shows the safety rules", async ({ page }) => {
  await page.goto("/project/setup");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Setup", exact: true })).toHaveAttribute("aria-current", "page");
  // The rules sit under Advanced, one summary line (P48 W6), on Setup since P63; opening it shows the switches.
  await page.getByRole("button", { name: /^Advanced/ }).click();
  await expect(page.getByRole("switch").first()).toBeVisible();
});

test("a refused action is announced as an alert, not politely", async ({ page }) => {
  await page.route(/\/api\/drafts\/\d+\/status/, (route) => route.fulfill({ status: 409, json: { error: "This draft changed in the meantime.", code: "wrong_state" } }));
  await page.goto("/drafts?filter=ready");
  await expect(cards(page).first()).toBeVisible();
  await page.locator("#main").focus();
  await page.keyboard.press("h");
  await expect(page.getByRole("alert").filter({ hasText: "This draft changed in the meantime." })).toBeVisible();
});
