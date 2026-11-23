import { expect, test } from "@playwright/test";
import { remember } from "./support";

// The review keys of research 16 section 5.7 that z-keyboard does not walk: Enter into the card, Esc back, Shift+A, `?`.
// Nothing is written (a selection and a popover only), so this runs with the y-* flows.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
  await page.goto("/mail?filter=all");
  await expect(page.locator('ul[aria-label="People"] > li[data-open="true"]')).toHaveCount(1);
});

test("Enter goes from the list into the open card and Esc comes back to its row", async ({ page }) => {
  const open = page.locator('ul[aria-label="People"] > li[data-open="true"]');
  // The open card settles first (its Mail read and live checks, P85b): Enter then lands on the card it shows.
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Enter");
  await expect(page.locator('[data-pane="detail"] :focus')).toHaveCount(1);
  await page.keyboard.press("Escape");
  await expect(open.locator(":focus")).toHaveCount(1);
  await expect(page.locator('[data-pane="detail"] :focus')).toHaveCount(0);
});

test("Shift+A selects every open draft, the bar says how many, and Esc clears it before anything else", async ({ page }) => {
  // The keys are registered once the list has settled (its reads and live checks), as in the Enter test above.
  await page.waitForLoadState("networkidle");
  await page.keyboard.press("Shift+A");
  const bar = page.getByRole("toolbar", { name: "Selected drafts" });
  await expect(bar).toBeVisible();
  const said = page.getByTestId("list-header").getByRole("status"); // the live region, said once (P48 W4)
  await expect(said).toHaveText(/^\d+ selected$/);
  expect(Number((await said.innerText()).split(" ")[0])).toBeGreaterThan(1);
  await page.keyboard.press("Escape");
  await expect(bar).toHaveCount(0);
});

test("? opens the shortcuts, which list this screen's keys, and Esc closes them", async ({ page }) => {
  await page.keyboard.press("?");
  // The popover is the dialog named by its title; the trigger's tooltip says the same words when Esc gives it focus back.
  const help = page.getByRole("dialog", { name: "Keyboard shortcuts" });
  await expect(help).toBeVisible();
  await expect(page.getByText("select every person with an open draft")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});

// P127 C2: Messengers takes Mail's list keys (J/K move and replace the entry, / searches); it registers no selection keys.
test("Messengers: J moves to the next linked chat in place, / focuses the search, Shift+A selects nothing", async ({ page }) => {
  await page.goto("/lisbon-realty/messengers?filter=all&link=linked");
  const chats = page.getByRole("list", { name: "Chats" });
  await expect(chats.getByRole("listitem")).toHaveCount(2);
  await expect(page).toHaveURL(/\/messengers\/c\/\d+/);
  await page.waitForLoadState("networkidle");
  const first = page.url();
  const length = await page.evaluate(() => history.length);
  await page.keyboard.press("j");
  await expect(page).not.toHaveURL(first);
  expect(await page.evaluate(() => history.length)).toBe(length);
  await page.keyboard.press("/");
  await expect(page.getByRole("searchbox", { name: "Search chats" })).toBeFocused();
  await page.keyboard.press("Escape");
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("Shift+A");
  await expect(page.getByRole("toolbar", { name: "Selected drafts" })).toHaveCount(0);
});
