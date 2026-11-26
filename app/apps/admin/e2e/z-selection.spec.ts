import { expect, test } from "@playwright/test";
import { at, remember } from "./support";

// A bulk Skip or Hold says one thing for all of them, and its Undo puts every draft back (P29 W7). Named z-* because it
// writes; Anna and Oskar (demo-shop) are touched by no other flow, and the Undo leaves both exactly as they were.
test.beforeEach(async ({ page }) => {
  await remember(page, "demo-shop");
});

// P99: a row is a person; with its one draft skipped the conversation's word is Done, with it held On hold.
for (const [verb, done, icon] of [["Skip", "Skipped 2", "Done"], ["Hold", "Held 2", "On hold"]] as const) {
  test(`${verb} on two selected drafts raises one toast with Undo, and Undo restores both`, async ({ page }) => {
    await page.goto(at("demo-shop", "/mail?filter=all"));
    const rows = page.locator('ul[aria-label="People"] > li');
    const anna = rows.filter({ hasText: "Anna Fake" });
    const oskar = rows.filter({ hasText: "Oskar Muster" });
    await expect(anna).toHaveCount(1);
    const before = { anna: await anna.getByRole("img").first().getAttribute("aria-label"), oskar: await oskar.getByRole("img").first().getAttribute("aria-label") };
    await anna.getByRole("checkbox").click();
    await oskar.getByRole("checkbox").click();
    const top = await rows.first().evaluate((e) => e.getBoundingClientRect().top);
    const bar = page.getByRole("toolbar", { name: "Selected drafts" });
    // The count is said once, in a live region that was there before the selection (P48 W4), and the rows did not move.
    await expect(page.getByTestId("list-header").getByRole("status")).toHaveText("2 selected");
    expect(await rows.first().evaluate((e) => e.getBoundingClientRect().top)).toBe(top);
    await bar.getByRole("button", { name: "More actions", exact: true }).click();
    await page.getByRole("menuitem", { name: verb, exact: true }).click();

    await expect(page.getByText(done, { exact: true })).toBeVisible();
    await expect(page.getByRole("toolbar", { name: "Selected drafts" })).toHaveCount(0);
    await expect(anna.getByRole("img", { name: icon })).toBeVisible();
    await expect(oskar.getByRole("img", { name: icon })).toBeVisible();

    await page.getByRole("button", { name: "Undo", exact: true }).click();
    await expect(anna.getByRole("img", { name: before.anna ?? "" })).toBeVisible();
    await expect(oskar.getByRole("img", { name: before.oskar ?? "" })).toBeVisible();
  });
}
