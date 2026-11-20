import { expect, test, type Page } from "@playwright/test";
import { openRow, readTheChecks, remember, sendButton } from "./support";

// The send keys (decision 0013): Shift+Enter reads Mail and shows the confirmation, Shift+Enter again sends what was shown, Enter on the
// focused Send button does the same as a click (the preview, never a send), Esc cancels the confirmation. The real send call is
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

/** Puts the draft back as it was found, through the API the switch uses (the card may no longer show the switch after a failed send). */
async function untick(page: Page) {
  const api = `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;
  const list = (await (await page.request.get(`${api}/api/drafts?project=lisbon-realty&filter=all`)).json()) as { drafts: { id: number; checked: boolean; client: { name: string } }[] };
  const d = list.drafts.find((x) => x.client.name === "Sofia Teste");
  if (d?.checked) expect((await page.request.post(`${api}/api/drafts/${d.id}/checked`, { data: { project: "lisbon-realty", checked: false } })).ok()).toBe(true);
}

async function readyCard(page: Page) {
  await page.goto("/mail?filter=all");
  const card = await openRow(page, "Sofia Teste");
  await readTheChecks(page);
  return card;
}

test("Shift+Enter shows the confirmation, Esc cancels it, and nothing was sent", async ({ page }) => {
  const calls = watchSends(page);
  const card = await readyCard(page);
  await page.locator("#main").focus();
  await page.keyboard.press("Shift+Enter");
  const confirm = card.getByRole("button", { name: "Send to Sofia" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeFocused();
  await expect(card.getByRole("status").filter({ hasText: /To sofia@example\.com/ })).toBeVisible();
  await page.keyboard.press("Escape");
  await expect(confirm).toHaveCount(0);
  await expect(sendButton(card)).toBeVisible();
  expect(calls).toEqual([{ apply: false }]);
  await untick(page);
});

test("Enter on the focused Send button opens the confirmation and sends nothing; Shift+Enter then sends what was shown", async ({ page }) => {
  const calls = watchSends(page);
  const card = await readyCard(page);
  await sendButton(card).focus();
  await page.keyboard.press("Enter");
  const confirm = card.getByRole("button", { name: "Send to Sofia" });
  await expect(confirm).toBeVisible();
  expect(calls).toEqual([{ apply: false }]);
  await page.waitForTimeout(500); // past the dwell (CONFIRM_DWELL_MS), so the key is a real confirmation
  await page.keyboard.press("Shift+Enter");
  await expect.poll(() => calls.length).toBe(2);
  expect(calls[1]).toEqual({ apply: true });
  // The aborted send leaves the draft unsent, so the card is back to a retry and the tick can be lifted.
  await expect(card.getByRole("img", { name: "Sent" })).toHaveCount(0);
  await untick(page);
});

test("a second Shift+Enter right after the preview does not send; one after the dwell does", async ({ page }) => {
  const calls = watchSends(page);
  const card = await readyCard(page);
  await page.locator("#main").focus();
  await page.keyboard.press("Shift+Enter");
  await expect(card.getByRole("button", { name: "Send to Sofia" })).toBeVisible();
  await page.keyboard.press("Shift+Enter");
  await page.waitForTimeout(100);
  expect(calls).toEqual([{ apply: false }]);
  await page.waitForTimeout(500);
  await page.keyboard.press("Shift+Enter");
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
  await expect(card.getByRole("button", { name: "Send to Sofia" })).toHaveCount(0);
  await expect(sendButton(card)).toHaveCount(0);
  expect(calls).toEqual([]);
});
