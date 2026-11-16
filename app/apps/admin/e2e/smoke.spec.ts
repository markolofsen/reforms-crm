import { expect, test } from "@playwright/test";
import { cards, readTheChecks, remember } from "./support";

// The seeded project `lisbon-realty` is invented data (packages/db/src/seed.ts): 13 clients, 11 of them with a draft.
// The Drafts screen lists only those 11; a client without a draft (Rita Falsa, the newsletter sender) never appears.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("Drafts list loads with counts and only clients that have a draft", async ({ page }) => {
  await page.goto("/drafts?filter=all");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Drafts", exact: true })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^All\s*11$/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^To review\s*6$/ })).toBeVisible();
  await expect(page.getByRole("radio", { name: /^Replies owed/ })).toHaveCount(0);
  await expect(cards(page)).toHaveCount(11);
  await expect(cards(page).filter({ hasText: "Rita Falsa" })).toHaveCount(0);
  // The high-value filter is gone.
  await expect(page.getByRole("radio", { name: /High value/ })).toHaveCount(0);
});

test("Open in Mail links to the message by its Message-ID", async ({ page }) => {
  await page.goto("/drafts?filter=all");
  await cards(page).filter({ hasText: "Pedro Exemplo" }).getByRole("button").first().click();
  await expect(page.getByRole("article", { name: "Draft for Pedro Exemplo" }).getByRole("link", { name: /Open in Mail/ })).toHaveAttribute("href", "message://%3Cseed-pedro-at-example.org%40example.com%3E");
});

test("A project with no drafts says what to ask the agent", async ({ page }) => {
  await page.route(/\/api\/drafts\?/, (route) =>
    route.fulfill({ json: { drafts: [], counts: { all: 0, ready: 0, hold: 0, owed: 0, done: 0, sent: 0, skipped: 0, evidence: 0 }, total: 0, nextOffset: null } }),
  );
  await page.goto("/drafts?filter=all");
  await expect(page.getByText("Ask the agent: разбери почту lisbon-realty")).toBeVisible();
});

test("I read the checks, then Done moves the card to the bottom", async ({ page }) => {
  await page.goto("/drafts?filter=all");
  const row = cards(page).filter({ hasText: "Pedro Exemplo" });
  await expect(row).toBeVisible();
  const index = async () => (await cards(page).allTextContents()).findIndex((t) => t.includes("Pedro Exemplo"));
  expect(await index()).toBeLessThan(6);

  await row.getByRole("button").first().click();
  const card = page.getByRole("article", { name: "Draft for Pedro Exemplo" });
  await readTheChecks(page);

  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Mark done/ }).click();
  await expect(row.getByRole("img", { name: "Done" })).toBeVisible();
  // Finished cards sort last: Pedro now sits among the final three (done, done, sent).
  await expect.poll(async () => (await cards(page).count()) - (await index())).toBeLessThanOrEqual(3);
});

test("Activity row opens inline", async ({ page }) => {
  await page.goto("/log");
  const run = page.locator("#run-1").getByRole("button", { name: "Details" });
  await expect(run).toHaveAttribute("aria-expanded", "false");
  await run.click();
  await expect(run).toHaveAttribute("aria-expanded", "true");
  await expect(page.getByText("Three new inbound messages since the last run")).toBeVisible();
  // Inline: still the same page, no dialog.
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
