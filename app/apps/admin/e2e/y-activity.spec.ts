import { expect, test, type Page } from "@playwright/test";
import type { ActivityDto } from "@hub/contract/activity";
import { address, remember } from "./support";

// Activity (P48 W5), read flows only. The e2e instance has two projects, so a scoped address names its project first
// (`/lisbon-realty/log`). The seed's first lisbon-realty session recorded several client decisions (`hub record-client`
// rows joined to its run); the expected rows are read from the server's own answer, so the spec follows the seed.
const PROJECT = "lisbon-realty";
const LOG = `/${PROJECT}/log`;
const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

test.beforeEach(async ({ page }) => {
  await remember(page, PROJECT);
});

async function activity(page: Page): Promise<ActivityDto> {
  const res = await page.request.get(`${API()}/api/activity?project=${PROJECT}`);
  expect(res.ok()).toBe(true);
  return (await res.json()) as ActivityDto;
}

/** The session with the most client decisions: the seed has one with several. */
async function busiest(page: Page) {
  const { sessions } = await activity(page);
  const decisions = (s: ActivityDto["sessions"][number]) => s.rows.filter((r) => r.outcome !== "other");
  const s = [...sessions].sort((a, b) => decisions(b).length - decisions(a).length)[0];
  expect(s && decisions(s).length).toBeGreaterThan(1);
  if (!s) throw new Error("the seed has no session");
  return { s, decisions: decisions(s) };
}

test("activity: one session is one group, with one row per decision and its reason, at 0 clicks", async ({ page }) => {
  const { s, decisions } = await busiest(page);
  await page.goto(LOG);
  const table = page.getByRole("table", { name: "Activity" });
  const group = table.locator(`tbody[data-run="${s.runId}"]`);
  await expect(group.locator("tr[data-session-head]")).toHaveCount(1);
  await expect(group.locator("tr[data-session-head]")).toContainText(`${decisions.length} decisions`);
  await expect(group.locator("tr[data-row]")).toHaveCount(s.rows.length);
  // T6: who and what is in the row the moment the screen opens; nothing hides behind a Details click.
  for (const d of decisions) {
    const r = group.locator("tr[data-row]").filter({ hasText: d.client?.name ?? d.who });
    await expect(r.first()).toBeVisible();
    if (d.why) await expect(r.first()).toContainText(d.why);
  }
  await expect(page.getByRole("button", { name: /Details/ })).toHaveCount(0);
  // Each session appears once in the table: one heading row per session.
  await expect(table.locator("tr[data-session-head]")).toHaveCount((await activity(page)).sessions.length);
});

test("activity: an unknown or zero number is never shown, in the table or in any session's detail", async ({ page }) => {
  const { sessions } = await activity(page);
  for (const s of sessions) {
    await page.goto(`${LOG}?run=${s.runId}`);
    await expect(page.getByRole("region", { name: "Session", exact: true }).getByRole("heading", { level: 3 })).toBeVisible();
    const text = await page.locator("#main").innerText();
    expect(text).not.toMatch(/(^|[^\d.])0s\b/);
    expect(text).not.toContain("$0.00");
    expect(text).not.toContain("Model unknown");
  }
});

test("activity: a session heading opens the session beside the table as sentences, and Back closes it", async ({ page }) => {
  const { s, decisions } = await busiest(page);
  await page.goto(LOG);
  await page.getByRole("table", { name: "Activity" }).locator(`tbody[data-run="${s.runId}"] tr[data-session-head]`).getByRole("link").click();
  await expect.poll(() => address(page)).toBe(`${LOG}?run=${s.runId}`);
  const detail = page.getByRole("region", { name: "Session", exact: true });
  const first = decisions[0];
  if (first) await expect(detail.getByRole("list", { name: "What happened" })).toContainText(`${first.client?.name ?? first.who}: ${first.outcome}`);
  await expect(page.getByRole("table", { name: "Activity" })).toBeVisible(); // from 1024px the table stays
  await page.goBack();
  await expect.poll(() => address(page)).toBe(LOG);
});

test("activity: the View menu counts sessions per status and narrows the table; the filter replaces the entry", async ({ page }) => {
  const { counts } = await activity(page);
  await page.goto(LOG);
  const menu = page.getByRole("button", { name: /^View: All/ });
  await expect(menu).toContainText(String(counts.all));
  await menu.click();
  await page.getByRole("menuitemradio", { name: /Failed/ }).click();
  await expect.poll(() => address(page)).toBe(`${LOG}?filter=failed`);
  await expect(page.getByRole("table", { name: "Activity" }).locator("tr[data-session-head]")).toHaveCount(counts.failed);
});

test("activity: a row that made a draft links into that draft's card", async ({ page }) => {
  await page.route(/\/api\/activity\?/, async (route) => {
    const res = await route.fetch();
    const dto = (await res.json()) as ActivityDto;
    const [s, ...rest] = dto.sessions;
    if (!s) return route.fulfill({ response: res });
    const [r, ...rows] = s.rows;
    const drafted = r && { ...r, outcome: "drafted" as const, draftId: 7, who: "Draft Person", client: { id: 99, name: "Draft Person" } };
    await route.fulfill({ response: res, json: { ...dto, sessions: [{ ...s, rows: drafted ? [drafted, ...rows] : rows }, ...rest] } });
  });
  await page.goto(LOG);
  await expect(page.getByRole("table", { name: "Activity" }).getByRole("link", { name: /Draft Person/ })).toHaveAttribute("href", `/${PROJECT}/drafts/7`);
});

test("activity: the request failing shows a sentence and Retry loads it", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/activity\?/, (route) => (fail ? route.fulfill({ status: 500, json: { error: "server error", code: "server" } }) : route.fallback()));
  await page.goto(LOG);
  await expect(page.getByText("Could not load the activity")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("table", { name: "Activity" })).toBeVisible();
});
