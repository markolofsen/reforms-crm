import { expect, test, type Page } from "@playwright/test";
import { address, at, remember, statusIs } from "./support";

// The Mail status line (P48 W3, P96): the project's worst fact said once, at most one link to where it is fixed, the clients who
// wrote, the replies owed and when Mail was read (Check now); and the screens honour prefers-reduced-motion. Nothing here writes; every state is the server's own
// answer patched in the browser.
const P = "lisbon-realty";
test.beforeEach(async ({ page }) => {
  await remember(page, P);
});

const line = (page: Page) => page.getByTestId("status-line");

test("status line: clear says so plainly, with when Mail was read, and links nowhere", async ({ page }) => {
  await statusIs(page, P, { level: "clear", kind: "clear", sentence: "All clear", next: null, numbers: { owed: 0, wrote: 0, lastTriageAt: new Date().toISOString(), mailRead: { at: new Date().toISOString(), reason: null, reading: false, unknown: 0 } } });
  await page.goto(at(P, "/mail?filter=all"));
  await expect(line(page)).toHaveAttribute("data-level", "clear");
  await expect(line(page)).toContainText("All clear");
  await expect(line(page).getByTestId("mail-read")).toContainText("Mail read just now");
  // P99: Inbox, which held Check now, is gone, so the line has it whenever it has no link of its own.
  await expect(line(page).getByRole("button", { name: "Check now" })).toBeVisible();
  // P96: "triage …" was the newest agent record, not a read of Mail; it is gone from the line.
  await expect(line(page)).not.toContainText("triage");
  await expect(line(page).getByRole("link")).toHaveCount(0);
});

test("status line: clients who wrote lead to Inbox; replies owed count each client once; Mail closed is said", async ({ page }) => {
  await statusIs(page, P, { level: "clear", kind: "clear", sentence: "All clear", next: null, numbers: { owed: 3, wrote: 1, lastTriageAt: null, mailRead: { at: null, reason: "Mail is not running", reading: false, unknown: 0 } } });
  await page.goto(at(P, "/mail?filter=all"));
  // P99 verdict 14: who wrote and the replies owed are the Needs you count of the View menu, never repeated on the line.
  await expect(line(page)).toHaveText(/All clear\s*· Mail is not running/);
  await expect(line(page)).not.toContainText("replies owed");
  // Mail closed: a pass after opening it helps, so Check now is on the line.
  await expect(line(page).getByRole("button", { name: "Check now" })).toBeVisible();
});

test("status line: attention names the fact once, no count, and leads to where it is fixed", async ({ page }) => {
  // Test mode is a setting (level clear since the UX pass), so the attention fact here is a failed send.
  await statusIs(page, P, { level: "attention", kind: "send-failed", sentence: "1 send failed in the last 24 hours", next: "sending", numbers: { owed: 2, wrote: 0, lastTriageAt: null, mailRead: { at: null, reason: null, reading: false, unknown: 0 } } });
  await page.goto(at(P, "/mail?filter=all"));
  await expect(line(page)).toHaveAttribute("data-level", "attention");
  // P99 verdict 14: the replies owed are the Needs you count of the View menu, never a number on the line.
  await expect(line(page)).toHaveText(/^1 send failed in the last 24 hours\s*· Mail not read yet/);
  await expect(line(page)).not.toContainText("replies owed");
  // No count twice: the to-review number is the View menu's, never the line's.
  await expect(line(page)).not.toContainText("to review");
  await line(page).getByTestId("status-next").click();
  // P70: sending is fixed on Settings ▸ Sending, so the line leads there; the dot is on Settings, and (P75) on the Sending tab.
  await expect.poll(() => address(page)).toBe(at(P, "/settings"));
  const nav = page.getByRole("navigation", { name: "Sections" }).first();
  await expect(nav.getByTestId("dot-settings")).toBeVisible();
  if ((page.viewportSize()?.width ?? 0) >= 640) await expect(page.getByRole("navigation", { name: "Settings pages" }).getByTestId("dot-section-settings.page")).toBeVisible();
});

test("status line: blocked says what stops the sending", async ({ page }) => {
  await statusIs(page, P, { level: "blocked", kind: "send-stopped", sentence: "Sending is stopped", next: "sending" });
  await page.goto(at(P, "/mail?filter=all"));
  await expect(line(page)).toHaveAttribute("data-level", "blocked");
  await expect(line(page)).toContainText("Sending is stopped");
  // P70: when sending is stopped, the line's one link lands on Settings ▸ Sending, where Resume is.
  await line(page).getByTestId("status-next").click();
  await expect.poll(() => address(page)).toBe(at(P, "/settings"));
});

test("status line: when the overview cannot be read it says so, never all clear, and offers Retry", async ({ page }) => {
  await page.route(/\/api\/overview$/, (route) => route.fulfill({ status: 500, json: { error: "server error", code: "server" } }));
  await page.goto(at(P, "/mail?filter=all"));
  await expect(line(page)).toContainText("Status unknown");
  await expect(line(page).getByRole("button", { name: "Retry" })).toBeVisible();
});

test("status line: when the server stops answering the line says the data may be old", async ({ page }) => {
  // With the live stream up the pulse is not polled (P50); the stream refused, the page falls back to the 10 s pulse.
  await page.route(/\/api\/live/, (route) => route.fulfill({ status: 503, json: { error: "busy", code: "busy" } }));
  await page.goto(at(P, "/mail?filter=all"));
  await expect(line(page)).toBeVisible();
  await page.route(/\/api\/pulse$/, (route) => route.fulfill({ status: 500, json: { error: "server error", code: "server" } }));
  await expect(line(page)).toContainText("Server not answering", { timeout: 30_000 });
});

// Motion: coss animates the skeleton shimmer and the spinner; one global rule in `styles.css` zeroes every duration under
// `prefers-reduced-motion`. The test reads the live animations, so a new animated element cannot slip by.
const running = (page: Page) =>
  page.evaluate(() => document.getAnimations().filter((a) => a.playState === "running" && Number(a.effect?.getComputedTiming().duration ?? 0) > 0).map((a) => `${a.constructor.name} ${a.effect instanceof KeyframeEffect && a.effect.target instanceof Element ? a.effect.target.tagName.toLowerCase() : ""}`));

async function slowDrafts(page: Page) {
  await page.route(/\/api\/projects\/[^/]+\/conversations\?/, async (route) => {
    await new Promise((r) => setTimeout(r, 2500));
    await route.fallback();
  });
}

test("motion: the control animates the skeleton when motion is allowed, so the next check is not blind", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "no-preference" });
  await slowDrafts(page);
  await page.goto(at(P, "/mail"));
  await expect(page.getByRole("list", { name: "Loading the people" })).toBeVisible();
  expect((await running(page)).length).toBeGreaterThan(0);
});

test("motion: with reduced motion nothing runs while Drafts loads", async ({ page }) => {
  await page.emulateMedia({ reducedMotion: "reduce" });
  await slowDrafts(page);
  await page.goto(at(P, "/mail"));
  await expect(page.getByRole("list", { name: "Loading the people" })).toBeVisible();
  expect(await running(page)).toEqual([]);
});
