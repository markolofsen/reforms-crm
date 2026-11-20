import { expect, test, type Page } from "@playwright/test";
import type { ActivityDto } from "@hub/contract/activity";
import { daySections, groupCells } from "../src/features/log/groups";
import { address, remember } from "./support";

// Activity (P73, decision 0037), read flows only: one timeline of what the agent decided, newest first, a heading per local
// day, no session and no detail pane. The e2e instance has two projects, so a scoped address names its project first
// (`/lisbon-realty/log`). The expected lines are computed from the server's own answer, so the spec follows the seed.
const PROJECT = "lisbon-realty";
const LOG = `/${PROJECT}/log`;
const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

test.beforeEach(async ({ page }) => {
  await remember(page, PROJECT);
});

async function activity(page: Page, query = ""): Promise<ActivityDto> {
  const res = await page.request.get(`${API()}/api/activity?project=${PROJECT}${query}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as ActivityDto;
}

test("activity: one timeline, a heading per day, one line per fold, the outcome and reason in the row, no second pane", async ({ page }) => {
  const dto = await activity(page);
  expect(dto.rows.length).toBeGreaterThan(1);
  const days = daySections(dto.rows, Date.now());
  await page.goto(LOG);
  const table = page.getByRole("table", { name: "Activity" });
  await expect(table.locator("tr[data-day-head]")).toHaveText(days.map((d) => d.label));
  await expect(table.locator("tr[data-row]")).toHaveCount(days.reduce((n, d) => n + d.groups.length, 0));
  // T6: who and what is in the row the moment the screen opens; nothing hides behind a Details click.
  for (const g of days.flatMap((d) => d.groups)) {
    const c = groupCells(g);
    const r = table.locator("tr[data-row]").filter({ hasText: c.who }).filter({ hasText: c.what });
    await expect(r.first()).toBeVisible();
    if (c.why) await expect(r.first()).toContainText(c.why);
  }
  await expect(page.getByRole("button", { name: /Details/ })).toHaveCount(0);
  // No session: no session heading, no `?run=`, no detail region beside the table.
  await expect(table.locator("tr[data-session-head]")).toHaveCount(0);
  await expect(page.getByRole("region", { name: "Session", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-slot="list-detail"]')).toHaveCount(0);
  expect(await address(page)).toBe(LOG);
});

test("activity: a folded line's count opens its entries under it", async ({ page }) => {
  // Three saves of one draft on one day, as on saas (the seed has none): one line "×3", its entries under it once opened.
  await page.route(/\/api\/activity\?/, async (route) => {
    const res = await route.fetch();
    const dto = (await res.json()) as ActivityDto;
    const [r, ...rows] = dto.rows;
    if (!r) return route.fulfill({ response: res });
    const save = (id: number, s: number) => ({ ...r, id, key: `event:${id}`, at: new Date(Date.parse(r.at) + s * 1000).toISOString(), outcome: "updated" as const, draftId: 7, client: { id: 99, name: "Fold Person" }, who: "Fold Person" });
    await route.fulfill({ response: res, json: { ...dto, rows: [save(1_000_003, 3), save(1_000_002, 2), save(1_000_001, 1), r, ...rows] } });
  });
  await page.goto(LOG);
  const table = page.getByRole("table", { name: "Activity" });
  const line = table.locator('tr[data-row][data-count="3"]');
  await expect(line).toContainText("Updated the draft");
  await line.getByRole("button", { name: /×3/ }).click();
  await expect(table.locator("tr[data-entry]")).toHaveCount(3);
});

test("activity: the View menu counts decisions by outcome (the server's) and narrows the table; the filter replaces the entry", async ({ page }) => {
  const { counts } = await activity(page);
  await page.goto(LOG);
  const menu = page.getByRole("button", { name: /^View: All/ });
  await expect(menu).toContainText(String(counts.all));
  await menu.click();
  for (const [label, n] of [["Needs you", counts.needs_you], ["Drafts", counts.drafts], ["Skipped", counts.skipped]] as const) await expect(page.getByRole("menuitemradio", { name: new RegExp(`^${label}`) })).toContainText(String(n));
  await page.getByRole("menuitemradio", { name: /^Skipped/ }).click();
  await expect.poll(() => address(page)).toBe(`${LOG}?filter=skipped`);
  const skipped = await activity(page, "&view=skipped");
  const lines = daySections(skipped.rows, Date.now()).reduce((n, d) => n + d.groups.length, 0);
  await expect(page.getByRole("table", { name: "Activity" }).locator("tr[data-row]")).toHaveCount(lines);
});

test("activity: one client's timeline says whose it is, and Show all returns", async ({ page }) => {
  const client = (await activity(page)).rows.find((r) => r.client)?.client;
  test.skip(!client, "the seed has no decision with a client row");
  if (!client) return;
  await page.goto(`${LOG}?client=${client.id}`);
  await expect(page.getByTestId("activity-client")).toContainText(`${client.name} only`);
  const rows = page.getByRole("table", { name: "Activity" }).locator("tr[data-row]");
  await expect(rows.first()).toContainText(client.name);
  await page.getByRole("button", { name: "Show all" }).click();
  await expect.poll(() => address(page)).toBe(LOG);
  await expect(page.getByTestId("activity-client")).toHaveCount(0);
});

test("activity: a row that made a draft links into that draft's card", async ({ page }) => {
  await page.route(/\/api\/activity\?/, async (route) => {
    const res = await route.fetch();
    const dto = (await res.json()) as ActivityDto;
    const [r, ...rows] = dto.rows;
    const drafted = r && { ...r, outcome: "drafted" as const, draftId: 7, who: "Draft Person", client: { id: 99, name: "Draft Person" } };
    await route.fulfill({ response: res, json: { ...dto, rows: drafted ? [drafted, ...rows] : rows } });
  });
  await page.goto(LOG);
  const link = page.getByRole("table", { name: "Activity" }).getByRole("link", { name: /Draft Person/ });
  await expect(link).toHaveAttribute("href", `/${PROJECT}/mail/7`);
  await expect(page.locator('tr[data-row][data-agent-ref="draft:7"]')).toHaveCount(1);
});

test("activity: at 360 px a row is two lines of the same table (client and what happened; when and why)", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 740 });
  await page.goto(LOG);
  const row = page.getByRole("table", { name: "Activity" }).locator("tr[data-row]").first();
  await expect(row).toBeVisible();
  const cells = await row.locator("td").evaluateAll((tds) => tds.filter((td) => getComputedStyle(td).display !== "none").length);
  expect(cells).toBe(1);
  // The one visible cell (the client's): its first child is the name (line 1, with what happened); its last child is when and why (line 2), below it.
  const twoLines = await row.locator("td:visible").first().evaluate((td) => {
    const first = td.firstElementChild?.getBoundingClientRect();
    const last = td.lastElementChild?.getBoundingClientRect();
    return !!first && !!last && last.top > first.top + first.height / 2;
  });
  expect(twoLines).toBe(true);
  expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth)).toBeLessThanOrEqual(0);
});

test("activity: the request failing shows a sentence and Retry loads it", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/activity\?/, (route) => (fail ? route.fulfill({ status: 500, json: { error: "server error", code: "server" } }) : route.fallback()));
  await page.goto(LOG);
  await expect(page.getByText("Could not load the activity")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.getByRole("table", { name: "Activity" })).toBeVisible();
});
