import { expect, test } from "@playwright/test";
import { cards, cardOf, remember } from "./support";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";

// Named z-* because it adds a draft to the seeded database, which changes the counts the smoke flows assert on.
// It goes through the real `hub record-draft` (decision 0009): the row must show up in the admin with no sync.
const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
// record-draft loads project.md (draft.recipients), so the project needs a folder: a copy of the projects fixture with recipients = any.
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-proj-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, "demo-shop"), { recursive: true });
const pm = join(projects, "demo-shop", "project.md");
writeFileSync(pm, readFileSync(pm, "utf8").replace("| draft.recipients | test |", "| draft.recipients | any |"));
const record = (project: string, payload: object) =>
  JSON.parse(
    execFileSync("node", [hub, "record-draft", "--project", project], { input: JSON.stringify(payload), env: { ...process.env, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, NO_COLOR: "1" }, encoding: "utf8" }),
  ) as { ok: boolean; action: string; draftId: number };

test("a draft recorded by the CLI shows on the Drafts screen, once, with an Open in Mail link", async ({ page }) => {
  const draft = { email: "newcomer@example.com", name: "Nora Newcomer", subject: "Re: your quote", mailRef: "<quote-1@example.com>", reason: "She asked for a quote.", repliesOwed: true, skill: "triage-mail" };
  expect(record("demo-shop", draft)).toMatchObject({ ok: true, action: "created" });
  expect(record("demo-shop", draft)).toMatchObject({ ok: true, action: "updated" });

  await remember(page, "demo-shop");
  await page.goto("/drafts?filter=all");
  const row = cards(page).filter({ hasText: "Nora Newcomer" });
  await expect(row).toHaveCount(1);
  await expect(row.getByText("Owes reply")).toBeVisible();
  await row.getByRole("button").first().click();
  const card = cardOf(page, "Nora Newcomer");
  await expect(card.getByRole("link", { name: /Open in Mail/ })).toHaveAttribute("href", "message://%3Cquote-1%40example.com%3E");
  // The text of the mail is not stored, so there is nothing to copy.
  await expect(card.getByText(/The text of this mail is not stored here|Mail could not be read/)).toBeVisible();
  await expect(card.getByRole("button", { name: /Reply in Mail/ })).toHaveCount(0);

  // Mail holds no draft for it, so the text cannot be judged: there is no Checked switch (P27 M3.1), but Done (handled in Mail) works.
  await expect(page.getByRole("switch", { name: "I read the checks" })).toHaveCount(0);
  await card.getByRole("button", { name: "More actions" }).click();
  await page.getByRole("menuitem", { name: /^Mark done/ }).click();
  await expect(row.getByRole("img", { name: "Done" })).toBeVisible();
});
