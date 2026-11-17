import { expect, test } from "@playwright/test";
import { remember } from "./support";

// "Not by email" (P27 M6): the clients the agent did not answer by email, read-only, below the Drafts list. Seeded for lisbon-realty:
// two calls (one with a phone), one no-reply, one crossed off, and no unknown sender (so the empty state is real).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("lists the groups collapsed, shows a phone as plain text and the phrase that fills an empty group", async ({ page }) => {
  await page.goto("/drafts");
  const block = page.getByTestId("not-by-email");
  await expect(block.getByText("Not by email (4)")).toBeVisible();
  await expect(page.getByTestId("not-by-email-row")).toHaveCount(0); // collapsed
  await block.getByText("Not by email (4)").click();
  await block.getByRole("button", { name: "Call 2", exact: true }).click();
  const rows = page.getByTestId("not-by-email-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Duarte Exemplo" })).toContainText("+351 912 000 000 (after 17:00)");
  await expect(block.getByRole("link")).toHaveCount(0); // a phone is never a link
  await block.getByRole("button", { name: "Unknown sender 0", exact: true }).click();
  await expect(page.getByTestId("not-by-email-empty")).toContainText("could not match");
  await expect(block.getByRole("button", { name: /^(send|dial|call now)/i })).toHaveCount(0);
});

test("the reply queue never lists them", async ({ page }) => {
  await page.goto("/drafts");
  await expect(page.getByTestId("inbox")).not.toContainText("Duarte Exemplo");
});
