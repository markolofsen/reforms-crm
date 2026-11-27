import { expect, test, type Page, type Route } from "@playwright/test";
import { createHash } from "node:crypto";
import type { WatchReviewDto } from "@hub/contract/watch-review";
import { hash, preparedFixture, reviewContextFixture, reviewFixture, reviewState, reviewWatchFixture } from "../test/fixtures/watch-review";
import { at, confirmReview, rememberShell, reviewDialog } from "./support";

const selected = at("demo-shop", "/watch?view=moments&direction=research&contextGroup=sample_group&messageId=42");
type Routes = {
  rows: () => WatchReviewDto[];
  write?: (route: Route, action: string) => Promise<void>;
  wrongSource?: () => boolean;
  readError?: () => boolean;
  photo?: (route: Route) => Promise<void>;
};

/** Every public operation is intercepted. These scenarios never use Telegram, real policy or real proposal rows. */
async function fixtures(page: Page, options: Routes) {
  await page.route("**/api/projects/demo-shop/watch?*", (route) => route.fulfill({
    json: { ...reviewWatchFixture, moments: [...reviewWatchFixture.moments, ...reviewWatchFixture.moments.map((m) => ({ ...m, messageId: 43, quote: "A separate task on another message", link: "https://t.me/sample_group/43" }))] },
  }));
  await page.route("**/api/projects/demo-shop/watch/context?*", (route) => {
    const messageId = Number(new URL(route.request().url()).searchParams.get("messageId"));
    return route.fulfill({ json: { ...reviewContextFixture, messageId, messages: reviewContextFixture.messages.map((m) => ({ ...m, messageId })) } });
  });
  await page.route(/\/api\/projects\/demo-shop\/watch\/proposals(?:[/?]|$)/, async (route) => {
    const request = route.request();
    const url = new URL(request.url());
    if (request.method() !== "GET") {
      const action = url.pathname.split("/").at(-1) ?? "";
      if (options.write) return options.write(route, action);
      return route.fulfill({ status: 409, json: { error: "No action is enabled by this fixture.", code: "wrong_state", refused: ["fixture_read_only"] } });
    }
    const id = url.pathname.split("/").at(-1);
    if (id === "photo" && options.photo) return options.photo(route);
    if (options.readError?.()) return route.fulfill({ status: 500, json: { error: "Fixture read is unavailable", code: "server" } });
    if (id !== "proposals") {
      const row = options.rows().find((item) => item.proposal.id === id);
      return route.fulfill({ status: row ? 200 : 404, json: row ?? { error: "No saved proposal", code: "not_found" } });
    }
    const messageId = Number(url.searchParams.get("messageId"));
    const wrong = options.wrongSource?.() ?? false;
    return route.fulfill({
      json: { project: "demo-shop", direction: "research", group: "sample_group", messageId: wrong ? 42 : messageId,
        observedAt: "2026-11-27T10:06:00Z", items: messageId === 42 || wrong ? options.rows() : [] },
    });
  });
}

for (const theme of ["light", "dark"]) {
  test(`public reply states stay inline, source scoped and readable (${theme})`, async ({ page, context }) => {
    let current: WatchReviewDto = reviewFixture;
    const errors: string[] = [];
    page.on("pageerror", (error) => errors.push(error.message));
    await page.setViewportSize({ width: 1280, height: 900 });
    await rememberShell(context, "dock-open.w-400.bp-xl");
    await page.addInitScript((value) => localStorage.setItem("hub-theme", value), theme);
    await fixtures(page, { rows: () => [current] });
    for (const state of ["ready", "held", "stale", "unresolved", "failed", "sent"] as const) {
      current = reviewState(state);
      await page.goto(selected);
      const card = page.getByTestId("public-reply");
      await expect(card.getByTestId("public-reply-state")).toHaveAttribute("data-state", state);
      await expect(card).toContainText("@sample_group");
      await expect(card).toContainText("message #42");
      await expect(card).toContainText(reviewFixture.proposal.text);
      await expect(card.getByTestId("draft-send")).toHaveCount(state === "ready" ? 1 : 0);
      expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
      await card.screenshot({ path: test.info().outputPath(`public-reply-${state}-${theme}.png`) });
    }
    current = reviewFixture;
    await page.setViewportSize({ width: 768, height: 900 });
    await page.reload();
    await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "ready");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId("public-reply").screenshot({ path: test.info().outputPath(`public-reply-ready-${theme}-768.png`) });
    await page.setViewportSize({ width: 360, height: 800 });
    await page.reload();
    await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "ready");
    expect(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth)).toBe(true);
    await page.getByTestId("public-reply").screenshot({ path: test.info().outputPath(`public-reply-ready-${theme}-narrow.png`) });
    expect(errors).toEqual([]);
  });
}

