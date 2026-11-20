import { expect, test, type Page } from "@playwright/test";
import { at, remember } from "./support";

// Agent tools on Settings ▸ Agent (P49 section 5B; on Connections until P63, the Agents page until P70, now `/<project>/settings/agent`) on the fake checks (`HUB_AGENT_TOOLS=fake`: fixed rows, a red one whose fix is
// `hub agent <slug> --prepare` and a warn one; Refresh moves `checkedAt`). Named z-* because Refresh writes the server's last result.
test.describe.configure({ mode: "serial" });

const P = "lisbon-realty";
const block = (page: Page) => page.getByTestId(`agent-tools-${P}`);
// Owner 2026-11-20: one group per agent CLI; the fake red and warn rows are Claude Code's.
const claude = (page: Page) => page.getByRole("region", { name: "Claude Code", exact: true });
const checkedAt = async (page: Page) => ((await (await page.request.get(`/api/projects/${P}/agent-tools`)).json()) as { checkedAt: string | null }).checkedAt;

test.beforeEach(async ({ page }) => {
  await remember(page, P);
});

test("agent tools: the sentence, the settings per agent, then one Tools table of the rows that need a fix or a look (each with its fix line and Copy); the View menu shows all, and a reload keeps it", async ({ page, context }) => {
  await context.grantPermissions(["clipboard-read", "clipboard-write"]);
  await page.goto(at(P, "/settings/agent"));
  await expect(page).toHaveTitle(`Agent · ${P} · Hub Workflow`);
  // UX pass 2026-11-20: no eyebrow repeating the pane's name.
  await expect(page.getByRole("heading", { name: "Agent tools" })).toHaveCount(0);
  await expect(block(page).getByTestId("agent-tools-status")).toContainText(/to fix/);
  // P62: the attached connectors, one line each, in the Claude Code group (the fake checks attach one calendar).
  const connectors = claude(page).getByRole("region", { name: "Connectors" });
  await expect(connectors.getByTestId("agent-connectors").getByRole("listitem")).toHaveCount(1);
  await expect(connectors.getByRole("listitem").first()).toContainText("Calendar");
  await expect(connectors.getByRole("listitem").first()).toContainText("gcal-demo · owner@example.com · read, holds with no guests");
  await expect(connectors.getByRole("button")).toHaveCount(0);
  // P75: the agent groups hold settings only; the checks of both CLIs are one Tools table after them, nothing folded.
  await expect(claude(page).getByRole("table")).toHaveCount(0);
  await expect(page.locator("#main [aria-expanded]:visible").filter({ hasNotText: /^View/ })).toHaveCount(0);
  const tools = page.getByRole("region", { name: "Tools", exact: true });
  const attention = tools.getByRole("table", { name: "Agent tools: needs a fix or a look" });
  const needs = await attention.locator("tr[data-state]").count();
  expect(needs).toBeGreaterThan(0);
  await expect(attention.locator('tr[data-state="pass"], tr[data-state="skip"]')).toHaveCount(0);
  const red = attention.locator('tr[data-state="fail"]').first();
  await expect(red).toContainText("Needs a fix");
  await expect(red).toContainText("Claude Code"); // each row names its CLI
  await expect(red.getByTestId("agent-tool-fix")).toContainText(`hub agent ${P} --prepare`);
  const look = attention.locator('tr[data-state="warn"]').first();
  await expect(look).toContainText("Check");
  await expect(look.getByTestId("agent-tool-fix")).toBeVisible();
  await red.getByRole("button", { name: /^Copy the fix for / }).click();
  await expect(page.getByRole("status").filter({ hasText: `Copied: hub agent ${P} --prepare` })).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(`hub agent ${P} --prepare`);
  // The View menu counts both views and filters the same table; the choice is in the address.
  const view = tools.getByRole("button", { name: /^View: Needs a look/ });
  await expect(view).toContainText(String(needs));
  await view.click();
  const all = page.getByRole("menuitemradio", { name: /^All/ });
  const total = Number((await all.textContent())?.match(/\d+/)?.[0] ?? 0);
  expect(total).toBeGreaterThan(needs);
  await all.click();
  await expect.poll(() => new URL(page.url()).search).toBe("?filter=all");
  const every = tools.getByRole("table", { name: "Agent tools: all checks" });
  await expect(every.locator("tr[data-state]")).toHaveCount(total);
  await expect(every.getByText("Codex").first()).toBeVisible();
  // Only a row that needs a fix or a look carries a fix line.
  await expect(every.locator('tr[data-state="pass"], tr[data-state="skip"]').getByTestId("agent-tool-fix")).toHaveCount(0);
  await page.reload();
  await expect(every.locator("tr[data-state]")).toHaveCount(total);
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

test("agent tools: a red row puts a dot on Settings in the nav and on the Agent tab of the sub-nav, and Connections holds no Agent tools", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect(page.getByRole("navigation", { name: "Sections" }).first().getByTestId("dot-settings")).toBeVisible();
  // P75: the sidebar draws no Settings children; the tab strip carries the child's dot.
  await page.goto(at(P, "/settings"));
  await expect(page.getByRole("navigation", { name: "Sections" }).first().getByRole("link", { name: "Agent", exact: true })).toHaveCount(0);
  await expect(page.getByRole("navigation", { name: "Settings pages" }).getByTestId("dot-settings.agent")).toBeVisible();
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
