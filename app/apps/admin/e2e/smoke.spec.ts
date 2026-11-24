import { expect, test } from "@playwright/test";
import { at, cards, listTitle, mailViews, remember } from "./support";

// The seeded project `lisbon-realty` is invented data (packages/db/src/seed.ts): 11 clients with a draft, and two the agent left
// to the owner (Marta Gomes, Joao Pires: an owed Inbox row, no draft). P99: Mail lists people, so All has 13 rows, one per person
// with mail; a client with none (Rita Falsa: a Telegram chat only, the newsletter sender) never appears.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("Mail list loads with counts and only people with mail", async ({ page }) => {
  await page.goto("/mail?filter=all");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Mail", exact: true })).toBeVisible();
  await expect(cards(page)).toHaveCount(13);
  await expect(cards(page).filter({ hasText: "Joao Pires" }).getByTestId("person-state")).toHaveText("Wrote you");
  await expect(cards(page).filter({ hasText: "Rita Falsa" })).toHaveCount(0);
  // P134: the counts live in the sidebar's Mail views and the title names the view; Replies owed and High value are not views.
  await expect(listTitle(page)).toHaveText(/^All · 13$/);
  await expect(mailViews(page).getByRole("link")).toHaveText([/^Needs you\s*\d+/, /^Waiting/, /^All\s*13/, /^Leads/]);
});

test("Open the draft in Mail links the Mail draft by its own Message-ID; the client's mail is in the More menu (P58 R1)", async ({ page }) => {
  await page.goto("/mail?filter=all");
  await cards(page).filter({ hasText: "Pedro Exemplo" }).getByRole("link").first().click();
  const card = page.getByRole("article", { name: "Draft for Pedro Exemplo" });
  await expect(card.getByRole("link", { name: /Open the draft in Mail/ })).toHaveAttribute("href", /^message:\/\/%3Cfake-\d+%40hub\.test%3E$/);
  await expect(card.getByTestId("from-line")).toContainText(/^From .+ → To .*pedro/i);
  await card.getByRole("button", { name: "More actions" }).click();
  await expect(page.getByRole("menuitem", { name: "Open their message" })).toHaveAttribute("href", "message://%3Cseed-pedro-at-example.org%40example.com%3E");
});

test("A project with no conversation says what to ask the agent", async ({ page }) => {
  await page.route(/\/api\/projects\/[^/]+\/conversations\?/, (route) => route.fulfill({ json: { rows: [], counts: { needs_you: 0, waiting: 0, all: 0, sequences: 0 }, total: 0, nextOffset: null, brands: [] } }));
  await page.goto("/mail?filter=all");
  await expect(page.getByText("Say to the agent: “triage mail for lisbon-realty”")).toBeVisible();
});

test("Done moves the person below everyone who needs you", async ({ page }) => {
  await page.goto("/mail?filter=all");
  const row = cards(page).filter({ hasText: "Pedro Exemplo" });
  await expect(row).toBeVisible();
  const states = () => cards(page).evaluateAll((rows) => rows.map((r) => [r.textContent?.includes("Pedro Exemplo") ?? false, r.getAttribute("data-state")] as const));
  const needs = (list: readonly (readonly [boolean, string | null])[]) => list.filter(([, s]) => s === "wrote" || s === "draft").length;
  const pedro = (list: readonly (readonly [boolean, string | null])[]) => list.findIndex(([p]) => p);
  expect(pedro(await states())).toBeLessThan(needs(await states()));

  await row.getByRole("link").first().click();
  const card = page.getByRole("article", { name: "Draft for Pedro Exemplo" });
  const draftId = (await card.getAttribute("data-agent-ref"))?.replace("draft:", "");

  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Mark done/ }).click();
  await expect(row.getByRole("img", { name: "Done" })).toBeVisible();
  // P99: Needs you's words sort first, so Pedro, done, now sits right under the last of them (his activity is the newest).
  await expect.poll(async () => { const l = await states(); return pedro(l) - needs(l); }).toBe(0);
  // Reopen his draft: z-client-menu needs Pedro's open card (a Done conversation shows no unsent message).
  expect((await page.request.post(`/api/drafts/${draftId}/status`, { data: { project: "lisbon-realty", status: "ready" } })).ok()).toBe(true);
});

test("Activity is one page: the timeline, no detail pane and no dialog (P73)", async ({ page }) => {
  await page.goto(at("lisbon-realty", "/log"));
  await expect(page.getByRole("table", { name: "Activity" })).toBeVisible();
  await expect(page.getByRole("region", { name: "Session", exact: true })).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
});
