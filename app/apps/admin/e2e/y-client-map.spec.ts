import { expect, test } from "@playwright/test";
import AxeBuilder from "@axe-core/playwright";
import { at, remember } from "./support";

// P135 K4: the client map in the conversation header. The seed gives Anna (demo-shop) two versions and nobody else a map. Read
// only: nothing here writes (named y-*). Scenarios: `client map: drawn`, `client map: previous`, `client map: empty`,
// `client map: keyboard`, `client map: narrow`, `client map: axe`. The error state is QueryView's (`ui-specifications.md` rule 1).

const SHOP = "demo-shop";
const ANNA = at(SHOP, "/mail/c/anna%40example.com?filter=all");

test.beforeEach(async ({ page }) => remember(page, SHOP));

test("client map: drawn, with the Updated line, the outline and its states in words", async ({ page }) => {
  await page.goto(ANNA);
  await page.getByTestId("client-map-button").locator("visible=true").first().click();
  const sheet = page.getByTestId("client-map-sheet");
  await expect(sheet.getByRole("heading", { name: "Client map" })).toBeVisible();
  await expect(sheet.getByTestId("client-map-updated")).toContainText("Updated");
  await expect(sheet.getByTestId("client-map-drawing")).toHaveAttribute("data-phase", "drawn");
  await expect(sheet.locator("svg[role=img]")).toBeVisible();
  const outline = sheet.getByTestId("client-map-outline");
  await expect(outline).toContainText("Anna Fake");
  await expect(outline).toContainText("Express shipping booked (Done)");
  await expect(outline).toContainText("Size L restock asked (Open)");
});

test("client map: previous, the switch shows the version before", async ({ page }) => {
  await page.goto(ANNA);
  await page.getByTestId("client-map-button").locator("visible=true").first().click();
  const sheet = page.getByTestId("client-map-sheet");
  await sheet.getByTestId("client-map-previous").click();
  await expect(sheet.getByTestId("client-map-updated")).toContainText("Previous version");
  await expect(sheet.getByTestId("client-map-outline")).toContainText("Express shipping offered (Waiting)");
  await expect(sheet.getByTestId("client-map-outline")).not.toContainText("Size L");
});

test("client map: empty, a client with no map says the agent draws one with the next reply", async ({ page }) => {
  await page.goto(at(SHOP, "/mail?filter=all"));
  const other = page.locator('ul[aria-label="People"] > li').filter({ hasNotText: "Anna Fake" }).first();
  await other.getByRole("link").first().click();
  await page.getByTestId("client-map-button").locator("visible=true").first().click();
  await expect(page.getByTestId("client-map-sheet").getByText("No map yet")).toBeVisible();
  await expect(page.getByTestId("client-map-sheet")).toContainText("The agent draws one with the next reply.");
});

test("client map: keyboard, the button opens the sheet and Escape returns focus to it", async ({ page }) => {
  await page.goto(ANNA);
  const button = page.getByTestId("client-map-button").locator("visible=true").first();
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
    const button = page.getByTestId("client-map-button").locator("visible=true").first();
    if (width < 1024) expect((await button.boundingBox())?.height ?? 0).toBeGreaterThanOrEqual(44);
    await button.click();
    await expect(page.getByTestId("client-map-drawing")).toHaveAttribute("data-phase", "drawn");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= window.innerWidth)).toBe(true);
  });
}

for (const scheme of ["light", "dark"] as const) {
  test(`client map: axe (${scheme})`, async ({ page }) => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.goto(ANNA);
    await page.getByTestId("client-map-button").locator("visible=true").first().click();
    await expect(page.getByTestId("client-map-drawing")).toHaveAttribute("data-phase", "drawn");
    const r = await new AxeBuilder({ page }).include('[data-testid="client-map-sheet"]').analyze();
    expect(r.violations.map((v) => v.id)).toEqual([]);
  });
}
