import { expect, test, type Page } from "@playwright/test";
import { address, at, remember, statusIs } from "./support";

// The Drafts status line (P48 W3): the project's worst fact said once, at most one link to where it is fixed, the two numbers
// the list does not show; and the screens honour prefers-reduced-motion. Nothing here writes; every state is the server's own
// answer patched in the browser.
const P = "lisbon-realty";
test.beforeEach(async ({ page }) => {
  await remember(page, P);
});

const line = (page: Page) => page.getByTestId("status-line");

test("status line: clear says so plainly, with the triage age, and links nowhere", async ({ page }) => {
  await statusIs(page, P, { level: "clear", kind: "clear", sentence: "All clear", next: null, numbers: { owed: 0, lastTriageAt: new Date().toISOString() } });
  await page.goto(at(P, "/drafts?filter=all"));
  await expect(line(page)).toHaveAttribute("data-level", "clear");
  await expect(line(page)).toContainText("All clear · triage just now");
  await expect(line(page).getByRole("link")).toHaveCount(0);
});

test("status line: attention names the fact once, adds the replies owed, and leads to where it is fixed", async ({ page }) => {
  await statusIs(page, P, { level: "attention", kind: "recipients-test", sentence: "Test mode: sends go to the test list only", next: "setup", numbers: { owed: 2, lastTriageAt: null } });
  await page.goto(at(P, "/drafts?filter=all"));
  await expect(line(page)).toHaveAttribute("data-level", "attention");
  await expect(line(page)).toHaveText(/Test mode: sends go to the test list only · never triaged · 2 replies owed/);
  // No count twice: the to-review number is the View menu's, never the line's.
  await expect(line(page)).not.toContainText("to review");
  await line(page).getByRole("link").click();
  // P63: the test list is set on Setup, so the line leads there; the dot is on Setup and on its parent Project.
  await expect.poll(() => address(page)).toBe(at(P, "/project/setup"));
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  await expect(nav.getByTestId("dot-project")).toBeVisible();
  await expect(nav.getByTestId("dot-project.setup")).toBeVisible();
});

test("status line: blocked says what stops the sending", async ({ page }) => {
  await statusIs(page, P, { level: "blocked", kind: "send-stopped", sentence: "Sending is stopped", next: "project" });
  await page.goto(at(P, "/drafts?filter=all"));
  await expect(line(page)).toHaveAttribute("data-level", "blocked");
  await expect(line(page)).toContainText("Sending is stopped");
});

test("status line: when the overview cannot be read it says so, never all clear, and offers Retry", async ({ page }) => {
  await page.route(/\/api\/overview$/, (route) => route.fulfill({ status: 500, json: { error: "server error", code: "server" } }));
  await page.goto(at(P, "/drafts?filter=all"));
  await expect(line(page)).toContainText("Status unknown");
  await expect(line(page).getByRole("button", { name: "Retry" })).toBeVisible();
});

test("status line: when the server stops answering the line says the data may be old", async ({ page }) => {
  // With the live stream up the pulse is not polled (P50); the stream refused, the page falls back to the 10 s pulse.
  await page.route(/\/api\/live/, (route) => route.fulfill({ status: 503, json: { error: "busy", code: "busy" } }));
  await page.goto(at(P, "/drafts?filter=all"));
  await expect(line(page)).toBeVisible();
  await page.route(/\/api\/pulse$/, (route) => route.fulfill({ status: 500, json: { error: "server error", code: "server" } }));
  await expect(line(page)).toContainText("Server not answering", { timeout: 30_000 });
});

// Motion: coss animates the skeleton shimmer and the spinner; one global rule in `styles.css` zeroes every duration under
// `prefers-reduced-motion`. The test reads the live animations, so a new animated element cannot slip by.
const running = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 0).map((a) => `${a.constructor.name} ${a.effect instanceof KeyframeEffect && a.effect.target instanceof Element ? a.effect.target.tagName.toLowerCase() : ""}`));

async function slowDrafts(page: Page) {
  await page.route(/\/api\/drafts\?/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.fallback();
  });
}

test("motion: the control animates the skeleton when motion is allowed, so the next check is not blind", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await slowDrafts(page);
  await page.goto(at(P, "/drafts"));
  await expect(page.getByRole("list", { name: "Loading drafts" })).toBeVisible();
  expect((await running(page)).length).toBeGreaterThan(0);
});

test("motion: with reduced motion nothing runs while Drafts loads", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowDrafts(page);
  await page.goto(at(P, "/drafts"));
  await expect(page.getByRole("list", { name: "Loading drafts" })).toBeVisible();
  expect(await running(page)).toEqual([]);
});
