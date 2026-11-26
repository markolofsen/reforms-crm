import { expect, test } from "@playwright/test";
import { remember } from "./support";

// The Drafts list selection keys in a real browser: X selects, Esc clears the selection first, Shift+A selects every open draft.
// Nuno (do not contact) is the subject of the one write, Hold then H back; Sofia and Marta are left alone for the send specs.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("X selects, Esc clears, Shift+A selects every open draft", async ({ page }) => {
  await page.goto("/mail?filter=all");
  const first = page.getByRole("link", { name: /Marta|Pedro|Sofia/ }).first();
  await first.focus();
  await page.keyboard.press("x");
  const said = page.getByTestId("list-header").getByRole("status");
  await expect(said).toHaveText("1 selected");
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Selected drafts" })).toHaveCount(0);
  await first.focus();
  await page.keyboard.press("Shift+A");
  await expect(said).toHaveText(/^(?:[2-9]|[1-9]\d+) selected$/);
  await page.keyboard.press("Escape");
  await expect(page.getByRole("toolbar", { name: "Selected drafts" })).toHaveCount(0);
});
