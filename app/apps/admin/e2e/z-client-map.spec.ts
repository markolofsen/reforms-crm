import { expect, test, type Page } from "@playwright/test";
import { at, remember } from "./support";

// P136 verdicts 7a and 7d: the map's two dock phrases. Correct puts "redraw the map of <client>: " into the agent's dock and Draw
// map (a client with none) its request, both without Enter: the fake shell echoes "> <line>" only after Enter, so nothing runs
// and nothing is sent. Named z-* because it starts a terminal session (ended at the end). Scenarios: `client map: correct`,
// `client map: draw`.
test.describe.configure({ mode: "serial" });

const SHOP = "demo-shop";
const screenText = (page: Page) =>
  page.getByRole("tabpanel").locator(".xterm-rows").evaluate((el) => [...el.children].map((r) => (r.textContent ?? "").replace(/ /g, " ")).join(""));

async function endAll(page: Page) {
  const res = await page.request.get("/api/terminal");
  for (const s of ((await res.json()) as { sessions: { id: string }[] }).sessions) await page.request.delete(`/api/terminal/sessions/${encodeURIComponent(s.id)}`);
}

test.beforeEach(async ({ page }) => remember(page, SHOP));
test.afterAll(async ({ request }) => {
  const res = await request.get("/api/terminal");
  for (const s of ((await res.json()) as { sessions: { id: string }[] }).sessions) await request.delete(`/api/terminal/sessions/${encodeURIComponent(s.id)}`);
});

test("client map: correct, the request is pasted into the dock for the owner to finish, never entered", async ({ page }) => {
  await endAll(page);
  await page.goto(at(SHOP, "/mail/c/anna%40example.com?filter=all"));
  await page.getByTestId("client-map-button").locator("visible=true").first().click();
  await page.getByTestId("client-map-correct").click();
  await expect(page.getByTestId("client-map-sheet")).toBeHidden();
  await expect.poll(() => screenText(page), { timeout: 20_000 }).toContain("redraw the map of Anna Fake <anna@example.com>:");
  expect(await screenText(page)).not.toContain("> redraw the map");
  await endAll(page);
});

test("client map: draw, a client with no map asks the dock agent to draw one, never entered", async ({ page }) => {
  await endAll(page);
  await page.goto(at(SHOP, "/mail?filter=all"));
  await page.locator('ul[aria-label="People"] > li').filter({ hasNotText: "Anna Fake" }).first().getByRole("link").first().click();
  await page.getByTestId("client-map-draw").locator("visible=true").first().click();
  await expect.poll(() => screenText(page), { timeout: 20_000 }).toContain("draw the map of");
  expect(await screenText(page)).not.toContain("> draw the map");
  await endAll(page);
});
