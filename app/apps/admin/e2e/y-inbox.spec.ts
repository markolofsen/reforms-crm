import { expect, test } from "@playwright/test";
import { address, cards, remember } from "./support";

// The queue above the drafts: the health strip (last triage, accounts, who a draft may go to), the Inbox of what the agent
// touched in its triage (seeded: two clients left to the owner, one skipped), and the Check evidence chip. Reads only.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("the health strip says when the agent last triaged, which accounts are read and who a draft may go to", async ({ page }) => {
  await page.goto("/drafts");
  const strip = page.getByTestId("health-strip");
  await expect(strip).toBeVisible();
  await expect(strip.getByTestId("health-triage")).toContainText(/Last triage: .*ago|Last triage: just now/);
  await expect(strip.getByTestId("health-accounts")).toContainText("Mail accounts:");
  await expect(strip.getByTestId("health-recipients")).toContainText(/Sends to: (test addresses only|a fixed list|anyone)/);
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

test("the Check evidence chip is a view of its own, kept in the address", async ({ page }) => {
  await page.goto("/drafts");
  await page.getByRole("radio", { name: /Check evidence/ }).click();
  await expect.poll(() => address(page)).toContain("filter=evidence");
  await expect(cards(page).or(page.getByText(/No draft with weak evidence/)).first()).toBeVisible();
});
