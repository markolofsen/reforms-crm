import { expect, test, type Page } from "@playwright/test";
import { remember } from "./support";

// The review screen with the keyboard alone (rules: accessibility 3, ui-specifications 5): no mouse call anywhere.
// Named z-* because it finishes a draft.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

/** Tab until the focused element matches, giving up after `max` presses. Focus must never be trapped. */
async function tabTo(page: Page, match: (label: string) => boolean, key = "Tab", max = 80) {
  for (let i = 0; i < max; i++) {
    await page.keyboard.press(key);
    const label = await page.evaluate(() => {
      const el = document.activeElement;
      return el ? `${el.getAttribute("aria-label") ?? ""}|${el.textContent ?? ""}` : "";
    });
    if (match(label)) return;
  }
  throw new Error("focus never reached the target: the Tab order is broken or trapped");
}

test("keyboard only: reach the list, move, read the checks, finish, undo", async ({ page }) => {
  await page.goto("/drafts?filter=all");
  const cards = page.locator('ul[aria-label="Drafts"] > li');
  await expect(cards.first()).toBeVisible(); // earlier z-* flows add drafts: no fixed count here

  // The skip link is the first stop and it lands on the main region.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  // Move with J: the draft under the cursor is the one open in the pane.
  const current = page.locator('ul[aria-label="Drafts"] > li[data-open="true"]');
  // The list opens its first draft on its own (an address, so it lands after mount): wait for it before moving.
  await expect(current).toHaveCount(1);
  await page.keyboard.press("j");
  // A draft on hold offers Resume, not Done: move on until the open one is a draft to finish.
  for (let i = 0; i < 10 && (await page.getByRole("button", { name: "Resume", exact: true }).count()) > 0; i++) {
    await page.keyboard.press("j");
    await page.waitForTimeout(150);
  }
  await expect(page.getByRole("button", { name: "Resume", exact: true })).toHaveCount(0);
  const id = await current.getAttribute("id");
  expect(id).toBeTruthy();
  const row = page.locator(`#${id}`);
  const sw = page.getByRole("switch", { name: "I read the checks" });
  await expect(sw).toBeVisible();

  // Understand whatever checks the draft carries (focus each, Space), then turn the switch on with C.
  for (const button of await page.getByRole("button", { name: /^Understood:/ }).all()) {
    await button.focus();
    await page.keyboard.press("Space");
    await expect(button).toHaveAttribute("aria-pressed", "true");
  }
  await page.locator("#main").focus();
  await page.keyboard.press("c");
  await expect(sw).toBeChecked();

  // Done with D (the cursor moves on), back with K, then Undo with U.
  await page.keyboard.press("d");
  await expect(row.getByRole("img", { name: "Done" })).toBeVisible();
  // The Done row sinks to the bottom of the list: walk the cursor (J, then K) until it is on it, then Undo.
  for (const key of ["j", "k"]) {
    for (let i = 0; i < 30 && (await row.getAttribute("data-open")) !== "true"; i++) {
      await page.keyboard.press(key);
      // the cursor is an address now (router.replace): let the move land before reading it
      await page.waitForTimeout(120);
    }
  }
  await expect(row).toHaveAttribute("data-open", "true");
  await page.keyboard.press("u");
  await expect(row.getByRole("img", { name: /^(Ready to send|To review)$/ })).toBeVisible();

  // Shift+Tab walks back out of the main region to the sidebar: focus is not trapped.
  await page.locator("#main").focus();
  await tabTo(page, (l) => l.includes("Activity"), "Shift+Tab", 30);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/log/);
});
