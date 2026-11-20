import { expect, test } from "@playwright/test";
import { writeSendPolicy } from "./send-policy";
import { cards, cardOf, remember } from "./support";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Named z-* because it adds a draft to the seeded database, which changes the counts the smoke flows assert on.
// It goes through the real `hub record-draft` (decision 0009): the row must show up in the admin with no sync.
const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
// record-draft loads the project (project.md) and its send policy (recipients), so the project needs a folder: a copy of the
// projects fixture, and recipients = any in the send policy of the instance the command runs in (P49 S11: the server's file).
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-proj-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, "demo-shop"), { recursive: true });
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", "demo-shop");
const record = (project: string, payload: object) =>
  JSON.parse(
    execFileSync("node", [hub, "record-draft", "--project", project], { input: JSON.stringify(payload), env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, NO_COLOR: "1" }, encoding: "utf8" }),
  ) as { ok: boolean; action: string; draftId: number };

test("a draft recorded by the CLI shows on the Drafts screen, once, with an Open the client's mail link", async ({ page }) => {
  const draft = { email: "newcomer@example.com", name: "Nora Newcomer", subject: "Re: your quote", mailRef: "<quote-1@example.com>", reason: "She asked for a quote.", repliesOwed: true, skill: "triage-mail" };
  expect(record("demo-shop", draft)).toMatchObject({ ok: true, action: "created" });
  expect(record("demo-shop", draft)).toMatchObject({ ok: true, action: "updated" });

  await remember(page, "demo-shop");
  await page.goto("/mail?filter=all");
  const row = cards(page).filter({ hasText: "Nora Newcomer" });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Owes reply")).toBeVisible();
  await row.getByRole("button").first().click();
  const card = cardOf(page, "Nora Newcomer");
  // Mail holds no draft for it, so the link is the client's mail (P58 R1: never a dead button).
  await expect(card.getByRole("link", { name: /Open the client's mail/ })).toHaveAttribute("href", "message://%3Cquote-1%40example.com%3E");
  // The text of the mail is not stored, so there is nothing to copy. The fake Mailer holds no draft for this client, which since
  // P56 S0 (v0.12.7) is the gone line (`mail/mail-gone.tsx`), not "not stored here": the Mail draft is missing and Trash has no Hub copy.
  await expect(card.getByText(/The Mail draft was deleted|The text of this mail is not stored here|Mail could not be read/)).toBeVisible();
  await expect(card.getByRole("button", { name: /Reply in Mail/ })).toHaveCount(0);

  // Mail holds no draft for it, so the text cannot be judged: there is no Checked switch (P27 M3.1), but Done (handled in Mail) works.
  await expect(page.getByRole("switch", { name: "I read the checks" })).toHaveCount(0);
  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Mark done/ }).click();
  await expect(row.getByRole("img", { name: "Done" })).toBeVisible();
});
