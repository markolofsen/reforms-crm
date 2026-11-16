import { expect, test } from "@playwright/test";
import { openRow, remember } from "./support";

// The thread of a draft is read from Mail on demand (decision 0013, `Mailer.thread`): nothing is read until the block is
// opened, the rows come from the fake Mail's conversation (playwright.config.ts writes it), and when Mail cannot be read
// the 120-character excerpts stored with the draft are shown under a plain label. Nothing is written.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("the thread is read from Mail only when opened, newest first, the latest marked", async ({ page }) => {
  const reads: string[] = [];
  page.on("request", (r) => {
    if (/\/drafts\/\d+\/thread/.test(r.url())) reads.push(r.url());
  });
  await page.goto("/drafts?filter=all");
  const card = await openRow(page, "Marta Ficticia");
  const block = card.getByTestId("mail-thread");
  await expect(block).toBeVisible();
  expect(reads).toEqual([]);
  await block.getByRole("button", { name: /Thread/ }).click();
  const table = block.getByRole("table", { name: "Thread" });
  await expect(table).toBeVisible();
  await expect(block.getByText("Read from Mail just now")).toBeVisible();
  const rows = table.locator("tbody tr");
  await expect(rows).toHaveCount(3);
  await expect(rows.first()).toContainText("LIVE-ONLY: can we meet on Thursday to sign?");
  await expect(rows.first().getByText("Latest")).toBeVisible();
  await expect(rows.nth(1)).toContainText("we wrote");
  expect(reads).toHaveLength(1);
});

test("when Mail cannot be read the stored excerpts show under a plain label, never as the live thread", async ({ page }) => {
  await page.route(/\/drafts\/\d+\/thread/, (route) => route.fulfill({ json: { configured: true, read: false, reason: "Mail could not be read: Mail is not running", messages: [], readAt: new Date().toISOString() } }));
  await page.route(/\/api\/drafts\?/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { drafts: Array<{ client: { name: string } } & Record<string, unknown>> };
    const basedOn = { level: "ok", source: "observed", findings: [], similarTo: null, context: { thread: { found: 1, read: 1, rows: [{ date: "2026-11-01", who: "Marta", subject: "Terms", excerpt: "STORED: what are your terms for the building?" }] } } };
    await route.fulfill({ response: res, json: { ...json, drafts: json.drafts.map((d) => (d.client.name === "Marta Ficticia" ? { ...d, basedOn } : d)) } });
  });
  await page.goto("/drafts?filter=all");
  const card = await openRow(page, "Marta Ficticia");
  const block = card.getByTestId("mail-thread");
  await block.getByRole("button", { name: /Thread/ }).click();
  await expect(block.getByText(/Mail is not running/)).toBeVisible();
  await expect(block.getByText(/Stored excerpts of what the client wrote.*Not the live thread/)).toBeVisible();
  await expect(block.getByRole("table", { name: "Thread" })).toContainText("STORED: what are your terms");
  await expect(block.getByText("Read from Mail just now")).toHaveCount(0);
});
