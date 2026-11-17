import { expect, test, type Page } from "@playwright/test";
import { address, overviewIs, remember, type OverviewJson } from "./support";

// The shell's one status line (P31 O5) reads the Overview's verdict, and the Overview and the status area honour
// prefers-reduced-motion (P31 O6). Nothing here writes; every state is the server's own answer patched in the browser.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

const line = (page: Page) => page.getByRole("status").getByRole("link", { name: /^(All clear|Checking status|Status unknown|Blocked|\d+ things? needs? you)/ });
const item = (kind: string, severity: string, sentence: string) => ({ kind, severity, project: "lisbon-realty", sentence, focus: "drafts", filter: "ready" });
const verdictIs = (level: string, headline: string, attention: Record<string, unknown>[]) => (dto: OverviewJson): OverviewJson => ({ ...dto, verdict: { level, headline }, attention });

test("status line: all clear, one short line that leads to the Overview with no project in the address", async ({ page }) => {
  await overviewIs(page, verdictIs("clear", "All clear", []));
  await page.goto("/drafts?filter=all");
  await expect(line(page)).toHaveText("All clear");
  await line(page).click();
  await expect.poll(() => address(page)).toBe("/overview");
});

test("status line: it agrees with the page, and counts what needs the owner, not what is only to watch", async ({ page }) => {
  await overviewIs(page, verdictIs("attention", "2 things need you: x", [item("drafts-ready", "needs-owner", "lisbon-realty: 2 drafts are ready."), item("owe-reply", "needs-owner", "lisbon-realty: 3 clients wait."), item("stale-read", "watch", "lisbon-realty: a number is stale.")]));
  await page.goto("/overview");
  await expect(line(page)).toHaveText("2 things need you");
  await expect(page.getByRole("region", { name: "Verdict" })).toContainText("Needs you");
  await expect(page.getByRole("region", { name: "Verdict" })).toContainText("2 things need you");
});

test("status line: a blocker says Blocked in words", async ({ page }) => {
  await overviewIs(page, verdictIs("blocked", "1 thing needs you: x", [item("send-stopped", "blocker", "Sending is stopped.")]));
  await page.goto("/drafts?filter=all");
  await expect(line(page)).toHaveText("Blocked: 1 thing needs you");
});

test("status line: when the overview cannot be read it says so, never all clear", async ({ page }) => {
  await page.route(/\/api\/overview$/, (route) => route.fulfill({ status: 500, json: { error: "server error", code: "server" } }));
  await page.goto("/drafts?filter=all");
  await expect(line(page)).toHaveText("Status unknown");
  await expect(page.getByRole("status").getByText("All clear")).toHaveCount(0);
});

test("status line: while loading it says it is checking", async ({ page }) => {
  await page.route(/\/api\/overview$/, async (route) => {
    await new Promise((r) => setTimeout(r, 1500));
    await route.fallback();
  });
  await page.goto("/drafts?filter=all");
  await expect(line(page)).toHaveText("Checking status");
  await expect(line(page)).toHaveText(/^(All clear|\d+ things? needs? you|Blocked)/);
});

test("status line: when the server stops answering the line keeps the last answer and says when it was true", async ({ page }) => {
  await overviewIs(page, verdictIs("clear", "All clear", []));
  await page.goto("/drafts?filter=all");
  await expect(line(page)).toHaveText("All clear");
  await page.route(/\/api\/(pulse|overview)$/, (route) => route.fulfill({ status: 500, json: { error: "server error", code: "server" } }));
  await expect(line(page)).toHaveText(/^All clear, as of \d\d:\d\d$/, { timeout: 30_000 });
  await expect(page.getByRole("list", { name: "Server" })).toContainText("Server not answering");
});

// Motion: coss animates the skeleton shimmer, the spinner and the collapsible panel; one global rule in `styles.css` zeroes
// every duration under `prefers-reduced-motion`. The test reads the live animations, so a new animated element cannot slip by.
const running = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 0).map((a) => `${a.constructor.name} ${a.effect instanceof KeyframeEffect && a.effect.target instanceof Element ? a.effect.target.tagName.toLowerCase() : ""}`));

async function slowOverview(page: Page) {
  await page.route(/\/api\/overview$/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.fallback();
  });
}

test("motion: the control animates the skeleton when motion is allowed, so the next check is not blind", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await slowOverview(page);
  await page.goto("/overview");
  await expect(page.getByRole("status", { name: "Loading the overview" })).toBeVisible();
  expect((await running(page)).length).toBeGreaterThan(0);
});

test("motion: with reduced motion nothing runs on the Overview while it loads, and the status area's Details opens with no transition", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowOverview(page);
  await page.goto("/overview");
  await expect(page.getByRole("status", { name: "Loading the overview" })).toBeVisible();
  expect(await running(page)).toEqual([]);
  await expect(page.getByRole("region", { name: "Verdict" })).toBeVisible();
  await page.getByRole("button", { name: "Details" }).click();
  await expect(page.getByRole("list", { name: "Server status" })).toBeVisible();
  expect(await running(page)).toEqual([]);
});
