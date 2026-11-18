import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { firstDraftIs, remember } from "./support";

// Follow-ups (P47 W2) on the Drafts screen. Seeded for lisbon-realty: Tiago enrolled and due (we wrote 25 days ago), Ines a
// candidate (our message 9 days ago), and the core's starter sequence copied into the project (playwright.config). The block
// sits collapsed under the list. Two writes, both the owner's: Enrol Ines (from the keyboard) and Stop Tiago (from a card).
// Nothing here drafts or sends.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const block = (p: Page) => p.getByTestId("follow-ups");
const open = async (p: Page) => {
  await p.goto("/drafts");
  await block(p).getByRole("button", { name: /^Follow-ups/ }).click();
  await expect(block(p).getByRole("list", { name: "Due follow-ups" })).toBeVisible();
};
type Row = { id: number; client: { name: string }; state: string; finishReason: string | null };
const enrollments = async (p: Page, view: "due" | "active" | "finished") => ((await (await p.request.get(`/api/projects/lisbon-realty/enrollments?view=${view}`)).json()) as { enrollments: Row[] }).enrollments;

test("the block lists the due step with the phrase to say, and the quiet client with Enrol and Not now", async ({ page }) => {
  await open(page);
  await expect(block(page).getByRole("button", { name: /^Follow-ups/ })).toContainText("1 due, 1 suggested");
  const due = page.getByTestId("follow-up-due");
  await expect(due).toHaveCount(1);
  await expect(due).toContainText("Tiago Amostra");
  await expect(due).toContainText("step 1 of 3");
  await expect(block(page)).toContainText("подготовь follow-up проекта lisbon-realty");
  const offered = page.getByTestId("follow-up-candidate");
  await expect(offered).toHaveCount(1);
  await expect(offered).toContainText("Ines Modelo");
  await expect(offered.getByRole("button", { name: "Enrol Ines Modelo" })).toBeVisible();
  // the owner's moves only: nothing on the block sends, drafts or pauses
  await expect(block(page).getByRole("button", { name: /send|draft|pause/i })).toHaveCount(0);
});

test("axe finds nothing on the open block, light and dark, at 360, 768 and 1280", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      await block(page).scrollIntoViewIfNeeded();
      const axe = await new AxeBuilder({ page }).include('[data-testid="follow-ups"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map((v) => `${scheme} ${width}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${scheme} ${width}: sideways scroll`).toBeLessThanOrEqual(0);
    }
  }
});

test("loading, then an error with Retry, then the block; with nothing due and nobody to suggest the block is absent", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/projects\/lisbon-realty\/enrollments\?view=due/, async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    if (fail) await route.fulfill({ status: 500, json: { error: "The database is busy", code: "server" } });
    else await route.continue();
  });
  await page.goto("/drafts");
  await expect(page.getByRole("status").filter({ hasText: "Loading the follow-ups" })).toBeAttached();
  const failed = page.getByTestId("follow-ups-failed");
  await expect(failed).toContainText("Could not load the follow-ups", { timeout: 10_000 });
  fail = false;
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(block(page)).toBeVisible();

  await page.unroute(/\/api\/projects\/lisbon-realty\/enrollments\?view=due/);
  await page.route(/\/api\/projects\/lisbon-realty\/enrollments\?view=due/, (route) => route.fulfill({ json: { enrollments: [], counts: { due: 0, active: 0 } } }));
  await page.route(/\/api\/projects\/lisbon-realty\/enrollments\/candidates/, (route) => route.fulfill({ json: { candidates: [] } }));
  await page.goto("/drafts");
  await expect(page.getByTestId("not-by-email")).toBeVisible();
  await expect(block(page)).toHaveCount(0);
});

test("Enrol from the keyboard: the block says so in a live region and the client becomes due", async ({ page }) => {
  await page.goto("/drafts");
  const trigger = block(page).getByRole("button", { name: /^Follow-ups/ });
  await trigger.focus();
  await page.keyboard.press("Enter");
  const enrol = block(page).getByRole("button", { name: "Enrol Ines Modelo" });
  await expect(enrol).toBeVisible();
  await enrol.focus();
  await page.keyboard.press("Enter");
  await expect(page.getByTestId("follow-ups-said")).toHaveAttribute("role", "status");
  await expect(page.getByTestId("follow-ups-said")).toContainText("Ines Modelo enrolled in Answered enquiry, no reply");
  await expect(page.getByTestId("follow-up-candidate")).toHaveCount(0);
  expect((await enrollments(page, "active")).map((e) => e.client.name)).toContain("Ines Modelo");
});

test("Stop follow-ups from a step draft's card: the card says so, and the enrollment is finished as stopped", async ({ page }) => {
  const tiago = (await enrollments(page, "active")).find((e) => e.client.name === "Tiago Amostra");
  if (!tiago) throw new Error("the seeded enrollment for Tiago is missing");
  // The first draft of the real list is shown as a step of Tiago's real enrollment; nothing else is patched or written.
  await firstDraftIs(page, { sequence: { enrollmentId: tiago.id, sequence: "answered-enquiry-no-reply", step: 1, steps: 3, state: "active" } });
  await page.goto("/drafts?filter=all");
  await page.locator('ul[aria-label="Drafts"] > li').first().getByRole("button").first().click();
  const card = page.getByRole("article");
  await expect(card.getByTestId("follow-up-step")).toContainText("Follow-up 1 of 3");
  // a step is sent from Mail: no Send on its card, and Open in Mail is the one primary
  await expect(card.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-pane="detail"] [data-variant="primary"]')).toHaveText(/Open in Mail|Copy subject/);
  await card.getByRole("button", { name: "Stop follow-ups" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Follow-ups stopped for" })).toBeVisible();
  expect((await enrollments(page, "finished")).find((e) => e.id === tiago.id)).toMatchObject({ state: "finished", finishReason: "stopped" });
});
