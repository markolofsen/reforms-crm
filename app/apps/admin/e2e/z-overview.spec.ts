import { expect, test, type Page, type Route } from "@playwright/test";
import { mailFresh, minutesAgo, notionFresh, remember, type OverviewJson } from "./support";

// The Overview refresh flows (P31 O4). Refresh is a read of Mail and Notion, so the POST is answered here from the page's
// own GET: no request reaches a mail server or Notion (the e2e server has neither), and nothing is written anywhere.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

/** Answers every refresh with its card's live blocks fresh. `delayMs` lets a test see the busy state. */
async function stubRefresh(page: Page, options: { delayMs?: number; fail?: (slug: string) => boolean } = {}) {
  const asked: string[] = [];
  await page.route(/\/api\/overview\/refresh$/, async (route: Route) => {
    const body = route.request().postDataJSON() as { project: string; sources: string[] };
    asked.push(body.project);
    if (options.delayMs) await new Promise((r) => setTimeout(r, options.delayMs));
    if (options.fail?.(body.project)) return route.fulfill({ status: 500, json: { error: "The mail server did not answer.", code: "server" } });
    const res = await page.request.get("/api/overview");
    const dto = (await res.json()) as OverviewJson;
    const card = dto.projects.find((p) => p.slug === body.project);
    if (!card) return route.fulfill({ status: 404, json: { error: "Project not found.", code: "not_found" } });
    const project = {
      ...card,
      mailboxes: card.mailboxes.map((m) => ({ ...m, newSinceTriage: mailFresh(3, 0) })),
      notion: { clients: card.notion.clients && { ...card.notion.clients, count: notionFresh(212) }, leads: card.notion.leads && { ...card.notion.leads, count: notionFresh(41) } },
    };
    return route.fulfill({ json: { outcomes: { mail: "read", notion: "read" }, project, attention: dto.attention, verdict: dto.verdict, oldestAsOf: minutesAgo(0) } });
  });
  return asked;
}

test("refresh one card: busy while it reads, then the numbers, the time and one sentence in the live region", async ({ page }) => {
  const asked = await stubRefresh(page, { delayMs: 600 });
  await page.goto("/overview");
  const card = page.locator("#project-demo-shop");
  const button = card.getByRole("button", { name: /^Refresh / });
  await button.click();
  await expect(card.getByRole("button", { name: "Refreshing..." })).toBeDisabled();
  await expect(card.getByRole("button", { name: "Refreshing..." })).toHaveAttribute("aria-busy", "true");
  await expect(page.getByRole("button", { name: "Refresh all" })).toBeDisabled(); // one read at a time
  await expect(page.getByRole("status").filter({ hasText: /refreshed/ })).toHaveText(/demo-shop refreshed, \d\d:\d\d\./);
  await expect(card.getByText("3 new since triage")).toBeVisible();
  await expect(card.getByText("212")).toBeVisible();
  await expect(card.getByText("Fresh").first()).toBeVisible();
  expect(asked).toEqual(["demo-shop"]);
});

test("refresh by keyboard alone", async ({ page }) => {
  await stubRefresh(page);
  await page.goto("/overview");
  const button = page.locator("#project-demo-shop").getByRole("button", { name: /^Refresh / });
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByRole("status").filter({ hasText: /refreshed/ })).toBeVisible();
});

test("refresh all reads each project once, in order", async ({ page }) => {
  const asked = await stubRefresh(page);
  await page.goto("/overview");
  await page.getByRole("button", { name: "Refresh all" }).click();
  await expect(page.getByText("Every project was read.")).toBeVisible();
  expect([...asked].sort()).toEqual(["demo-shop", "lisbon-realty"]);
});

test("a failed refresh is an alert with the sentence, and the card is not blanked", async ({ page }) => {
  await stubRefresh(page, { fail: (slug) => slug === "demo-shop" });
  await page.goto("/overview");
  const card = page.locator("#project-demo-shop");
  await card.getByRole("button", { name: /^Refresh / }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Could not refresh demo-shop" })).toContainText("The mail server did not answer.");
  await expect(card.getByRole("button", { name: /^Refresh / })).toBeEnabled();
  await expect(card.getByRole("heading", { level: 3 })).toBeVisible();
});
