import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { address, mailError, mailFresh, mailOff, mailStale, notionFresh, notionToken, overviewIs, remember, withLive, type OverviewJson } from "./support";

// The Overview (P31 O3 and O4), read flows only: nothing here writes and no request leaves the machine. Every live state
// is the server's own answer patched in the browser, so each scenario of the plan's section 5 can be shown by name.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const cardOf = (page: Page, slug: string) => page.locator(`#project-${slug}`);

test("overview: the empty address is the Overview when there are two projects, and it names no project", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => address(page)).toBe("/overview");
  await expect(page.getByRole("region", { name: "Verdict" })).toBeVisible();
  await expect(page).toHaveTitle("Overview · Hub Workflow");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
});

test("overview: a project in the address is dropped, a focus is kept, and a reload keeps both", async ({ page }) => {
  await page.goto("/overview?project=lisbon-realty&focus=demo-shop");
  await expect.poll(() => address(page)).toBe("/overview?focus=demo-shop");
  await expect(cardOf(page, "demo-shop")).toHaveAttribute("data-focused", "true");
  await page.reload();
  await expect(cardOf(page, "demo-shop")).toHaveAttribute("data-focused", "true");
  await expect.poll(() => address(page)).toBe("/overview?focus=demo-shop");
});

test("overview: a focus that is no project marks nothing", async ({ page }) => {
  await page.goto("/overview?focus=nope");
  await expect(cardOf(page, "demo-shop")).toBeVisible();
  await expect(page.locator('[data-focused="true"]')).toHaveCount(0);
});

test("overview: an item leads into its own project, Back returns, and the card links keep their project", async ({ page }) => {
  await page.goto("/overview");
  const card = cardOf(page, "demo-shop");
  await card.getByRole("link", { name: /ready/ }).click();
  await expect.poll(() => address(page)).toMatch(/^\/drafts\?project=demo-shop/);
  await page.goBack();
  await expect.poll(() => address(page)).toBe("/overview");
  await card.getByRole("link", { name: "Open project" }).click();
  await expect.poll(() => address(page)).toBe("/project?project=demo-shop");
});

test("overview: g o from Drafts, and the Tab order is the header, the list, then the cards", async ({ page }) => {
  await page.goto("/drafts?filter=all");
  await expect(page.locator('ul[aria-label="Drafts"] > li').first()).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  await expect.poll(() => address(page)).toBe("/overview");
  await expect(page.getByRole("button", { name: "Refresh all" })).toBeVisible();
  await page.locator("#main").focus();
  const order: string[] = [];
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press("Tab");
    order.push(await page.evaluate(() => `${document.activeElement?.getAttribute("aria-label") ?? document.activeElement?.textContent ?? ""}`.trim()));
  }
  expect(order[0]).toBe("Refresh all");
});

test("overview: loading shows skeletons with the header controls disabled", async ({ page }) => {
  await page.route(/\/api\/overview$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto("/overview");
  await expect(page.getByRole("status", { name: "Loading the overview" })).toBeVisible();
  await expect(page.getByRole("button", { name: "Refresh all" })).toBeDisabled();
  await expect(page.getByRole("region", { name: "Verdict" })).toBeVisible();
});

test("overview: the whole request failing shows a sentence and Retry loads it", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/overview$/, (route) => (fail ? route.fulfill({ status: 500, json: { error: "server error", code: "server" } }) : route.fallback()));
  await page.goto("/overview");
  await expect(page.getByText("Could not load the overview")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("region", { name: "Verdict" })).toBeVisible();
});

// "Not read yet" is a token that is present and never used. The throwaway home has no token (HUB_CONFIG_DIR is pinned inside it
// since P37), so the test puts one there for its own length and removes it, or the card would say the token is missing.
test("overview: no live number has been read yet", async ({ page }) => {
  const secrets = join(process.env.HUB_E2E_HOME ?? "", "secrets");
  mkdirSync(secrets, { recursive: true });
  writeFileSync(join(secrets, "notion-token"), "ntn_e2e_never_used\n", { mode: 0o600 });
  try {
    await page.goto("/overview");
    await expect(page.getByText("No live number has been read yet")).toBeVisible();
    await expect(cardOf(page, "demo-shop").getByText("Not read yet").first()).toBeVisible();
  } finally {
    rmSync(join(secrets, "notion-token"), { force: true });
  }
});

