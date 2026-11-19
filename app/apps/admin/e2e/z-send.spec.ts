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
  await page.goto("/drafts?filter=all");
  const card = await openRow(page, name);
  await readTheChecks(page);
  return card;
}

test("Send needs the checks read, shows the exact mail to confirm, can be cancelled, then sends once", async ({ page }) => {
  await page.goto("/drafts?filter=all");
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
  await expect(card.getByText(/To sofia@example\.com/)).toBeVisible();
  await expect(card.getByText(/Re: Any news on the offer\?/).first()).toBeVisible();
  await expect(card.locator("pre")).toContainText("Thank you for your message");
  await expect(page.getByRole("dialog")).toHaveCount(0);

  // Cancel: nothing happened
  await card.getByRole("button", { name: "Cancel", exact: true }).click();
  await expect(confirm).toHaveCount(0);
  await page.goto("/project");
  await expect(page.getByTestId("project-status")).toBeVisible();
  await expect(page.getByRole("heading", { name: "Sends" })).toHaveCount(0); // no send, no Sends table

  // now really (to the fake) send
  const again = await openRead(page, "Sofia Teste");
  await sendButton(again).click();
  await again.getByRole("button", { name: "Send to Sofia" }).click();
  await expect(cards(page).filter({ hasText: "Sofia Teste" }).getByRole("img", { name: "Sent" })).toBeVisible();

  // the history shows the row with its full text
  await page.goto("/project");
  const row = page.getByRole("table", { name: "Sends" }).locator("tr[data-send]").first();
  await expect(row).toContainText("By hand");
  await expect(row).toContainText("sofia@example.com");
  // The full text lives in the draft's card: the subject links there.
  await expect(row.getByRole("link", { name: "Re: Any news on the offer?" })).toBeVisible();
});

test("Stop all refuses a send with its reason, and Resume lifts it", async ({ page }) => {
  await page.goto("/project");
  await page.getByRole("button", { name: "Stop sending" }).click();
  await page.getByRole("group", { name: "Stop sending" }).getByRole("button", { name: "Stop sending" }).click();
  await expect(page.getByTestId("project-status")).toHaveText("Sending is stopped");
  await expect(page.getByRole("button", { name: "Resume lisbon-realty" })).toBeVisible();

  const card = await openRead(page, "Marta Ficticia");
  await sendButton(card).click();
  await expect(card.getByText("Stop all is on").first()).toBeVisible();
  await expect(card.getByRole("button", { name: "Send to Marta" })).toHaveCount(0);

  await page.goto("/project");
  await page.getByRole("button", { name: "Resume lisbon-realty" }).click();
  await expect(page.getByText(/Stop all is on/)).toHaveCount(0);
  const marta = await openRead(page, "Marta Ficticia");
  await sendButton(marta).click();
  await expect(marta.getByRole("button", { name: "Send to Marta" })).toBeVisible();
  await marta.getByRole("button", { name: "Cancel", exact: true }).click();
});

test("a draft recorded as injection_suspected shows the flag and a class, and offers no Send", async ({ page }) => {
  const payload = { email: "mallory@example.com", name: "Mallory Suspect", subject: "Re: invoice", mailRef: "<inj-1@example.com>", reason: "Asked about an invoice.", mailClass: "client", injectionSuspected: true, repliesOwed: true, skill: "triage-mail" };
  execFileSync("node", [hub, "record-draft", "--project", "demo-shop"], { input: JSON.stringify(payload), env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: process.env.HUB_E2E_PROJECTS, NO_COLOR: "1" }, encoding: "utf8" });
  await remember(page, "demo-shop");
  await page.goto("/drafts?project=demo-shop&filter=all");
  const row = cards(page).filter({ hasText: "Mallory Suspect" });
  await expect(row.getByText("Suspicious mail")).toBeVisible();
  await expect(row.getByText("client", { exact: true })).toBeVisible();
  await row.getByRole("button").first().click();
  const card = cardOf(page, "Mallory Suspect");
  await expect(card.getByText(/Suspicious mail\./)).toBeVisible();
  await expect(sendButton(card)).toHaveCount(0);
});

test("Project · Setup shows the health checks of the project in one line, open on demand", async ({ page }) => {
  await page.goto("/project/setup");
  const health = page.getByRole("button", { name: /^Health/ });
  await expect(health).toContainText(/\d+ of \d+ checks pass/);
  const list = page.getByRole("list", { name: "Health checks" });
  if (!(await list.isVisible())) await health.click();
  await expect(list.getByText("project.md parses")).toBeVisible();
});