test("another source and a mismatched response never inherit a public reply", async ({ page }) => {
  let wrong = false;
  await fixtures(page, { rows: () => [reviewFixture], wrongSource: () => wrong });
  await page.goto(selected);
  await expect(page.getByTestId("public-reply")).toHaveCount(1);
  await page.getByRole("link", { name: "Read context", exact: true }).nth(1).click();
  await expect(page).toHaveURL(/messageId=43/);
  await expect(page.getByTestId("public-replies")).toContainText("No reviewed reply for this message");
  await expect(page.getByTestId("public-reply")).toHaveCount(0);
  wrong = true;
  await page.reload();
  await expect(page.getByTestId("public-replies")).toContainText("returned a different source");
  await expect(page.getByTestId("public-reply")).toHaveCount(0);
});

test("keyboard review confirms once, shows Sending only in-flight, and keeps uncertain after reload", async ({ page }) => {
  let current: WatchReviewDto = reviewFixture;
  let prepared = 0;
  let sent = 0;
  let release: (() => void) | undefined;
  const gate = new Promise<void>((resolve) => { release = resolve; });
  await fixtures(page, {
    rows: () => [current],
    write: async (route, action) => {
      if (action === "prepare") { prepared += 1; return route.fulfill({ json: preparedFixture }); }
      if (action === "send") {
        sent += 1;
        expect(route.request().postDataJSON()).toEqual({ ticket: preparedFixture.ticket, payloadHash: hash("b"), policyGeneration: hash("e") });
        await gate;
        current = reviewState("unresolved");
        return route.fulfill({ status: 202, json: { status: "uncertain", proposalId: hash("a"), sendId: 17, messageId: null, reason: "Receipt not confirmed" } });
      }
      return route.fulfill({ status: 409, json: { error: "Unexpected fixture action", code: "wrong_state" } });
    },
  });
  await page.goto(selected);
  const button = page.getByTestId("draft-send");
  await button.focus();
  await page.keyboard.press("Enter");
  await expect(reviewDialog(page)).toContainText(reviewFixture.proposal.text);
  await expect(reviewDialog(page)).toContainText("message #42");
  await page.keyboard.press("Escape");
  expect([prepared, sent]).toEqual([0, 0]);
  await button.focus();
  await page.keyboard.press("Enter");
  await page.waitForTimeout(450);
  await page.keyboard.press("Enter");
  await expect(reviewDialog(page).getByTestId("review-confirm")).toContainText("Sending");
  await reviewDialog(page).screenshot({ path: test.info().outputPath("public-reply-sending.png") });
  if (!release) throw new Error("Fixture completion is missing");
  release();
  await expect(reviewDialog(page)).toHaveCount(0);
  await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "unresolved");
  await expect(page.getByTestId("draft-send")).toHaveCount(0);
  await page.reload();
  await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "unresolved");
  await expect(page.getByRole("button", { name: /Send again/ })).toHaveCount(0);
  expect([prepared, sent]).toEqual([1, 1]);
});

test("a final preparation refusal keeps the exact text and never starts send", async ({ page }) => {
  let prepareCount = 0;
  let sendCount = 0;
  await fixtures(page, {
    rows: () => [reviewFixture],
    write: async (route, action) => {
      if (action === "prepare") prepareCount += 1;
      if (action === "send") sendCount += 1;
      return route.fulfill({ status: 409, json: { error: "Source rules changed", code: "wrong_state", refused: ["Source rules changed. A fresh review is needed."] } });
    },
  });
  await page.goto(selected);
  await page.getByTestId("draft-send").click();
  await confirmReview(page);
  await expect(reviewDialog(page)).toContainText("Source rules changed");
  await expect(reviewDialog(page)).toContainText(reviewFixture.proposal.text);
  await expect(reviewDialog(page).getByTestId("review-confirm")).toHaveAttribute("aria-disabled", "true");
  expect([prepareCount, sendCount]).toEqual([1, 0]);
  await reviewDialog(page).screenshot({ path: test.info().outputPath("public-reply-refused.png") });
});

test("a lost response is reread from the saved attempt and cannot trigger a second send", async ({ page }) => {
  let current: WatchReviewDto = reviewFixture;
  let sendCount = 0;
  await fixtures(page, {
    rows: () => [current],
    write: async (route, action) => {
      if (action === "prepare") return route.fulfill({ json: preparedFixture });
      sendCount += 1;
      current = reviewState("unresolved");
      return route.abort("failed");
    },
  });
  await page.goto(selected);
  await page.getByTestId("draft-send").click();
  await confirmReview(page);
  await expect(reviewDialog(page)).toContainText("Delivery could not be confirmed");
  await page.keyboard.press("Escape");
  await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "unresolved");
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByTestId("draft-send")).toHaveCount(0);
  expect(sendCount).toBe(1);
});

