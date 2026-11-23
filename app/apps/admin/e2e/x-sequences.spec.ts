import AxeBuilder from "@axe-core/playwright";
import { expect, test, type Page } from "@playwright/test";
import { at, firstDraftIs, remember } from "./support";

// Follow-ups (P47 W2, read-only since P48 D1) as a View of Drafts. Seeded for lisbon-realty: Tiago enrolled and due, and the
// core's starter sequence copied into the project (playwright.config). A session enrols on the owner's phrase; the admin shows
// the enrolments and offers Stop only. One write: Stop Tiago (from a card). Nothing here enrols, drafts or sends.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const block = (p: Page) => p.getByTestId("follow-ups");
const open = async (p: Page) => {
  await p.goto(at("lisbon-realty", "/mail?filter=sequences"));
  await expect(block(p)).toBeVisible();
};
type Row = { id: number; client: { name: string }; state: string; finishReason: string | null };
const enrollments = async (p: Page, view: "due" | "active" | "finished") => ((await (await p.request.get(`/api/projects/lisbon-realty/enrollments?view=${view}`)).json()) as { enrollments: Row[] }).enrollments;

test("the Follow-ups view lists the enrolment with its step and the owner's phrase; no Enrol, no Not now", async ({ page }) => {
  await page.route(/\/api\/projects\/lisbon-realty\/enrollments\?view=active/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { enrollments: Record<string, unknown>[] };
    await route.fulfill({ response: res, json: { ...json, enrollments: json.enrollments.map((e) => ({ ...e, enrolledPhrase: "подготовь follow-up молчащим" })) } });
  });
  await open(page);
  const row = page.getByTestId("follow-up").filter({ hasText: "Tiago Amostra" });
  await expect(row).toContainText("step 1 of 3");
  await expect(row).toContainText("Enrolled on your words: “подготовь follow-up молчащим”");
  await expect(block(page).getByRole("button", { name: /enrol|not now|send|draft|pause|resume/i })).toHaveCount(0);
  // Stop asks in place (the admin cannot restart it); Keep leaves it running.
  await row.getByRole("button", { name: "Stop", exact: true }).click();
  await row.getByRole("button", { name: "Keep" }).click();
  expect((await enrollments(page, "active")).map((e) => e.client.name)).toContain("Tiago Amostra");
});

test("axe finds nothing on the Follow-ups view, light and dark, at 360, 768 and 1280", async ({ page }) => {
  for (const scheme of ["light", "dark"] as const) {
    for (const width of [360, 768, 1280]) {
      await page.setViewportSize({ width, height: width === 360 ? 740 : 900 });
      await page.emulateMedia({ colorScheme: scheme });
      await open(page);
      const axe = await new AxeBuilder({ page }).include('[data-testid="follow-ups"]').withTags(["wcag2a", "wcag2aa", "wcag21a", "wcag21aa", "wcag22aa"]).analyze();
      expect(axe.violations.map((v) => `${scheme} ${width}: ${v.id}: ${v.nodes.map((n) => n.target.join(" ")).join(" | ")}`)).toEqual([]);
      expect(await page.evaluate(() => document.documentElement.scrollWidth - document.documentElement.clientWidth), `${scheme} ${width}: sideways scroll`).toBeLessThanOrEqual(0);
    }
  }
});

test("loading, then an error with Retry, then the list", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/projects\/lisbon-realty\/enrollments\?view=active/, async (route) => {
    await new Promise((r) => setTimeout(r, 400));
    if (fail) await route.fulfill({ status: 500, json: { error: "The database is busy", code: "server" } });
    else await route.continue();
  });
  await page.goto(at("lisbon-realty", "/mail?filter=sequences"));
  await expect(page.getByRole("list", { name: "Loading the follow-ups" })).toBeAttached();
  const failed = page.getByTestId("follow-ups-failed");
  await expect(failed).toContainText("Could not load the follow-ups", { timeout: 10_000 });
  fail = false;
  await failed.getByRole("button", { name: "Retry" }).click();
  await expect(block(page)).toBeVisible();
});

test("Stop follow-ups from a step draft's card: the card says so, and the enrollment is finished as stopped", async ({ page }) => {
  const tiago = (await enrollments(page, "active")).find((e) => e.client.name === "Tiago Amostra");
  if (!tiago) throw new Error("the seeded enrollment for Tiago is missing");
  // The first draft of the real list is shown as a step of Tiago's real enrollment; nothing else is patched or written.
  await firstDraftIs(page, { sequence: { enrollmentId: tiago.id, sequence: "answered-enquiry-no-reply", step: 1, steps: 3, state: "active" } });
  await page.goto(at("lisbon-realty", "/mail?filter=all"));
  await page.locator('ul[aria-label="People"] > li').first().getByRole("button").first().click();
  const card = page.getByRole("article");
  await expect(card.getByTestId("follow-up-step")).toContainText("Follow-up 1 of 3");
  // a step is sent from Mail: no Send on its card, and Open the draft in Mail is the one primary
  await expect(card.getByRole("button", { name: "Send", exact: true })).toHaveCount(0);
  await expect(page.locator('[data-pane="detail"] [data-variant="primary"]')).toHaveText(/Open the draft in Mail|Open their message|Copy subject/);
  await card.getByRole("button", { name: "Stop follow-ups" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Follow-ups stopped for" })).toBeVisible();
  expect((await enrollments(page, "finished")).find((e) => e.id === tiago.id)).toMatchObject({ state: "finished", finishReason: "stopped" });
});
