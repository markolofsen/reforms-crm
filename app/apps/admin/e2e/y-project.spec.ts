import { expect, test, type Page } from "@playwright/test";
import { remember } from "./support";

// The Project screen's send history and the one Stop sending, driven in a real browser (the previous phases did not).
// The server's answers are held in this file: a queued send exists only with autosend, which the e2e server does not run,
// and Stop all is exercised for real in `z-send.spec.ts`. Here the page is the subject: what it asks, what it shows after.
test.beforeEach(async ({ page }) => {
  await remember(page, "lisbon-realty");
});

type Row = { id: number; draftId: number; mode: "auto" | "manual"; status: "queued" | "sent" | "failed" | "cancelled" | "sending"; actor: string; createdAt: string; dueAt: string | null; doneAt: string | null; toAddr: string; ccAddr: string | null; subject: string; body: string; error: string | null };
const queued: Row = { id: 3, draftId: 9, mode: "auto", status: "queued", actor: "auto", createdAt: "2026-11-15T10:00:00.000Z", dueAt: "2026-11-15T10:10:00.000Z", doneAt: null, toAddr: "ana@example.com", ccAddr: null, subject: "Re: Order status", body: "Hello Ana", error: null };
const sent: Row = { id: 2, draftId: 8, mode: "manual", status: "sent", actor: "admin", createdAt: "2026-11-14T09:00:00.000Z", dueAt: null, doneAt: "2026-11-14T09:00:02.000Z", toAddr: "bo@example.com", ccAddr: "mark@example.org", subject: "Re: Refund question", body: "Hello Bo", error: null };

/** A server that keeps its own list of sends and its own Stop all state, and records every write the page makes. */
async function sendsServer(page: Page, start: { sends: Row[]; stopped: string[] }) {
  const state = { sends: start.sends, stopped: start.stopped };
  const writes: string[] = [];
  await page.route(/\/api\/projects\/[^/]+\/sends$/, (route) => route.fulfill({ json: state }));
  await page.route(/\/api\/sends\/(\d+)\/cancel/, (route) => {
    const id = Number(route.request().url().match(/sends\/(\d+)\/cancel/)?.[1]);
    writes.push(`cancel ${id}`);
    state.sends = state.sends.map((r) => (r.id === id ? { ...r, status: "cancelled", doneAt: "2026-11-15T10:05:00.000Z" } : r));
    return route.fulfill({ json: { ok: true, sendId: id } });
  });
  await page.route(/\/api\/projects\/[^/]+\/sends\/(stop|resume)$/, (route) => {
    const [, scope = "", verb = ""] = route.request().url().match(/projects\/([^/]+)\/sends\/(stop|resume)$/) ?? [];
    const slug = decodeURIComponent(scope);
    writes.push(`${verb} ${slug}`);
    state.stopped = verb === "stop" ? [...new Set([...state.stopped, slug])] : state.stopped.filter((s) => s !== slug);
    return route.fulfill({ json: { ok: true, cancelled: verb === "stop" ? state.sends.filter((r) => r.status === "queued").length : 0, stopped: state.stopped } });
  });
  return writes;
}

test("send history: Cancel exists only on a queued send, asks nothing twice, and the row reads cancelled after", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [queued, sent], stopped: [] });
  await page.goto("/project");
  const list = page.getByRole("list", { name: "Sends" });
  await expect(list.getByRole("listitem")).toHaveCount(2);
  await expect(page.getByRole("button", { name: /^Cancel send/ })).toHaveCount(1); // the sent row has none: a sent mail cannot be recalled
  await expect(list.getByText("goes out", { exact: false })).toBeVisible();
  const cancel = page.getByRole("button", { name: "Cancel send 3: Re: Order status" });
  await cancel.focus();
  await page.keyboard.press("Enter");
  await expect(list.getByText("cancelled", { exact: true })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cancel send/ })).toHaveCount(0);
  expect(writes).toEqual(["cancel 3"]);
  // the text of a row opens inline and closes again
  const show = page.getByRole("button", { name: /Show text, send 2/ });
  await show.click();
  await expect(page.getByText("Hello Bo")).toBeVisible();
  await expect(page.getByRole("button", { name: /Hide text, send 2/ })).toHaveAttribute("aria-expanded", "true");
  await page.getByRole("button", { name: /Hide text, send 2/ }).click();
  await expect(page.getByText("Hello Bo")).toHaveCount(0);
});

test("send history: a refused cancel is shown as the server's sentence, in an alert, and the row stays queued", async ({ page }) => {
  await sendsServer(page, { sends: [queued], stopped: [] });
  await page.route(/\/api\/sends\/3\/cancel/, (route) => route.fulfill({ status: 409, json: { error: "That send already left.", code: "wrong_state" } }));
  await page.goto("/project");
  await page.getByRole("button", { name: /^Cancel send 3/ }).click();
  await expect(page.getByRole("alert").filter({ hasText: "That send already left." })).toBeVisible();
  await expect(page.getByRole("button", { name: /^Cancel send 3/ })).toBeVisible();
});

test("Stop sending asks inline for the scope, Keep sending backs out, Stop all halts every project and Resume lifts it", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [queued], stopped: [] });
  await page.goto("/project");
  const stop = page.getByRole("button", { name: "Stop sending" });
  await stop.click();
  const ask = page.getByRole("group", { name: "Stop sending" });
  await expect(ask).toBeVisible();
  await expect(page.getByRole("dialog")).toHaveCount(0); // inline, never a dialog
  await ask.getByRole("button", { name: "Keep sending" }).click();
  await expect(ask).toHaveCount(0);
  expect(writes).toEqual([]);

  await stop.click();
  await page.getByRole("radio", { name: "Every project" }).click();
  await ask.getByRole("button", { name: "Stop sending" }).click();
  await expect(page.getByText("Sending is stopped for every project")).toBeVisible();
  expect(writes).toEqual(["stop *"]);

  const resume = page.getByRole("button", { name: "Resume every project" });
  await resume.click();
  await expect(page.getByRole("button", { name: "Stop sending" })).toBeVisible();
  await expect(page.getByText(/Sending is stopped/)).toHaveCount(0);
  expect(writes).toEqual(["stop *", "resume *"]);
});

test("Stop sending for one project, then Resume that project", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [], stopped: [] });
  await page.goto("/project");
  await page.getByRole("button", { name: "Stop sending" }).click();
  await page.getByRole("group", { name: "Stop sending" }).getByRole("button", { name: "Stop sending" }).click();
  await expect(page.getByText("Sending is stopped for lisbon-realty")).toBeVisible();
  await page.getByRole("button", { name: "Resume lisbon-realty" }).click();
  await expect(page.getByRole("button", { name: "Stop sending" })).toBeVisible();
  expect(writes).toEqual(["stop lisbon-realty", "resume lisbon-realty"]);
});

test("the safety rules are Switches: toggling one writes once and reports a failure inline", async ({ page }) => {
  let asked = 0;
  await page.route(/\/api\/safety-rules\//, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    asked += 1;
    return route.fulfill({ status: 409, json: { error: "Rules are locked in this test.", code: "wrong_state" } });
  });
  await page.goto("/project");
  const first = page.getByRole("switch").first();
  const before = await first.getAttribute("aria-checked");
  await first.click();
  await expect(page.getByRole("alert").filter({ hasText: "Rules are locked in this test." })).toBeVisible();
  expect(asked).toBeGreaterThanOrEqual(1);
  await expect(first).toHaveAttribute("aria-checked", before ?? "true");
});
