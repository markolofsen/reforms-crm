import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { at, remember } from "./support";

// P135 K4, P136 Q5-Q7: the client map under the name in the conversation header. The seed gives Anna (demo-shop) two versions
// (the newer names its sources and the reason of its rename; her size question has waited 9 days) and nobody else a map. Read
// only: nothing here writes (named y-*); the dock phrases are z-client-map.spec.ts. Scenarios: `client map: summary`,
// `client map: drawn`, `client map: changes`, `client map: sources`, `client map: empty`, `client map: keyboard`,
// `client map: narrow`, `client map: axe`, `overview: stuck`. The error state is QueryView's (`ui-specifications.md` rule 1).

const SHOP = "demo-shop";
const ANNA = at(SHOP, "/mail/c/anna%40example.com?filter=all");
const mapButton = (page: import("@playwright/test").Page) => page.getByTestId("client-map-button").locator("visible=true").first();

test.beforeEach(async ({ page }) => remember(page, SHOP));

test("client map: summary, the header says the counts under the name", async ({ page }) => {
  await page.goto(ANNA);
  await expect(mapButton(page)).toHaveText(/Map · 1 waiting/);
});

test("client map: drawn, with the Updated line, the legend, the outline and its states in words", async ({ page }) => {
  await page.goto(ANNA);
  await mapButton(page).click();
  const sheet = page.getByTestId("client-map-sheet");
  await expect(sheet.getByRole("heading", { name: "Client map" })).toBeVisible();
  await expect(sheet.getByTestId("client-map-updated")).toContainText("Updated");
  await expect(sheet.getByTestId("client-map-updated")).toContainText("2 versions");
  await expect(sheet.getByTestId("client-map-legend")).toHaveText(/Open.*Waiting.*Done.*Blocked/);
  await expect(sheet.getByTestId("client-map-drawing")).toHaveAttribute("data-phase", "drawn");
  await expect(sheet.locator("svg[role=img]")).toBeVisible();
  const outline = sheet.getByTestId("client-map-outline");
  await expect(outline).toContainText("Anna Fake");
  await expect(outline).toContainText("Express shipping booked (Done)");
  await expect(outline).toContainText("Size L restock asked (Waiting)");
  await expect(sheet.getByTestId("client-map-correct")).toBeVisible();
  await expect(sheet.getByTestId("client-map-copy")).toBeVisible();
});

test("client map: changes, the sheet shows what changed since the previous version and why", async ({ page }) => {
  await page.goto(ANNA);
  await mapButton(page).click();
  const changes = page.getByTestId("client-map-sheet").getByTestId("client-map-changes");
  await expect(changes.locator('[data-change="renamed"]')).toContainText("Express shipping offered");
  await expect(changes.locator('[data-change="renamed"] del')).toHaveText("Express shipping offered");
  await expect(changes.getByTestId("client-map-why")).toContainText("she accepted the offer");
  await expect(changes.locator('[data-change="state"]')).toContainText("Waiting to Done");
});

test("client map: sources, a node's button closes the sheet and rings its messages in the thread", async ({ page }) => {
  await page.goto(ANNA);
  await mapButton(page).click();
  await page.getByTestId("client-map-sheet").getByRole("button", { name: "Show 1 source of Size L restock asked in the thread" }).click();
  await expect(page.getByTestId("client-map-sheet")).toBeHidden();
  await expect(page.getByTestId("map-marks")).toContainText("Size L restock asked");
  await page.getByTestId("map-marks").getByRole("button", { name: "Clear" }).click();
  await expect(page.getByTestId("map-marks")).toHaveCount(0);
});

test("client map: empty, a client with no map offers Draw map instead of the sheet", async ({ page }) => {
  await page.goto(at(SHOP, "/mail?filter=all"));
  const other = page.locator('ul[aria-label="People"] > li').filter({ hasNotText: "Anna Fake" }).first();
  await other.getByRole("link").first().click();
  await expect(page.getByTestId("client-map-draw").locator("visible=true").first()).toHaveText(/Draw map/);
  await expect(page.getByTestId("client-map-button")).toHaveCount(0);
});

test("client map: keyboard, the line opens the sheet and Escape returns focus to it", async ({ page }) => {
  await page.goto(ANNA);
  const button = mapButton(page);
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("client-map-sheet")).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("client-map-sheet")).toBeHidden();
  await expect(button).toBeFocused();
});

for (const width of [360, 768, 1280]) {
  test(`client map: narrow and wide (${width} px), no sideways scroll, 44 px targets below 1024 px`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto(ANNA);
    const button = mapButton(page);
    if (width < 1024) expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(page.getByTestId("client-map-drawing")).toHaveAttribute("data-phase", "drawn");
    if (width < 1024) expect((await page.getByTestId("client-map-correct").boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`client map: axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(ANNA);
    await mapButton(page).click();
    await expect(page.getByTestId("client-map-drawing")).toHaveAttribute("data-phase", "drawn");
    const r = await new AxeBuilder({ page }).include('[data-testid="client-map-sheet"]').analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
}

test("overview: stuck, Anna's size question has waited 9 days and leads into her conversation", async ({ page }) => {
  await page.goto("/");
  const stuck = page.getByTestId("where-stuck");
  await expect(stuck.getByRole("heading", { name: /Where we are stuck/ })).toBeVisible();
  const row = stuck.getByTestId("stuck-clients").locator("li").filter({ hasText: "Anna Fake" }).first();
  await expect(row).toContainText(/Waiting 9 days: Size L restock asked/);
  await row.getByRole("link", { name: "Anna Fake" }).click();
  await expect(page).toHaveURL(/\/mail\/c\//);
});