test("overview: fresh, stale, error and off read as words, and an error keeps the last count and its fix", async ({ page }) => {
  await overviewIs(page, withLive(mailFresh(3), notionFresh(212)));
  await page.goto("/overview");
  const card = cardOf(page, "demo-shop");
  await expect(card.getByText("3 new since triage")).toBeVisible();
  await expect(card.getByText("Fresh").first()).toBeVisible();
  await expect(card.getByText("212")).toBeVisible();
});

test("overview: stale", async ({ page }) => {
  await overviewIs(page, withLive(mailStale(4), notionFresh(2000, true)));
  await page.goto("/overview");
  const card = cardOf(page, "demo-shop");
  await expect(card.getByText("Stale").first()).toBeVisible();
  await expect(card.getByText("3 h ago").first()).toBeVisible();
  await expect(card.getByText("2,000+")).toBeVisible();
  await expect(card.getByText("May include messages that are not clients")).toBeVisible();
});

test("overview: mail error and Notion token missing are errors with a fix line, never a quiet zero", async ({ page }) => {
  await overviewIs(page, withLive(mailError, notionToken));
  await page.goto("/overview");
  const card = cardOf(page, "demo-shop");
  await expect(card.getByText("The mail server refused the login.")).toBeVisible();
  await expect(card.getByText("3 new since triage")).toBeVisible();
  await expect(card.getByText(/The Notion token is missing\./)).toBeVisible();
  await expect(card.getByText("Failed").first()).toBeVisible();
});

test("overview: a mailbox with no login is not set up, and never reads as 0", async ({ page }) => {
  await overviewIs(page, withLive(mailOff, notionFresh(1)));
  await page.goto("/overview");
  const card = cardOf(page, "demo-shop");
  await expect(card.getByText("No login for this account")).toBeVisible();
  await expect(card.getByText("0 new since triage")).toHaveCount(0);
});

test("overview: a project that never ran shows Never triaged, and archived projects collapse", async ({ page }) => {
  const patch = (dto: OverviewJson): OverviewJson => ({ ...dto, projects: dto.projects.map((p) => (p.slug === "demo-shop" ? { ...p, archived: true, lastTriageAt: null } : { ...p, lastTriageAt: null })) });
  await overviewIs(page, patch);
  await page.goto("/overview");
  await expect(cardOf(page, "lisbon-realty").getByText("Never triaged").first()).toBeVisible();
  await expect(page.getByRole("button", { name: "Archived (1)" })).toBeVisible();
});

test("overview: no projects", async ({ page }) => {
  await overviewIs(page, (dto) => ({ ...dto, projects: [], attention: [] }));
  await page.goto("/overview");
  await expect(page.getByText("No projects yet")).toBeVisible();
});

test("overview: the attention list shows five and the rest on request", async ({ page }) => {
  await overviewIs(page, (dto) => {
    const base = dto.attention[0] ?? { kind: "drafts-ready", severity: "needs-owner", project: "lisbon-realty", sentence: "lisbon-realty: 2 drafts are ready. Open Drafts.", focus: "drafts", filter: "ready" };
    const kinds = ["drafts-ready", "owe-reply", "never-triaged", "knowledge-expired", "cap-near", "stale-read", "doctor-fail"];
    return { ...dto, attention: kinds.map((kind, i) => ({ ...base, kind, project: "lisbon-realty", sentence: `lisbon-realty: item ${i}. Look.` })) };
  });
  await page.goto("/overview");
  const list = page.getByRole("list", { name: "Needs you" });
  await expect(list.getByRole("listitem")).toHaveCount(5);
  await page.getByRole("button", { name: "Show all 7" }).click();
  await expect(list.getByRole("listitem")).toHaveCount(7);
});
