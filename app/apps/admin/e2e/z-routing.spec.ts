import { expect, test } from "@playwright/test";
import { at, remember } from "./support";

// A batch is a read-only View of Drafts (P48: nothing creates one from the admin). An address naming a batch that is not in
// the project says so plainly and keeps the way back.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("a batch address that is not in this project says so", async ({ page }) => {
  await page.goto(at("lisbon-realty", "/drafts?batch=99999"));
  await expect(page.getByText("That batch is not in this project.")).toBeVisible();
  await page.reload();
  await expect(page.getByText("That batch is not in this project.")).toBeVisible();
});
