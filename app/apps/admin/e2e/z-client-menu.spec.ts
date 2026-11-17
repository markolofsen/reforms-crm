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

test("Client menu: Do not contact asks first in a popover, Cancel changes nothing, Mark does, and Undo lifts it", async ({ page }) => {
  await page.goto("/drafts?filter=all&q=Pedro");
  await page.getByRole("button", { name: /Pedro/ }).first().click();
  const menu = () => page.getByRole("button", { name: "Client", exact: true });
  const flag = page.getByRole("menuitem", { name: "Do not contact..." });

  // Cancel: the question was asked and nothing was written, so the item still offers the flag.
  await menu().click();
  await flag.click();
  await expect(page.getByText("Do not contact Pedro?")).toBeVisible();
  await page.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(page.getByText("Do not contact Pedro?")).toHaveCount(0);
  await menu().click();
  await expect(flag).toBeVisible();
  await page.keyboard.press("Escape");

  // Confirm: the flag is set, the toast offers Undo, the card has no Send, and the menu now offers the way back.
  await menu().click();
  await flag.click();
  await page.getByRole("button", { name: "Mark do not contact", exact: true }).click();
  await expect(page.getByText("Marked Do not contact")).toBeVisible();
  await expect(page.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await menu().click();
  await expect(page.getByRole("menuitem", { name: "Do not contact..." })).toBeVisible();
  await page.keyboard.press("Escape");
});
