import { expect, test, type Page } from "@playwright/test";
import { openRow, remember, reviewDialog, sendButton } from "./support";

// A patched read (`route.fetch`, then `.json()`) can still be running for the page when a test ends; the closing context then
// disposes that answer and fails a test whose checks all passed (y-overview, P134; x-sequences, P136). Unroute first.
test.afterEach(async ({ page }) => {
  await page.unrouteAll({ behavior: "ignoreErrors" });
});

// The send keys (decision 0013; P105): Shift+Enter opens the review dialog, as does Enter on the focused Send button (never a
// send); in the dialog, Enter on its focused Send sends after the dwell; Esc closes it and nothing is called. The real send call is
// stopped in the browser, so the fake mailer is never asked and nothing is written; the Checked tick is switched back off.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

type Call = { apply: boolean };
/** Records every call to the send route; the one that would send (`apply: true`) is aborted before it leaves the browser. */
function watchSends(page: Page) {
  const calls: Call[] = [];
  void page.route(/\/api\/projects\/[^/]+\/drafts\/\d+\/send$/, async (route) => {
    const body = JSON.parse(route.request().postData() ?? "{}") as Call;
    calls.push({ apply: body.apply });
    if (body.apply) await route.abort();
    else await route.fallback();
  });
  return calls;
}

/** Puts the draft back as it was found: the dialog's Send ticks Checked before the dry run. */
async function untick(page: Page) {
  const api = `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;
  const list = (await (await page.request.get(`${api}/api/drafts?project=lisbon-realty&filter=all`)).json()) as { drafts: { id: number; checked: boolean; client: { name: string } }[] };
  const d = list.drafts.find((x) => x.client.name === "Sofia Teste");
  if (d?.checked) expect((await page.request.post(`${api}/api/drafts/${d.id}/checked`, { data: { project: "lisbon-realty", checked: false } })).ok()).toBe(true);
}

async function readyCard(page: Page) {
  await page.goto("/mail?filter=all");
  return openRow(page, "Sofia Teste");
}

test("Shift+Enter opens the review dialog, Esc closes it, and nothing was called", async ({ page }) => {
  const calls = watchSends(page);
  const card = await readyCard(page);
  await page.locator("#main").focus();
  await page.keyboard.press("Shift+Enter");
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog).toContainText("sofia@example.com");
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await expect(sendButton(card)).toBeVisible();
  expect(calls).toEqual([]);
});

test("Enter on the focused Send button opens the dialog and sends nothing; Enter on its Send then runs the dry run and the apply", async ({ page }) => {
  const calls = watchSends(page);
  const card = await readyCard(page);
  await sendButton(card).focus();
  await page.keyboard.press("Enter");
  const confirm = reviewDialog(page).getByTestId("review-confirm");
  await expect(confirm).toBeFocused();
  expect(calls).toEqual([]);
  await page.waitForTimeout(500); // past REVIEW_DWELL_MS, so the key is a real confirmation
  await page.keyboard.press("Enter");
  await expect.poll(() => calls.length).toBe(2);
  expect(calls).toEqual([{ apply: false }, { apply: true }]);
  // The aborted send leaves the draft unsent.
  await expect(card.getByRole("img", { name: "Sent" })).toHaveCount(0);
  await untick(page);
});

test("a held key right after the dialog opens does not press its Send; one after the dwell does", async ({ page }) => {
  const calls = watchSends(page);
  await readyCard(page);
  await page.locator("#main").focus();
  await page.keyboard.press("Shift+Enter");
  await expect(reviewDialog(page).getByTestId("review-confirm")).toBeFocused();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(100);
  expect(calls).toEqual([]);
  await page.waitForTimeout(500);
  await page.keyboard.press("Enter");
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual({ apply: true });
  await untick(page);
});

test("an unreadable draft cannot be sent by Shift+Enter", async ({ page }) => {
  const calls = watchSends(page);
  await page.route(/\/api\/projects\/[^/]+\/drafts\/\d+\/mail/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...((await res.json()) as Record<string, unknown>), found: false, hash: null, body: "", reason: "no draft in Mail with that subject", safetyResults: [] } });
  });
  await page.goto("/mail?filter=all");
  const card = await openRow(page, "Sofia Teste");
  await expect(card.getByText(/Mail could not be read/).first()).toBeVisible();
  await page.locator("#main").focus();
  await page.keyboard.press("Shift+Enter");
  await expect(reviewDialog(page)).toHaveCount(0);
  await expect(sendButton(card)).toHaveCount(0);
  expect(calls).toEqual([]);
});
