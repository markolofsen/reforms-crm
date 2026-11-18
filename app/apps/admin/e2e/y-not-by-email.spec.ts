import { expect, test } from "@playwright/test";
import { address, at, remember } from "./support";

// "Not by email" (P27 M6, a View of Drafts since P48): the clients the agent did not answer by email, read-only. Seeded for lisbon-realty:
// two calls (one with a phone), one no-reply, one crossed off, and no unknown sender (so the empty state is real).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("Not by email is a View of Drafts: its count in the menu, a phone as plain text, the phrase that fills an empty group", async ({ page }) => {
  await page.goto(at("lisbon-realty", "/drafts"));
  await page.getByRole("button", { name: /^View:/ }).click();
  await page.getByRole("menuitemradio", { name: /^Not by email\s*4$/ }).click();
  await expect.poll(() => address(page)).toBe(at("lisbon-realty", "/drafts?filter=not_by_email"));
  const block = page.getByTestId("not-by-email");
  await block.getByRole("button", { name: "Call 2", exact: true }).click();
  const rows = page.getByTestId("not-by-email-row");
  await expect(rows).toHaveCount(2);
  await expect(rows.filter({ hasText: "Duarte Exemplo" })).toContainText("+351 912 000 000 (after 17:00)");
  await expect(block.getByRole("link")).toHaveCount(0); // a phone is never a link
  await block.getByRole("button", { name: "Unknown sender 0", exact: true }).click();
  await expect(page.getByTestId("not-by-email-empty")).toContainText("could not match");
  await expect(block.getByRole("button", { name: /^(send|dial|call now)/i })).toHaveCount(0);
});

test("the draft list never lists them", async ({ page }) => {
  await page.goto(at("lisbon-realty", "/drafts?filter=all"));
  await expect(page.locator('ul[aria-label="Drafts"]')).not.toContainText("Duarte Exemplo");
});
