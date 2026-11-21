import { expect, test, type Page } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { fileURLToPath } from "node:url";
import { cards, cardOf, openRow, readTheChecks, remember, sendButton } from "./support";

// Send, from the admin, against the FAKE mailer (the server runs with HUB_MAILER=fake, see playwright.config.ts): a
// "sent" here never leaves the process. Named z-* because it writes (checks read, a send row, Stop all); it runs last.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));

/** The card of a client with "I read the checks" on, ready for Send. */
async function openRead(page: Page, name: string) {
  await page.goto("/mail?filter=all");
  const card = await openRow(page, name);
  await readTheChecks(page);
  return card;
}

test("Send needs the checks read, shows the exact mail to confirm, can be cancelled, then sends once", async ({ page }) => {
  await page.goto("/mail?filter=all");
  const card = await openRow(page, "Sofia Teste");
  // checks not read yet: the button says why and does not act
  await expect(sendButton(card)).toHaveAttribute("aria-disabled", "true");
  await expect(card.getByText(/Turn on I read the checks|Understand the checks first/)).toBeVisible();

  await readTheChecks(page);
  await expect(sendButton(card)).not.toHaveAttribute("aria-disabled", "true");
  await sendButton(card).click();

  // the bar becomes the confirmation: the primary keeps its place, with focus, and says who gets it
  const confirm = card.getByRole("button", { name: "Send to Sofia" });
  await expect(confirm).toBeVisible();
  await expect(confirm).toBeFocused();
  // The confirm line (role status); the card's From line (P58) also names the To.
  await expect(card.getByRole("status").filter({ hasText: /To sofia@example\.com/ })).toBeVisible();
  await expect(card.getByText(/Re: Any news on the offer\?/).first()).toBeVisible();
  await expect(card.locator("pre")).toContainText("Thank you for your message");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Cancel: nothing happened
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  // The send history is Activity ▸ Sends (UX pass 2026-11-20): no send yet, so it says so.
  await page.goto("/log?filter=sends");
  await expect(page.getByText("No sends yet")).toBeVisible();

  // now really (to the fake) send
  const again = await openRead(page, "Sofia Teste");
  await sendButton(again).click();
  await again.getByRole("button", { name: "Send to Sofia" }).click();
  // P99: our send is the last word, so her conversation waits for her.
  await expect(cards(page).filter({ hasText: "Sofia Teste" }).getByRole("img", { name: "Waiting for them" })).toBeVisible();

  // the history (Activity ▸ Sends) shows the row
  await page.goto("/log?filter=sends");
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
  await expect(card.getByText("Stop all is on").first()).toBeVisible();
  await expect(card.getByRole("button", { name: "Send to Marta" })).toHaveCount(0);

  await page.goto("/settings");
  await page.getByRole("button", { name: "Resume lisbon-realty" }).click();
  await expect(page.getByText(/Stop all is on/)).toHaveCount(0);
  const marta = await openRead(page, "Marta Ficticia");
  await sendButton(marta).click();
  await expect(marta.getByRole("button", { name: "Send to Marta" })).toBeVisible();
  await marta.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("a draft recorded as injection_suspected shows the flag and offers no Send", async ({ page }) => {
  const payload = { email: "mallory@example.com", name: "Mallory Suspect", subject: "Re: invoice", mailRef: "<inj-1@example.com>", reason: "Asked about an invoice.", mailClass: "client", injectionSuspected: true, repliesOwed: true, skill: "triage-mail" };
  execFileSync("node", [hub, "record-draft", "--project", "demo-shop"], { input: JSON.stringify(payload), env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: process.env.HUB_E2E_PROJECTS, NO_COLOR: "1" }, encoding: "utf8" });
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
