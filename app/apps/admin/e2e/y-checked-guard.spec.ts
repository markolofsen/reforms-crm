import { expect, test, type Page } from "@playwright/test";
import { confirmReview, mailIs, openRow, remember, reviewDialog } from "./support";

// A patched read (`route.fetch`, then `.json()`) can still be running for the page when a test ends; the closing context then
// disposes that answer and fails a test whose checks all passed (y-overview, P134; x-sequences, P136). Unroute first.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// Checked fails closed (decision 0013; P105): the review dialog and the C key refuse a draft Mail cannot show and a draft whose text
// has no hash. The Mail read is patched per test (the rest of the answer is the fake mailer's own); nothing is written.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const checkedPosts = (page: Page) => {
  const seen: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/drafts\/\d+\/checked/.test(r.url())) seen.push(r.url());
  });
  return seen;
};

test("an unreadable draft cannot be Checked: the C key says why and sends nothing", async ({ page }) => {
  await mailIs(page, (m) => ({ ...m, found: false, hash: null, body: "", reason: "no draft in Mail with that subject", safetyResults: [] }));
  const posts = checkedPosts(page);
  const reads: string[] = [];
  page.on("request", (r) => /\/drafts\/\d+\/mail/.test(r.url()) && reads.push(r.url()));
  await page.goto("/mail?filter=all");
  const card = await openRow(page, "Marta Ficticia");
  await expect(card.getByText(/Mail could not be read: no draft in Mail/).first()).toBeVisible();
  // State 12 has one quiet way on besides Open in Mail: read again (a second read of the same draft, no write).
  const before = reads.length;
  await card.getByRole("button", { name: "Read again" }).click();
  await expect.poll(() => reads.length).toBeGreaterThan(before);
  await page.locator("#main").focus();
  await page.keyboard.press("c");
  await expect(page.getByRole("status").filter({ hasText: /Mail could not be read/ })).toBeVisible();
  expect(posts).toEqual([]);
});

test("a draft whose text has no hash: its review dialog names the blocker, Check stays off, nothing is posted", async ({ page }) => {
  await mailIs(page, (m) => ({ ...m, hash: null }));
  const posts = checkedPosts(page);
  await page.goto("/mail?filter=all");
  await openRow(page, "Marta Ficticia");
  await page.locator("#main").focus();
  await page.keyboard.press("c");
  await expect(page.getByRole("status").filter({ hasText: /no hash/ })).toBeVisible();
  await expect(reviewDialog(page)).toHaveCount(0);
  expect(posts).toEqual([]);
});

test("a draft that was read and hashed is Checked through the C key's review dialog, and the tick carries the hash", async ({ page }) => {
  const bodies: string[] = [];
  page.on("request", (r) => {
    if (r.method() === "POST" && /\/api\/drafts\/\d+\/checked/.test(r.url())) bodies.push(r.postData() ?? "");
  });
  await page.goto("/mail?filter=all");
  await openRow(page, "Marta Ficticia");
  await page.locator("#main").focus();
  await page.keyboard.press("c");
  await expect(reviewDialog(page).getByRole("heading", { name: /^Check the draft for/ })).toBeVisible();
  await confirmReview(page);
  await expect(reviewDialog(page)).toHaveCount(0);
  expect(bodies).toHaveLength(1);
  expect(JSON.parse(bodies[0] ?? "{}")).toMatchObject({ checked: true, hash: expect.stringMatching(/^[0-9a-f]{64}$/) });
  // switching off is always allowed, at once
  await page.keyboard.press("c");
  await expect.poll(() => bodies.length).toBe(2);
  expect(JSON.parse(bodies[1] ?? "{}")).toMatchObject({ checked: false });
});
