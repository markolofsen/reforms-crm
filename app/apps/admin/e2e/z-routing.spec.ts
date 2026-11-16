import { expect, test } from "@playwright/test";
import { remember } from "./support";

// Subject-as-path for Bulk: needs a batch, so it runs after z-bulk.spec.ts created one (one worker, one database).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("a batch deep link (/bulk/<id>) survives a reload, and Back returns to the batch list", async ({ page }) => {
  await page.goto("/bulk?project=lisbon-realty");
  const first = page.getByRole("list", { name: "Batches" }).getByRole("link").first();
  await expect(first).toBeVisible();
  await first.click();
  await expect(page).toHaveURL(/\/bulk\/\d+\?project=lisbon-realty$/);
  const address = page.url();
  await page.reload();
  expect(page.url()).toBe(address);
  await expect(page.getByRole("link", { name: "All batches" })).toBeVisible();
  await expect(page).toHaveTitle(/^Batch \d+ · Bulk · lisbon-realty · Hub Workflow$/);
  await page.goBack();
  await expect(page).toHaveURL(/\/bulk\?project=lisbon-realty$/);
  await page.goto("/bulk/99999?project=lisbon-realty");
  await expect(page.getByText("Could not load this batch")).toBeVisible();
});
