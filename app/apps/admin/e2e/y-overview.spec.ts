import { expect, test } from "@playwright/test";
import type { OverviewDto } from "@hub/contract/overview";
import { address, remember } from "./support";

// The Overview (P48 W3, P63, P70), read flows only: the e2e instance has two projects, so Overview is the entry. One sentence,
// then one table row per project leading into that project's Drafts, then "Needs you" (or "Everything works") and every part
// folded under All parts. Nothing here reads Notion and there is nothing to refresh. The one-project Overview is `b-routing.spec.ts`'s.
const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

test("overview: the empty address is the Overview with two projects, and it names no project", async ({ page }) => {
  await page.goto("/");
  await expect.poll(() => address(page)).toBe("/overview");
  await expect(page.getByRole("table", { name: "Projects" })).toBeVisible();
  // Overview may carry its dot (a "Needs you" item lights it, UX pass), whose words join the link's name.
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: /^Overview( needs you)?$/ })).toHaveAttribute("aria-current", "page");
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
  await expect.poll(() => address(page)).toMatch(/^\/demo-shop\/mail(\/\d+)?(\?|$)/);
  await page.goBack();
  await expect.poll(() => address(page)).toBe("/overview");
});

test("overview: g o from Drafts", async ({ page }) => {
  await page.goto("/lisbon-realty/mail?filter=all");
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

type Node = { id: string; kind: string; project: string | null; label: string; state: string; detail: string; fix: string | null; place: string | null };
const scheme = async (page: import("@playwright/test").Page) => (await (await page.request.get(`${API()}/api/scheme`)).json()) as { nodes: Node[] };

test("overview: Needs you holds every broken or needs-a-look part, under the projects, each with one link to where it is fixed; All parts is closed", async ({ page }) => {
  const d = await scheme(page);
  const bad = d.nodes.filter((n) => n.state === "fail" || n.state === "warn");
  await page.goto("/overview");
  const projects = page.getByRole("table", { name: "Projects" });
  const needs = page.getByTestId("needs-you");
  await expect(needs).toBeVisible();
  expect((await projects.boundingBox())!.y).toBeLessThan((await needs.boundingBox())!.y);
  await expect(needs.locator("li[data-part]:not([data-part=question])")).toHaveCount(bad.length);
  for (const n of bad) await expect(needs.locator(`li[data-part="${n.id}"]`).getByRole("link"), n.id).toHaveCount(n.place !== null && n.place !== "overview" ? 1 : 0);
  // "Not checked here" is nobody's failure: only under All parts, which is closed.
  await expect(needs.locator('li[data-state="unknown"]')).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Parts" })).toHaveCount(0);
  await page.getByRole("button", { name: /^All parts/ }).click();
  const parts = page.getByRole("table", { name: "Parts" });
  const states = await parts.locator("tbody tr").evaluateAll((rows) => rows.map((r) => r.getAttribute("data-state")));
  expect(states.length).toBe(d.nodes.length);
  const rank = { fail: 0, warn: 1, unknown: 2, ok: 3 } as Record<string, number>;
  expect(states.map((x) => rank[x ?? ""])).toEqual([...states.map((x) => rank[x ?? ""])].sort((a, b) => (a ?? 0) - (b ?? 0)));
  await expect(page.getByRole("button", { name: /Refresh|Test|Copy/ })).toHaveCount(0);
});

test("overview: nothing needs you is one line, Everything works, and every part stays folded", async ({ page }) => {
  await page.route(/\/api\/scheme$/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { nodes: Node[] };
    await route.fulfill({ response: res, json: { ...json, nodes: json.nodes.map((n) => (n.state === "fail" || n.state === "warn" ? { ...n, state: "ok", detail: "", fix: null } : n)) } });
  });
  await page.route(/\/api\/project\?/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), question: null } });
  });
  await page.goto("/overview");
  await expect(page.getByTestId("everything-works")).toHaveText("Everything works.");
  await expect(page.getByTestId("needs-you")).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Parts" })).toHaveCount(0);
});

test("overview: a failing setup check names the check and the phrase (no link: it is fixed in a session); the agent's question comes first", async ({ page }) => {
  await page.route(/\/api\/scheme$/, async (route) => {
    const res = await route.fetch();
    const json = (await res.json()) as { nodes: Node[] };
    const nodes = json.nodes.map((n) => (n.id === "lisbon-realty:setup" ? { ...n, state: "fail", detail: "Failing: workflows parse. workflows parse: 1 error", fix: "Say “set up project lisbon-realty” in a session (project-setup)" } : n));
    await route.fulfill({ response: res, json: { ...json, nodes } });
  });
  await page.route(/\/api\/project\?project=lisbon-realty/, async (route) => {
    const res = await route.fetch();
    await route.fulfill({ response: res, json: { ...(await res.json()), question: { question: "Which signature for the realty brand?", options: ["A", "B"] } } });
  });
  await page.goto("/overview");
  const needs = page.getByTestId("needs-you");
  const items = needs.locator("li[data-part]");
  await expect(items.first()).toHaveAttribute("data-part", "question");
  await expect(items.first()).toContainText("Which signature for the realty brand?");
  await expect(items.first().getByRole("link")).toHaveCount(0);
  const setup = needs.locator('li[data-part="lisbon-realty:setup"]');
  await expect(setup).toContainText("workflows parse");
  await expect(setup).toContainText("set up project lisbon-realty");
  await expect(setup.getByRole("link")).toHaveCount(0);
  // The fake Mailer (the e2e server's) is a look at the send door, and its link lands on Settings ▸ Sending.
  const door = needs.locator('li[data-part="lisbon-realty:send-door"]');
  await expect(door).toContainText("demo mode");
  await door.getByRole("link").click();
  await expect.poll(() => address(page)).toBe("/lisbon-realty/settings");
});
