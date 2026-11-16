import { expect, test } from "@playwright/test";
import { remember } from "./support";

// The Client menu in a real browser: a flag changes at once, the toast offers Undo, and Undo puts the mark back.
// Luis is used because no later spec touches his flags (Sofia and Marta carry the send specs); the mark is restored.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("Client menu: Follow up applies, Undo restores it", async ({ page }) => {
  await page.goto("/drafts?filter=all&q=Luis");
  await page.getByRole("button", { name: /Luis/ }).first().click();
  await page.getByRole("button", { name: "Client", exact: true }).click();
  const item = page.getByRole("menuitemcheckbox", { name: "Follow up" });
  const before = await item.getAttribute("aria-checked");
  await item.click();
  await expect(page.getByText(/Marked Follow up|Follow up turned off/)).toBeVisible();
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await page.getByRole("button", { name: "Client", exact: true }).click();
  await expect(page.getByRole("menuitemcheckbox", { name: "Follow up" })).toHaveAttribute("aria-checked", before ?? "false");
  await page.keyboard.press("Escape");
});
