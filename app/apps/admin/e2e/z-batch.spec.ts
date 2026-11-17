import { expect, test, type Page } from "@playwright/test";
import { readTheChecks, remember } from "./support";

// Named z-* so it runs after smoke.spec.ts: these flows create a batch, which changes the Drafts counts
// the smoke flows assert on (one worker, one seeded database).
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

/**
 * Creates a batch from the screen (a brief, no text to copy), then plays the agent through the API its gate uses: one draft
 * written for the selected client, then the batch is closed. A batch never fills a body itself (P28 C5).
 */
async function createBatch(page: Page, who?: string) {
  await page.goto("/drafts?new=1");
  await expect(page.getByRole("heading", { name: "New batch" })).toBeVisible();
  // Keep it small: one client with no open draft (an earlier batch gives its clients an open draft).
  await page.getByRole("button", { name: "None", exact: true }).click();
  const box = who ? page.getByRole("checkbox", { name: `Include ${who}` }) : page.locator('[data-slot="checkbox"]:not([data-disabled])').first();
  await box.click();
  await expect(page.getByText(/^1 of \d+ selected$/)).toBeVisible();
  await expect(page.getByRole("button", { name: "Create batch" })).toBeDisabled(); // no brief yet
  await page.getByLabel("What should the agent say, and how?").fill("Check in about the open question: short and warm.");
  const name = (await page.getByTestId("brief-preview").getAttribute("data-first")) ?? "";
  await page.getByRole("button", { name: "Create batch" }).click();
  await expect(page).toHaveURL(/\/drafts\?.*batch=\d+/);
  await expect(page.getByText(/Waiting for the agent/).first()).toBeVisible();
  // State 16: with no draft yet, the pane (beside the list from 1024 px) says where the batch stands and offers no button.
  if ((page.viewportSize()?.width ?? 0) >= 1024) {
    const pane = page.getByTestId("batch-waiting");
    await expect(pane).toBeVisible();
    await expect(pane.getByRole("button")).toHaveCount(0);
  }
  const id = Number(new URL(page.url()).searchParams.get("batch"));

  const project = "lisbon-realty";
  const audience = (await (await page.request.get(`${API()}/api/bulk/audience?project=${project}&audience=all`)).json()) as { clients: { id: number; name: string }[] };
  const client = audience.clients.find((c) => c.name === name);
  expect(client, `the audience lists ${name}`).toBeTruthy();
  const first = name.split(" ")[0] ?? name;
  const add = await page.request.post(`${API()}/api/batches/${id}/drafts`, { data: { project, clientId: client?.id, subject: `Checking in, ${first}`, body: `Hi ${first},\n\nIt has been a while. Is there anything I can help with?\n\nBest regards`, reason: "Silent for a while." } });
  expect(add.ok()).toBe(true);
  expect((await page.request.post(`${API()}/api/batches/${id}/close`, { data: { project, status: "ready" } })).ok()).toBe(true);
  await page.reload();
  await expect(page.getByRole("article", { name: `Draft for ${name}` })).toBeVisible();
}

test("Brief batch, drafts written by the agent: review, the read-the-checks gate, Done and Undo", async ({ page }) => {
  await createBatch(page, "Rita Falsa");
  const sw = page.getByRole("switch", { name: "I read the checks" });
  await expect(sw).not.toBeChecked();
  await expect(page.getByText("0 of 1 finished").first()).toBeVisible();

  // Reply in Mail is gated by the switch: pressing it says why (it is aria-disabled, so the click is forced).
  await page.getByRole("button", { name: "Reply in Mail" }).click({ force: true });
  await expect(page.getByText("Turn on I read the checks").first()).toBeVisible();

  await readTheChecks(page);

  await page.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Mark done/ }).click();
  await expect(page.getByText("1 of 1 finished").first()).toBeVisible();

  await page.getByRole("button", { name: "Undo", exact: true }).click();
  await expect(page.getByText("0 of 1 finished").first()).toBeVisible();
});

test("Batch review never offers Send", async ({ page }) => {
  await createBatch(page);
  await expect(page.getByRole("button", { name: /^send/i })).toHaveCount(0);
  await expect(page.getByRole("link", { name: /^send/i })).toHaveCount(0);
  await expect(page.getByRole("button", { name: "Reply in Mail" })).toBeVisible();
});

test("The batch builder and a batch fit 360px with 44px targets", async ({ page }) => {
  await page.setViewportSize({ width: 360, height: 780 });
  for (const url of ["/drafts?new=1", "/drafts"]) {
    await page.goto(url);
    await page.waitForLoadState("networkidle");
    const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
    expect(overflow, url).toBeLessThanOrEqual(0);
  }
  await page.goto("/drafts");
  await page.getByRole("button", { name: /^Batch|All drafts/ }).first().click();
  const first = page.getByRole("menuitemradio").nth(1);
  await expect(first).toBeVisible();
  await first.click();
  await page.waitForLoadState("networkidle");
  await expect(page).toHaveURL(/batch=\d+/);
  const overflow = await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth);
  expect(overflow).toBeLessThanOrEqual(0);
  await expect(page.getByTestId("batch-head")).toBeVisible();
});
