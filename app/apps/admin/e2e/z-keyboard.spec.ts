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
  await page.goto("/mail?filter=all");
  const cards = page.locator('ul[aria-label="People"] > li');
  await expect(cards.first()).toBeVisible(); // earlier z-* flows add drafts: no fixed count here

  // The skip link is the first stop and it lands on the main region.
  await page.keyboard.press("Tab");
  await expect(page.getByRole("link", { name: "Skip to content" })).toBeFocused();
  await page.keyboard.press("Enter");
  await expect(page.locator("#main")).toBeFocused();

  // Move with J: the draft under the cursor is the one open in the pane.
  const current = page.locator('ul[aria-label="People"] > li[data-open="true"]');
  // The list opens its first draft on its own (an address, so it lands after mount): wait for it before moving.
  await expect(current).toHaveCount(1);
  // The pane follows the cursor a moment after the row moves, and a key pressed before it settles is dropped. So each step waits until
  // the open row has changed and the pane shows that draft, before it asks whether that draft is on hold.
  const whoIsOpen = async () => ((await current.getByRole("checkbox").getAttribute("aria-label")) ?? "").replace(/^Select /, "");
  const next = async () => {
    const before = await whoIsOpen();
    await page.keyboard.press("j");
    await expect(current.getByRole("checkbox")).not.toHaveAttribute("aria-label", `Select ${before}`);
    await expect(page.getByRole("article", { name: `Draft for ${await whoIsOpen()}` })).toBeVisible();
  };
  await next();
  // Move on until the open one is a draft to check and finish. The list is newest first (P99) and earlier z-* flows touch rows,
  // so the second row may be one C does not open the Check on: a draft on hold (it offers Resume, not Done), one already checked
  // (C unchecks it), or a do-not-contact client's (Send is removed, there is nothing to check before sending).
  const resume = page.getByRole("button", { name: "Resume", exact: true });
  const checked = current.getByRole("img", { name: "Draft ready, checked" });
  const doNotContact = page.getByRole("note").filter({ hasText: /^Do not contact\./ });
  const notToFinish = async () => (await resume.count()) + (await checked.count()) + (await doNotContact.count()) > 0;
  for (let i = 0; i < 10 && (await notToFinish()); i++) await next();
  await expect(resume).toHaveCount(0);
  await expect(checked).toHaveCount(0);
  await expect(doNotContact).toHaveCount(0);
  const id = await current.getAttribute("id");
  expect(id).toBeTruthy();
  const row = page.locator(`#${id}`);
  // P105: C opens the review dialog in its Check mode; Enter on its Check (after the dwell) accepts the checks once.
  await page.locator("#main").focus();
  await page.keyboard.press("c");
  const confirm = page.getByTestId("review-dialog").getByTestId("review-confirm");
  await expect(confirm).toBeFocused();
  await page.waitForTimeout(450);
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("review-dialog")).toHaveCount(0);
  await page.locator("#main").focus();

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
  await expect(row.getByRole("img", { name: /^(Draft ready, checked|Draft ready)$/ })).toBeVisible();

  // Shift+Tab walks back out of the main region to the sidebar: focus is not trapped.
  await page.locator("#main").focus();
  await tabTo(page, (l) => l.includes("Activity"), "Shift+Tab", 30);
  await page.keyboard.press("Enter");
  await expect(page).toHaveURL(/\/log/);
});

test("the selection checkboxes are not Tab stops until a selection is under way", async ({ page }) => {
  await page.goto("/mail?filter=all");
  const boxes = page.locator('ul[aria-label="People"] [role="checkbox"]');
  await expect(boxes.first()).toBeVisible();
  for (const box of await boxes.all()) await expect(box).toHaveAttribute("tabindex", "-1");
});
