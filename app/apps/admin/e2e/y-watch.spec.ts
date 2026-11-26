import { expect, test } from "@playwright/test";
import type { WatchDto } from "@hub/contract/watch";
import { at, rememberShell } from "./support";

// Populated analytical views, including the narrower content pane beside an open dock. No Telegram access or joins.
const fixture: WatchDto = {
  slug: "demo-shop", lens: { id: "fixture", title: "Market signals" }, standing: { state: "polling", reason: null, until: null }, notice: null,
  labels: { demand: "API demand" }, days: 30, spend: { monthMicroUsd: 12_000, budgetMicroUsd: 1_000_000 }, nextAnalysis: null,
  triggers: [{ trigger: "demand", triggerOther: "", moments: 2, avgIntensity: 4, strong: 2, daily: [0, 1, 1] }],
  topics: [{ topic: "Listing coverage", windows: 2 }], moods: [{ group: "sample_group", mood: "Curious" }],
  moments: [{ group: "sample_group", messageId: 12, trigger: "demand", triggerOther: "", intensity: 4, quote: "Which API covers these listings?", author: "sample_author", reactors: 2, context: "Comparing listing sources", why: "Requests API coverage", at: "2026-11-26T01:00:00Z", link: "https://t.me/sample_group/12" }],
  people: [{ author: "sample_author", moments: 2, intensitySum: 8, triggers: ["demand"], groups: ["sample_group"], lastAt: "2026-11-26T01:00:00Z" }],
  groups: [{ username: "sample_group", title: "Sample public group", access: "open", accessLine: "Readable without joining", perDay: 40, density: 5, moments: 2, costMicroUsd: 12_000, lastPolledAt: "2026-11-26T01:00:00Z", canJoin: false }],
  trend: { days: ["2026-11-24", "2026-11-25", "2026-11-26"], series: [{ trigger: "demand", counts: [0, 1, 1] }] },
};

for (const theme of ["light", "dark"]) {
  test(`P162 Watch: populated views and keyboard navigation with dock open (${theme})`, async ({ page, context }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await rememberShell(context, "dock-open.w-480.bp-xl");
    await page.addInitScript((value) => localStorage.setItem("hub-theme", value), theme);
    await page.route("**/api/projects/demo-shop/watch?*", (r) => r.fulfill({ json: fixture }));
    await page.goto(at("demo-shop", "/watch"));
    await expect(page.getByTestId("watch-standing")).toContainText("Market signals");
    await expect(page.getByRole("complementary", { name: "Terminal" })).toBeVisible();
    const primary = page.getByRole("radiogroup", { name: "Watch views" });
    await expect(primary.getByRole("radio")).toHaveText(["Signals", "Moments", "Groups"]);
    for (const [label, view, content] of [
      ["Topics", "topics", "Listing coverage"], ["People", "people", "sample_author"], ["Trend", "trend", "Moments per day"],
      ["Groups", "groups", "Readable without joining"], ["Moments", "moments", "Which API covers these listings?"], ["Signals", "triggers", "Avg intensity"],
    ]) {
      await page.getByRole("button", { name: /^Analysis:/ }).focus();
      await page.keyboard.press("Enter");
      const option = page.getByRole("menuitemradio", { name: label, exact: true });
      await option.focus();
      await page.keyboard.press("Enter");
      await expect(page.locator("main")).toContainText(content!);
      if (view !== "triggers") await expect(page).toHaveURL(new RegExp(`view=${view}`));
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    }
    await primary.getByRole("radio", { name: "Groups", exact: true }).click();
    await page.getByRole("link", { name: "@sample_group", exact: true }).click();
    await expect(page).toHaveURL(/view=moments.*group=sample_group/);
    await page.reload();
    await expect(page.locator("main")).toContainText("Which API covers these listings?");
    await expect(page.getByRole("button", { name: "Join", exact: true })).toHaveCount(0);
    await page.screenshot({ path: test.info().outputPath(`watch-populated-${theme}.png`), fullPage: true });
  });
}
