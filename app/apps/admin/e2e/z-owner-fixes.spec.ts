import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { remember } from "./support";

// P133 (P129 verdict 11): a refusal of the agent's tool only the owner can fix (`owner_fixes`, written by `hub mcp`) is an
// item of Overview's Needs you with the registry's fix line, until the tool's next success deletes it. The row is written
// here as `hub mcp` would; the server and the agent tests hold the writer and the 24-hour window.
const DB = process.env.HUB_E2E_DB ?? "";
const P = "lisbon-realty";
const sql = (q: string) => execFileSync("sqlite3", [DB, q], { stdio: ["ignore", "pipe", "inherit"] });

test.beforeEach(async ({ page }) => {
  await remember(page, P);
});
test.afterEach(() => {
  sql(`DELETE FROM owner_fixes WHERE project = '${P}'`);
});

test("overview: an owner-fix refusal is a broken item with its fix line, and leaves when its row goes", async ({ page }) => {
  sql(`INSERT INTO owner_fixes (project, code, tool, line, place, at) VALUES ('${P}', 'mail_not_allowed', 'draft_write', 'System Settings ▸ Privacy & Security ▸ Automation: allow the Hub to control Mail.', 'System Settings', '${new Date().toISOString()}')`);
  await page.goto("/overview");
  const item = page.getByTestId("needs-you").locator(`li[data-part="${P}:refusal:mail_not_allowed"]`);
  await expect(item).toHaveAttribute("data-state", "fail");
  await expect(item).toContainText("Agent stopped");
  await expect(item).toContainText("The Hub is not allowed to control Apple Mail.");
  await expect(item.locator("code")).toHaveText("System Settings ▸ Privacy & Security ▸ Automation: allow the Hub to control Mail.");
  // The tool's next success deletes the row (the live trigger moves `health`): the item leaves without a reload.
  sql(`DELETE FROM owner_fixes WHERE project = '${P}'`);
  await expect(item).toHaveCount(0);
});
