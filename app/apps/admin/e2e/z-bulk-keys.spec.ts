import { expect, test } from "@playwright/test";
import { remember } from "./support";

// The Drafts list selection keys in a real browser: X selects, Esc clears the selection first, Shift+A selects every open draft.
// Nuno (do not contact) is the subject of the one write, Hold then H back; Sofia and Marta are left alone for the send specs.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("X selects, Esc clears, Shift+A selects every open draft", async ({ page }) => {
  await page.goto("/drafts?filter=all");
  const first = page.getByRole("button", { name: /Marta|Pedro|Sofia/ }).first();
  await first.focus();
  await page.keyboard.press("x");
  await expect(page.getByText(/^1 selected$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/selected$/)).toHaveCount(0);
  await first.focus();
  await page.keyboard.press("Shift+A");
  await expect(page.getByText(/^[2-9]\d* selected$/)).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByText(/selected$/)).toHaveCount(0);
});
