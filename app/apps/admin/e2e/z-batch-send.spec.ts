import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSendPolicy } from "./send-policy";
import { checkForBatch, confirmReview, openRow, remember, reviewDialog } from "./support";

// P85b: Send all Checked of one batch, against the FAKE mailer (HUB_MAILER=fake: nothing leaves the process; the batch spacing is
// shortened by HUB_BATCH_SPACING_SECONDS, honoured with the fake only). Named z-* because it writes (two drafts, two send rows).
// The campaign is recorded through draft_write's own writer (the e2e seeder), as `bulk-drafts` does: one run (batchKey) is one batch in Drafts.
// P129 A3: `hub record-draft` is gone (the agent records through draft_write); flows seed a draft row with the same writer.
const seedDraft = fileURLToPath(new URL("../../installer/test/support/seed-draft.mjs", import.meta.url));
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-batch-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, "demo-shop"), { recursive: true });
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", "demo-shop");
const WORDS = "write to every client about the spring offer";
// P87 (finding 8): the batch is named by the agent's short English title; the owner's words are its brief.
const TITLE = "Spring offer";
const record = (email: string, name: string) =>
  JSON.parse(
    execFileSync("node", [seedDraft, "--project", "demo-shop"], {
      input: JSON.stringify({
        email,
        name,
        subject: "Re: Spring offer",
        mailRef: `<${email.split("@")[0]}-last@example.com>`,
        skill: "bulk-drafts",
        ownerRequest: WORDS,
        excerpt: `Hello ${name}, the spring offer starts on Monday.`,
        notion: { kind: "none" },
        context: { batchKey: "e2e-batch-send", batchTitle: TITLE, purpose: "spring offer", thread: { found: 1, read: 1 }, profile: { read: true, state: "filled" }, facts: { queries: 0 }, anchors: ["spring offer"] },
      }),
      env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, NO_COLOR: "1" },
      encoding: "utf8",
    }),
  ) as { ok: boolean; draftId: number };

test("Send all Checked: one review dialog names the count and every recipient, then the server sends each Checked draft once", async ({ page }) => {
  expect(record("ana.batch@example.com", "Ana Batch")).toMatchObject({ ok: true });
  expect(record("rui.batch@example.com", "Rui Batch")).toMatchObject({ ok: true });
  await remember(page, "demo-shop");
  // P134 verdict 2: no batch list; a batch whose drafts wait is one line on top of Needs you, its request a link to its own list.
  await page.goto("/mail");
  const line = page.getByTestId("batch-line").filter({ hasText: new RegExp(`${TITLE}|${WORDS.slice(0, 20)}`) });
  await expect(line).toContainText("2 drafts from");
  await expect(line.getByRole("button", { name: "Review all" })).toHaveAttribute("aria-disabled", "true"); // none Checked yet
  await line.getByRole("link").click();
  await expect(page).toHaveURL(/batch=\d+/);

  const panel = page.getByRole("region", { name: "Send all Checked" });
  await expect(panel.getByText(WORDS)).toBeVisible();
  // P105: no batch-wide Understood; each draft is checked once in its review dialog.
  await expect(panel.getByRole("button", { name: "Understood all warnings" })).toHaveCount(0);
  // Nothing Checked yet: the button says so and does not act.
  await expect(panel.getByText(/^No draft of this batch is Checked yet/)).toBeVisible();
  for (const name of ["Ana Batch", "Rui Batch"]) {
    const card = await openRow(page, name);
    await checkForBatch(page, card);
  }
  await expect(panel.getByText(/2 Checked drafts in this batch/)).toBeVisible();

  // The dry run: the review dialog with the count and every recipient; nothing sent.
  await panel.getByRole("button", { name: "Send all Checked" }).click();
  const dialog = reviewDialog(page);
  await expect(dialog.getByTestId("review-confirm")).toHaveText(/Send 2 mails/);
  await expect(dialog.getByTestId("review-lead")).toContainText(/One every \d+ s/);
  const recipients = dialog.getByRole("list", { name: "Recipients" });
  await expect(recipients).toContainText("ana.batch@example.com");
  await expect(recipients).toContainText("rui.batch@example.com");
  // Cancel: nothing was sent.
  const batchUrl = page.url();
  await dialog.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/log?kind=sends");
  await expect(page.getByText("ana.batch@example.com")).toHaveCount(0);

  // Confirm: the run goes on the server, its progress is shown, and it ends with both sent once.
  await page.goto(batchUrl);
  await panel.getByRole("button", { name: "Send all Checked" }).click();
  await confirmReview(page);
  await expect(panel.getByRole("heading", { name: "Finished: 2 of 2 sent" })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("list", { name: "Batch send progress" }).getByText("Sent", { exact: true })).toHaveCount(2);

  await page.goto("/log?kind=sends");
  await expect(page.getByRole("table", { name: "Sends" }).locator("tr[data-send]").filter({ hasText: "batch@example.com" })).toHaveCount(2);
});