test("known receipt reconciliation is separate from sending", async ({ page }) => {
  let current: WatchReviewDto = { ...reviewState("unresolved"), canReconcile: true, proposal: { ...reviewFixture.proposal, attempt: { id: 17, status: "uncertain", messageId: "58", reason: null } } };
  let reconciled = 0;
  await fixtures(page, {
    rows: () => [current],
    write: async (route, action) => {
      expect(action).toBe("reconcile");
      expect(route.request().postDataJSON()).toEqual({});
      reconciled += 1;
      current = reviewState("sent");
      return route.fulfill({ json: { status: "sent", proposalId: hash("a"), sendId: 17, messageId: "58", reason: null } });
    },
  });
  await page.goto(selected);
  await expect(page.getByTestId("draft-send")).toHaveCount(0);
  await page.getByRole("button", { name: "Check delivery", exact: true }).click();
  await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "sent");
  await expect(page.getByRole("link", { name: "Open delivered public reply" })).toBeVisible();
  expect(reconciled).toBe(1);
});

test("empty and unavailable reads never invent a proposal or a send action", async ({ page }) => {
  let unavailable = false;
  await fixtures(page, { rows: () => [], readError: () => unavailable });
  await page.goto(selected);
  await expect(page.getByTestId("public-replies")).toContainText("No reviewed reply for this message");
  unavailable = true;
  await page.reload();
  await expect(page.getByTestId("public-replies")).toContainText("Could not load the reviewed public replies");
  await expect(page.getByTestId("public-reply")).toHaveCount(0);
  await expect(page.getByTestId("draft-send")).toHaveCount(0);
  await page.getByTestId("public-replies").screenshot({ path: test.info().outputPath("public-reply-read-failure.png") });
  unavailable = false;
  await page.getByTestId("public-replies").getByRole("button", { name: "Retry", exact: true }).click();
  await expect(page.getByTestId("public-replies")).toContainText("No reviewed reply for this message");
});

test("a failed refresh preserves the payload but closes its send action", async ({ page }) => {
  let unavailable = false;
  await fixtures(page, { rows: () => [reviewFixture], readError: () => unavailable });
  await page.goto(selected);
  await expect(page.getByTestId("draft-send")).toBeVisible();
  unavailable = true;
  await page.getByRole("button", { name: "Refresh status", exact: true }).click();
  await expect(page.getByTestId("public-replies")).toContainText("Showing the last list that loaded");
  await expect(page.getByTestId("public-reply")).toContainText(reviewFixture.proposal.text);
  await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "held");
  await expect(page.getByTestId("draft-send")).toHaveCount(0);
});

test("a verified photo and exact caption must be visible before one full-payload confirmation", async ({ page }) => {
  // Static 1×1 RGBA fixture; no generated, uploaded or live image.
  const png = Buffer.from("iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAYAAAAfFcSJAAAAEElEQVR4AQEFAPr/ACJozP8EXAJW4ArPbwAAAABJRU5ErkJggg==", "base64");
  const sha256 = createHash("sha256").update(png).digest("hex");
  const photoReview: WatchReviewDto = { ...reviewFixture, proposal: { ...reviewFixture.proposal, payloadHash: hash("1"),
    photo: { kind: "photo", blobRef: sha256 + ".png", sha256, mime: "image/png", bytes: png.length, width: 1, height: 1 } } };
  let current = photoReview;
  let available = false;
  let sent = 0;
  await fixtures(page, {
    rows: () => [current],
    photo: (route) => available
      ? route.fulfill({ body: png, contentType: "image/png", headers: { "cache-control": "no-store" } })
      : route.fulfill({ status: 500, body: "Preview unavailable" }),
    write: async (route, action) => {
      if (action === "prepare") return route.fulfill({ json: { ...preparedFixture, review: photoReview, payloadHash: hash("1") } });
      expect(action).toBe("send");
      expect(route.request().postDataJSON().payloadHash).toBe(hash("1"));
      sent += 1;
      current = { ...photoReview, ...reviewState("sent"), proposal: { ...photoReview.proposal, attempt: { id: 17, status: "sent", messageId: "58", reason: null } } };
      return route.fulfill({ json: { status: "sent", proposalId: hash("a"), sendId: 17, messageId: "58", reason: null } });
    },
  });
  await page.goto(selected);
  await expect(page.getByTestId("public-reply")).toContainText("preview could not be loaded");
  await expect(page.getByTestId("draft-send")).toBeDisabled();
  available = true;
  await page.getByRole("button", { name: "Reload preview", exact: true }).click();
  await expect(page.getByTestId("draft-send")).toBeEnabled();
  await page.getByTestId("draft-send").click();
  await expect(reviewDialog(page)).toContainText(photoReview.proposal.text);
  await expect(reviewDialog(page).getByTestId("review-confirm")).toHaveText("Send photo and reply");
  await expect.poll(() => reviewDialog(page).getByRole("img").evaluate((el) => (el as HTMLImageElement).naturalWidth)).toBe(1);
  await reviewDialog(page).screenshot({ path: test.info().outputPath("public-reply-photo-confirmation.png") });
  await confirmReview(page);
  await expect(reviewDialog(page)).toHaveCount(0);
  await expect(page.getByTestId("public-reply-state")).toHaveAttribute("data-state", "sent");
  expect(sent).toBe(1);
});
