import { expect, test } from "@playwright/test";
import { remember } from "./support";

// A batch is a filter on Drafts: needs a batch, so it runs after z-batch.spec.ts created one (one worker, one database).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("a batch address (/drafts?batch=<id>) survives a reload, and a missing batch says so", async ({ page }) => {
  await page.goto("/drafts?project=lisbon-realty");
  await page.getByRole("button", { name: /All drafts/ }).first().click();
  await page.getByRole("menuitemradio").nth(1).click();
  await expect(page).toHaveURL(/\/drafts\?project=lisbon-realty&batch=\d+/);
  const address = page.url();
  await page.reload();
  expect(page.url()).toBe(address);
  await expect(page.getByTestId("batch-head")).toBeVisible();
  await page.goto("/drafts?project=lisbon-realty&batch=99999");
  await expect(page.getByTestId("batch-gone")).toBeVisible();
});
