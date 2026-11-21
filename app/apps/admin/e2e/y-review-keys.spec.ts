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
  const help = page.getByText("Keyboard shortcuts", { exact: true });
  await expect(help).toBeVisible();
  await expect(page.getByText("select every person with an open draft")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(help).toHaveCount(0);
});
