import { expect, test } from "@playwright/test";
import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { writeSendPolicy } from "./send-policy";
import { contextWarn, openRow, readTheChecks, remember, viewMenu } from "./support";

// P85b: Send all Checked of one batch, against the FAKE mailer (HUB_MAILER=fake: nothing leaves the process; the batch spacing is
// shortened by HUB_BATCH_SPACING_SECONDS, honoured with the fake only). Named z-* because it writes (two drafts, two send rows).
// The campaign is recorded through the real `hub record-draft`, as `bulk-drafts` does: one run (batchKey) is one batch in Drafts.
const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-batch-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, "demo-shop"), { recursive: true });
contextWarn(join(projects, "demo-shop", "project.md"));
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", "demo-shop");
const WORDS = "write to every client about the spring offer";
// P87 (finding 8): the batch is named by the agent's short English title; the owner's words are its brief.
const TITLE = "Spring offer";
const record = (email: string, name: string) =>
  JSON.parse(
    execFileSync("node", [hub, "record-draft", "--project", "demo-shop"], {
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

test("Send all Checked: one confirmation names the count and every recipient, then the server sends each Checked draft once", async ({ page }) => {
  expect(record("ana.batch@example.com", "Ana Batch")).toMatchObject({ ok: true });
  expect(record("rui.batch@example.com", "Rui Batch")).toMatchObject({ ok: true });
  await remember(page, "demo-shop");
  await page.goto("/mail?filter=all");
  await viewMenu(page).click();
  await page.getByRole("menuitemradio", { name: new RegExp(`^${TITLE}`) }).click();
  await expect(page).toHaveURL(/batch=\d+/);

  const panel = page.getByRole("region", { name: "Send all Checked" });
  await expect(panel.getByText(WORDS)).toBeVisible();
  await expect(panel.getByRole("button", { name: "Understood all warnings" })).toBeVisible();
  // Nothing Checked yet: the button says so and does not act.
  await expect(panel.getByText("No draft of this batch is Checked yet.")).toBeVisible();
  for (const name of ["Ana Batch", "Rui Batch"]) {
    await openRow(page, name);
    await readTheChecks(page);
  }
  await expect(panel.getByText(/2 Checked drafts in this batch/)).toBeVisible();

  // The dry run: the confirmation in place, with the count and every recipient; no dialog, nothing sent.
  await panel.getByRole("button", { name: "Send all Checked" }).click();
  await expect(panel.getByRole("heading", { name: /^Send 2 mails, one every \d+ s/ })).toBeVisible();
  const recipients = panel.getByRole("list", { name: "Recipients" });
  await expect(recipients).toContainText("ana.batch@example.com");
  await expect(recipients).toContainText("rui.batch@example.com");
  await expect(page.getByRole("dialog")).toHaveCount(0);
  // Cancel: nothing was sent.
  const batchUrl = page.url();
  await panel.getByRole("button", { name: "Cancel", exact: true }).click();
  await page.goto("/log?filter=sends");
  await expect(page.getByText("ana.batch@example.com")).toHaveCount(0);

  // Confirm: the run goes on the server, its progress is shown, and it ends with both sent once.
  await page.goto(batchUrl);
  await panel.getByRole("button", { name: "Send all Checked" }).click();
  await panel.getByRole("button", { name: "Send 2 mails" }).click();
  await expect(panel.getByRole("heading", { name: "Finished: 2 of 2 sent" })).toBeVisible({ timeout: 20_000 });
  await expect(panel.getByRole("list", { name: "Batch send progress" }).getByText("Sent", { exact: true })).toHaveCount(2);

  await page.goto("/log?filter=sends");
  await expect(page.getByRole("table", { name: "Sends" }).locator("tr[data-send]").filter({ hasText: "batch@example.com" })).toHaveCount(2);
});
