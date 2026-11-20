import { expect, test } from "@playwright/test";
import { openRow, remember } from "./support";

// One thread view per card: the "Thread" button (key T) opens the client's history, mail read live plus messenger rows
// and what the agent did. Nothing is read until it is opened (it is fetched on open), and the card has no second thread block.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("the thread opens from the button and from the T key, reads nothing before, and is the only thread block", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (r) => {
    if (/\/clients\/\d+\/history/.test(r.url())) reads.push(r.url());
  });
  await page.goto("/mail?filter=all");
  const card = await openRow(page, "Marta Ficticia");
  expect(reads).toEqual([]);
  await expect(card.getByTestId("mail-thread")).toHaveCount(0);
  await card.getByRole("button", { name: "Thread" }).click();
  await expect(card.getByRole("region", { name: "Messages" })).toBeVisible();
  await expect(card.getByRole("region", { name: "Agent activity" })).toBeVisible();
  expect(reads).toHaveLength(1);
  await card.getByRole("button", { name: "Hide thread" }).click();
  await expect(card.getByRole("region", { name: "Messages" })).toHaveCount(0);
  await page.keyboard.press("t");
  await expect(card.getByRole("region", { name: "Messages" })).toBeVisible();
});
