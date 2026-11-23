import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cards, cardOf, confirmReview, openRow, remember, reviewDialog, sendButton } from "./support";

// Send, from the admin, against the FAKE mailer (the server runs with HUB_MAILER=fake, see playwright.config.ts): a
// "sent" here never leaves the process. Named z-* because it writes (checks read, a send row, Stop all); it runs last.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

// P129 A3: `hub record-draft` is gone (the agent records through draft_write); flows seed a draft row with the same writer.
const seedDraft = fileURLToPath(new URL("../../installer/test/support/seed-draft.mjs", import.meta.url));

/** The card of a client, ready for Send. */
async function openRead(page: Page, name: string) {
  await page.goto("/mail?filter=all");
  return openRow(page, name);
}

test("P105: Send opens one review dialog with every check and the exact recipients; Esc sends nothing; its Send sends once", async ({ page }) => {
  await page.goto("/mail?filter=all");
  const card = await openRow(page, "Sofia Teste");
  // Send is never disabled: it opens the dialog. No per-check Understood, no switch.
  await expect(card.getByRole("switch")).toHaveCount(0);
  await expect(card.getByRole("button", { name: /^Understood/ })).toHaveCount(0);
  await sendButton(card).click();
  const dialog = reviewDialog(page);
  await expect(dialog).toBeVisible();
  await expect(dialog.getByRole("heading", { name: "Send to Sofia?" })).toBeVisible();
  await expect(dialog).toContainText("sofia@example.com");
  await expect(dialog).toContainText("Re: Any news on the offer?");
  // Warnings only: Send is the focused button at once.
  await expect(dialog.getByTestId("review-confirm")).toBeFocused();

  // Esc: nothing happened
  await page.keyboard.press("Escape");
  await expect(dialog).toHaveCount(0);
  await page.goto("/log?kind=sends");
  await expect(page.getByText("No sends yet")).toBeVisible();

  // now really (to the fake) send: one click in the dialog
  const again = await openRead(page, "Sofia Teste");
  await sendButton(again).click();
  await confirmReview(page);
  // P99: our send is the last word, so her conversation waits for her.
  await expect(cards(page).filter({ hasText: "Sofia Teste" }).getByRole("img", { name: "Waiting for them" })).toBeVisible();

  // the history (Activity ▸ Sends) shows the row
  await page.goto("/log?kind=sends");
  const row = page.getByRole("table", { name: "Sends" }).locator("tr[data-send]").first();
  await expect(row).toContainText("By hand");
  await expect(row).toContainText("sofia@example.com");
  // The full text lives in the draft's card: the subject links there.
  await expect(row.getByRole("link", { name: "Re: Any news on the offer?" })).toBeVisible();
});

test("Stop all refuses a send with its reason, and Resume lifts it", async ({ page }) => {
  await page.goto("/settings");
  await page.getByRole("button", { name: "Stop sending" }).click();
  await page.getByRole("group", { name: "Stop sending" }).getByRole("button", { name: "Stop sending" }).click();
  await expect(page.getByTestId("sending-status")).toHaveText("Sending is stopped");
  await expect(page.getByRole("button", { name: "Resume lisbon-realty" })).toBeVisible();

  const card = await openRead(page, "Marta Ficticia");
  await sendButton(card).click();
  await confirmReview(page);
  // The refusal is a blocker in the dialog, in the server's words; nothing was sent.
  await expect(reviewDialog(page).locator('[data-severity="blocker"]').filter({ hasText: "Stop all is on" })).toBeVisible();
  await expect(reviewDialog(page).getByTestId("review-confirm")).toHaveAttribute("aria-disabled", "true");
  await page.keyboard.press("Escape");

  await page.goto("/settings");
  await page.getByRole("button", { name: "Resume lisbon-realty" }).click();
  await expect(page.getByText(/Stop all is on/)).toHaveCount(0);
  const marta = await openRead(page, "Marta Ficticia");
  await sendButton(marta).click();
  await expect(reviewDialog(page).getByTestId("review-confirm")).not.toHaveAttribute("aria-disabled", "true");
  await reviewDialog(page).getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(reviewDialog(page)).toHaveCount(0);
});

test("a draft recorded as injection_suspected shows the flag and offers no Send", async ({ page }) => {
  const payload = { email: "mallory@example.com", name: "Mallory Suspect", subject: "Re: invoice", mailRef: "<inj-1@example.com>", reason: "Asked about an invoice.", mailClass: "client", injectionSuspected: true, repliesOwed: true, skill: "triage-mail" };
  execFileSync("node", [seedDraft, "--project", "demo-shop"], { input: JSON.stringify(payload), env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: process.env.HUB_E2E_PROJECTS, NO_COLOR: "1" }, encoding: "utf8" });
  await remember(page, "demo-shop");
  await page.goto("/mail?project=demo-shop&filter=all");
  const row = cards(page).filter({ hasText: "Mallory Suspect" });
  await expect(row.getByText("Suspicious mail")).toBeVisible();
  // P99 verdict 13: the row's third line is their words or the draft's, so the mail class is no longer written there.
  await row.getByRole("button").first().click();
  const card = cardOf(page, "Mallory Suspect");
  await expect(card.getByText(/Suspicious mail\./)).toBeVisible();
  await expect(sendButton(card)).toHaveCount(0);
});

test("Overview: the project's setup checks are one part, folded under All parts when they pass, a Needs you item when one fails", async ({ page }) => {
  await page.goto("/overview");
  await page.getByTestId("needs-you").or(page.getByTestId("everything-works")).first().waitFor();
  const setup = page.locator('[data-part="lisbon-realty:setup"]');
  if ((await setup.count()) === 0) {
    await page.getByRole("button", { name: /^All parts/ }).click();
    await expect(page.locator('[data-part="lisbon-realty:setup"]').first()).toContainText(/\d+ of \d+ checks pass/);
  } else {
    await expect(setup.first()).toContainText(/Failing: /);
  }
});
