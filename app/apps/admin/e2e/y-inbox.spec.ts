import { expect, test } from "@playwright/test";
import { address, cards, remember } from "./support";

// The queue above the drafts: the health strip (only when the setup limits what a draft can do), the Inbox of what the agent
// touched in its triage (seeded: two clients left to the owner, one skipped), and the Thin basis chip. Reads only.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("the health strip is absent for a healthy project and speaks only when the setup limits what a draft can do", async ({ page }) => {
  const doctor = page.waitForResponse(/\/api\/project\/doctor/);
  await page.goto("/drafts");
  await doctor;
  await expect(page.getByTestId("inbox")).toBeVisible();
  await expect(page.getByTestId("health-strip")).toHaveCount(0);
  // The last triage moved into the Inbox: one step away.
  await page.getByTestId("inbox").getByRole("button", { name: /^Inbox/ }).click();
  await expect(page.getByTestId("health-triage")).toContainText(/Last triage .*ago|Last triage just now/);
});

test("a project whose sends are limited to a list says so above the queue", async ({ page }) => {
  await page.route(/\/api\/project\/doctor/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { facts: Record<string, unknown> };
    await route.fulfill({ response: res, json: { ...json, facts: { ...json.facts, recipients: "test", accounts: [] } } });
  });
  await page.goto("/drafts");
  const strip = page.getByTestId("health-strip");
  await expect(strip.getByTestId("health-recipients")).toContainText("Sends to test addresses only");
  await expect(strip.getByTestId("health-accounts")).toContainText("No Mail account");
});

test("the Inbox lists the clients left to the owner and the skipped one, with a filter", async ({ page }) => {
  await page.goto("/drafts");
  const inbox = page.getByTestId("inbox");
  await expect(inbox).toContainText(/\d+ repl(y|ies) owed/);
  await inbox.getByRole("button", { name: /^Inbox/ }).click();
  await inbox.getByRole("button", { name: /^All/ }).click();
  const rows = inbox.getByTestId("inbox-row");
  await expect(rows.filter({ hasText: "Marta Gomes" })).toBeVisible();
  await expect(rows.filter({ hasText: "Joao Pires" })).toBeVisible();
  await expect(rows.filter({ hasText: "Newsletter" })).toContainText("A mailing list, no reply needed.");
  await expect(inbox.getByRole("button", { name: /^All/ })).toHaveAttribute("aria-pressed", "true");
});

test("the Thin basis chip is a view of its own, kept in the address", async ({ page }) => {
  await page.goto("/drafts");
  await page.getByRole("radio", { name: /^Thin basis/ }).click();
  await expect.poll(() => address(page)).toContain("filter=thin_basis");
  await expect(cards(page).or(page.getByText(/No draft with a thin basis/)).first()).toBeVisible();
});

test("the Inbox says when it could not load and offers Retry", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/inbox\?/, (route) => (fail ? route.fulfill({ status: 500, json: { error: "The inbox is unavailable.", code: "server" } }) : route.fallback()));
  await page.goto("/drafts");
  await expect(page.getByText("Could not load the inbox")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).first().click();
  await expect(page.getByTestId("inbox")).toBeVisible();
});
