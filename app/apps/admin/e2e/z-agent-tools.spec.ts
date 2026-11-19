import { expect, test, type Page } from "@playwright/test";
import { at, remember } from "./support";

// Agent tools on Settings ▸ Agent (P49 section 5B; on Connections until P63, the Agents page until P70, now `/<project>/settings/agent`) on the fake checks (`HUB_AGENT_TOOLS=fake`: fixed rows, a red one whose fix is
// `hub agent <slug> --prepare` and a warn one; Refresh moves `checkedAt`). Named z-* because Refresh writes the server's last result.
test.describe.configure({ mode: "serial" });

const P = "lisbon-realty";
const block = (page: Page) => page.getByTestId(`agent-tools-${P}`);
const checkedAt = async (page: Page) => ((await (await page.request.get(`/api/projects/${P}/agent-tools`)).json()) as { checkedAt: string | null }).checkedAt;

test.beforeEach(async ({ page }) => {
  await remember(page, P);
});

test("agent tools: the sentence, then only the rows that need a fix or a look (each with its fix line and Copy); every check folded under All checks", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(at(P, "/settings/agent"));
  await expect(page).toHaveTitle(`Agent · ${P} · Hub Workflow`);
  // UX pass 2026-11-20: no eyebrow repeating the pane's name, and the green rows are folded.
  await expect(page.getByRole("heading", { name: "Agent tools" })).toHaveCount(0);
  await expect(block(page).getByTestId("agent-tools-status")).toContainText(/to fix/);
  // P62: the attached connectors, one line each, above Checks (the fake checks attach one calendar).
  const connectors = page.getByRole("region", { name: "Connectors" });
  await expect(connectors.getByTestId("agent-connectors").getByRole("listitem")).toHaveCount(1);
  await expect(connectors.getByRole("listitem").first()).toContainText("Calendar");
  await expect(connectors.getByRole("listitem").first()).toContainText("gcal-demo · owner@example.com · read, holds with no guests");
  await expect(connectors.getByRole("button")).toHaveCount(0);
  const attention = block(page).getByRole("table", { name: "Needs a fix or a look" });
  await expect(attention.locator('tr[data-state="pass"]')).toHaveCount(0);
  await expect(block(page).getByRole("table", { name: "Claude Code" })).toHaveCount(0);
  const red = attention.locator('tr[data-state="fail"]').first();
  await expect(red).toContainText("Needs a fix");
  await expect(red.getByTestId("agent-tool-fix")).toContainText(`hub agent ${P} --prepare`);
  const look = attention.locator('tr[data-state="warn"]').first();
  await expect(look).toContainText("Check");
  await expect(look.getByTestId("agent-tool-fix")).toBeVisible();
  await block(page).getByRole("button", { name: /^All checks/ }).click();
  await expect(block(page).getByRole("table", { name: "Claude Code" })).toBeVisible();
  // Only a row that needs a fix or a look carries a fix line.
  await expect(block(page).locator('tr[data-state="pass"], tr[data-state="skip"]').getByTestId("agent-tool-fix")).toHaveCount(0);
  await red.getByRole("button", { name: /^Copy the fix for / }).click();
  await expect(page.getByRole("status").filter({ hasText: `Copied: hub agent ${P} --prepare` })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`hub agent ${P} --prepare`);
});

test("agent tools: Refresh runs the checks again (disabled while they run) and the block says so", async ({ page }) => {
  await page.goto(at(P, "/settings/agent"));
  await expect(block(page)).toBeVisible();
  const before = await checkedAt(page);
  const refresh = block(page).getByRole("button", { name: "Refresh" });
  await refresh.click();
  await expect(page.getByRole("status").filter({ hasText: "Checked again." })).toBeVisible({ timeout: 20_000 });
  await expect(block(page).getByRole("button", { name: "Refresh" })).toBeEnabled();
  await expect.poll(() => checkedAt(page)).not.toBe(before);
});

test("agent tools: a red row puts a dot on Settings in the nav, and Connections holds no Agent tools", async ({ page }) => {
  await page.goto(at(P, "/drafts"));
  await expect(page.getByRole("navigation", { name: "Sections" }).first().getByTestId("dot-settings")).toBeVisible();
  await page.goto("/settings/connections");
  await expect(page.getByRole("heading", { name: /^Agent tools/ })).toHaveCount(0);
});

test("agent tools: after a check the Overview's parts read the cached rows (no check of their own)", async ({ page }) => {
  await page.goto("/overview");
  await page.getByRole("button", { name: /^All parts/ }).click();
  const parts = page.getByRole("table", { name: "Parts" });
  await expect(parts).toBeVisible();
  // The fake rows have no mail-mcp row: the part is not checked here, never shown as working.
  await expect(parts.locator(`tr[data-part="${P}:mail-mcp"]`)).toHaveAttribute("data-state", "unknown");
  await expect(parts.locator('tr[data-part="core"], tr[data-part^="cli:"]').first()).toBeVisible();
});
