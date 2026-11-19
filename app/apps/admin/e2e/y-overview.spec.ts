import { expect, test } from "@playwright/test";
import type { OverviewDto } from "@hub/contract/overview";
import { address, remember } from "./support";

// The Overview (P48 W3), read flows only: the e2e instance has two projects, so Overview exists and is the entry. One
// sentence, then one table row per project leading into that project's Drafts. Nothing here reads Mail or Notion and
// there is nothing to refresh. The one-project shell (no Overview) is `b-routing.spec.ts`'s.
const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("overview: the empty address is the Overview with two projects, and it names no project", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => address(page)).toBe("/overview");
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Overview", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto("/overview?project=lisbon-realty&focus=demo-shop");
  await expect.poll(() => address(page)).toBe("/overview");
});

test("overview: one sentence, then one row per project with its numbers, and no refresh", async ({ page }) => {
  const dto = (await (await page.request.get(`${API()}/api/overview`)).json()) as OverviewDto;
  await page.goto("/overview");
  await expect(page.getByTestId("overview-sentence")).toHaveText(dto.sentence);
  const rows = page.getByRole("table", { name: "Projects" }).locator("tbody tr");
  await expect(rows).toHaveCount(dto.projects.length);
  for (const p of dto.projects) {
    const r = page.locator(`tr[data-project="${p.slug}"]`);
    await expect(r.getByRole("link", { name: p.name })).toBeVisible();
    await expect(r.getByRole("cell").nth(2)).toHaveText(String(p.toReview));
    await expect(r.getByRole("cell").nth(6)).toContainText(p.status.level === "clear" ? "-" : p.status.sentence);
  }
  await expect(page.getByRole("button", { name: /Refresh/ })).toHaveCount(0);
  await expect(page.getByText(/Not read yet|as of \d/)).toHaveCount(0);
});

test("overview: a row leads into its own project's Drafts, and Back returns", async ({ page }) => {
  await page.goto("/overview");
  await page.locator('tr[data-project="demo-shop"]').getByRole("link").first().click();
  await expect.poll(() => address(page)).toMatch(/^\/demo-shop\/drafts(\/\d+)?(\?|$)/);
  await page.goBack();
  await expect.poll(() => address(page)).toBe("/overview");
});

test("overview: g o from Drafts", async ({ page }) => {
  await page.goto("/lisbon-realty/drafts?filter=all");
  await expect(page.locator('ul[aria-label="Drafts"] > li').first()).toBeVisible();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("g");
  await page.keyboard.press("o");
  await expect.poll(() => address(page)).toBe("/overview");
});

test("overview: loading shows skeleton rows, then the table", async ({ page }) => {
  await page.route(/\/api\/overview$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto("/overview");
  await expect(page.getByRole("list", { name: "Loading the overview" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
});

test("overview: the request failing shows a sentence and Retry loads it", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/overview$/, (route) => (fail ? route.fulfill({ status: 500, json: { error: "server error", code: "server" } }) : route.fallback()));
  await page.goto("/overview");
  await expect(page.getByText("Could not load the overview")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
});
