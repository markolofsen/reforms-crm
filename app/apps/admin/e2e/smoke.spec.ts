import { expect, test } from "@playwright/test";
import { at, cards, readTheChecks, remember, viewMenu } from "./support";

// The seeded project `lisbon-realty` is invented data (packages/db/src/seed.ts): 13 clients, 11 of them with a draft.
// The Drafts screen lists only those 11; a client without a draft (Rita Falsa, the newsletter sender) never appears.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("Mail list loads with counts and only clients that have a draft", async ({ page }) => {
  await page.goto("/mail?filter=all");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Mail", exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(11);
  await expect(cards(page).filter({ hasText: "Rita Falsa" })).toHaveCount(0);
  // The counts live in the one View menu (P48 W4); Replies owed and High value are not views.
  await viewMenu(page).click();
  await expect(page.getByRole("menuitemradio", { name: /^All\s*11$/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /^To review\s*6$/ })).toBeVisible();
  await expect(page.getByRole("menuitemradio", { name: /^Replies owed|High value/ })).toHaveCount(0);
});

test("Open draft in Mail links the Mail draft by its own Message-ID; the client's mail is in the More menu (P58 R1)", async ({ page }) => {
  await page.goto("/mail?filter=all");
  await cards(page).filter({ hasText: "Pedro Exemplo" }).getByRole("button").first().click();
  const card = page.getByRole("article", { name: "Draft for Pedro Exemplo" });
  await expect(card.getByRole("link", { name: /Open draft in Mail/ })).toHaveAttribute("href", /^message:\/\/%3Cfake-\d+%40hub\.test%3E$/);
  await expect(card.getByTestId("from-line")).toContainText(/^From .+ → To .*pedro/i);
  await card.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Open the client's mail" })).toHaveAttribute("href", "message://%3Cseed-pedro-at-example.org%40example.com%3E");
});

test("A project with no drafts says what to ask the agent", async ({ page }) => {
  await page.route(/\/api\/drafts\?/, (route) =>
    route.fulfill({ json: { drafts: [], counts: { all: 0, ready: 0, hold: 0, owed: 0, done: 0, sent: 0, skipped: 0, thin_basis: 0, sequences: 0 }, total: 0, nextOffset: null } }),
  );
  await page.goto("/mail?filter=all");
  await expect(page.getByText("Say to the agent: “triage mail for lisbon-realty”")).toBeVisible();
});

test("I read the checks, then Done moves the card to the bottom", async ({ page }) => {
  await page.goto("/mail?filter=all");
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

test("Activity is one page: the timeline, no detail pane and no dialog (P73)", async ({ page }) => {
  await page.goto(at("lisbon-realty", "/log"));
  await expect(page.getByRole("table", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Session", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
