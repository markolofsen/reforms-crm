import { expect, test, type Page } from "@playwright/test";
import { remember } from "./support";

// The Project screen by frequency (P48 W6, `admin-principles.md` rule 9), over the landing and its Setup page since P63: the
// landing holds the status sentence and Stop sending first, then the sends when any exist; Setup holds one line per fact and
// the safety rules under Advanced. The sends are held in this file (a queued send exists only with autosend, which the e2e
// server does not run; Stop all is exercised for real in `z-send.spec.ts`). Two projects, so the address names the project first.
const PROJECT = "lisbon-realty";
const AT = `/${PROJECT}/project`;
const SETUP = `/${PROJECT}/project/setup`;
const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

test.beforeEach(async ({ page }) => {
  await remember(page, PROJECT);
});

type Row = { id: number; draftId: number | null; mode: "auto" | "manual"; status: "queued" | "sent" | "failed" | "cancelled" | "sending"; actor: string; createdAt: string; dueAt: string | null; doneAt: string | null; toAddr: string; ccAddr: string | null; subject: string; body: string; error: string | null };
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

const advanced = (page: Page) => page.getByRole("button", { name: /^Advanced/ });
/** A rule set through the API, as the agent or another tab would; the test puts it back after. */
const setRule = (page: Page, kind: string, enabled: boolean) => page.request.put(`${API()}/api/safety-rules/${kind}`, { data: { project: PROJECT, enabled } });

test("project: the first viewport at 1280 shows the status, Stop sending and the sends; the facts are on Setup, Advanced closed", async ({ page }) => {
  await sendsServer(page, { sends: [sent], stopped: [] });
  await page.goto(AT);
  const status = page.getByTestId("project-status");
  await expect(status).toHaveText(/\S/);
  const stop = page.getByRole("button", { name: "Stop sending" });
  const sends = page.getByRole("table", { name: "Sends" });
  await expect(sends.getByRole("row").filter({ hasText: "Re: Refund question" })).toBeVisible();
  for (const l of [status, stop, sends]) {
    await expect(l).toBeInViewport();
    expect((await l.boundingBox())?.y ?? 9999).toBeLessThan(800);
  }
  // P63: the landing holds no fact line; Setup holds them in rule 9's order.
  await expect(advanced(page)).toHaveCount(0);
  await expect(page.getByRole("button", { name: /^(Knowledge|Mail filters|Health)/ })).toHaveCount(0);
  await page.goto(SETUP);
  await expect(page.locator("#main li").getByText(/^(Setup|Mail filters|Health|Advanced)$/)).toHaveText(["Setup", "Mail filters", "Health", "Advanced"]);
  await expect(advanced(page)).toHaveAttribute("aria-expanded", "false");
  await expect(advanced(page)).toContainText("Safety rules: all");
  await expect(page.getByRole("switch")).toHaveCount(0); // the 18 switches are not in view
});

test("project: with no send there is no Sends table", async ({ page }) => {
  await sendsServer(page, { sends: [], stopped: [] });
  await page.goto(AT);
  await expect(page.getByRole("button", { name: "Stop sending" })).toBeVisible();
  await expect(page.getByRole("table", { name: "Sends" })).toHaveCount(0);
});

test("project: a rule that is off opens Advanced on Setup by itself and the summary names it", async ({ page }) => {
  expect((await setRule(page, "risky_word", false)).ok()).toBe(true);
  try {
    await page.goto(SETUP);
    await expect(advanced(page)).toHaveAttribute("aria-expanded", "true");
    await expect(advanced(page)).toContainText("Risky words is off");
    await expect(page.getByRole("switch", { name: "Risky words" })).toHaveAttribute("aria-checked", "false");
  } finally {
    expect((await setRule(page, "risky_word", true)).ok()).toBe(true);
  }
  await page.reload();
  await expect(advanced(page)).toHaveAttribute("aria-expanded", "false");
});

test("project: a rule switch writes once and reports a refusal inline, in an alert", async ({ page }) => {
  let asked = 0;
  await page.route(/\/api\/safety-rules\//, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    asked += 1;
    return route.fulfill({ status: 409, json: { error: "Rules are locked in this test.", code: "wrong_state" } });
  });
  await page.goto(SETUP);
  await advanced(page).click();
  const first = page.getByRole("switch").first();
  const before = await first.getAttribute("aria-checked");
  await first.click();
  await expect(page.getByRole("alert").filter({ hasText: "Rules are locked in this test." })).toBeVisible();
  expect(asked).toBe(1);
  await expect(first).toHaveAttribute("aria-checked", before ?? "true");
});

test("project: Cancel exists only on a queued send, and the row reads cancelled after", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [queued, sent], stopped: [] });
  await page.goto(AT);
  const table = page.getByRole("table", { name: "Sends" });
  await expect(table.locator("tr[data-send]")).toHaveCount(2);
  await expect(table.getByRole("button", { name: /^Cancel send/ })).toHaveCount(1); // a sent mail cannot be recalled
  await expect(table.locator('tr[data-send="3"]')).toContainText("goes out");
  await table.getByRole("button", { name: "Cancel send 3: Re: Order status" }).click();
  await expect(table.locator('tr[data-send="3"]')).toContainText("cancelled");
  await expect(table.getByRole("button", { name: /^Cancel send/ })).toHaveCount(0);
  expect(writes).toEqual(["cancel 3"]);
  // The subject leads to the draft the send came from.
  await expect(table.getByRole("link", { name: "Re: Refund question" })).toHaveAttribute("href", `/${PROJECT}/drafts/8`);
});

test("project: Stop sending asks inline for the scope, Keep sending backs out, Stop all halts every project and Resume lifts it", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [queued], stopped: [] });
  await page.goto(AT);
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
  const resume = page.getByRole("button", { name: "Resume every project" });
  await expect(resume).toBeVisible();
  expect(writes).toEqual(["stop *"]);
  await resume.click();
  await expect(page.getByRole("button", { name: "Stop sending" })).toBeVisible();
  expect(writes).toEqual(["stop *", "resume *"]);
});

test("project: Stop sending for one project, then Resume that project", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [], stopped: [] });
  await page.goto(AT);
  await page.getByRole("button", { name: "Stop sending" }).click();
  await page.getByRole("group", { name: "Stop sending" }).getByRole("button", { name: "Stop sending" }).click();
  await page.getByRole("button", { name: `Resume ${PROJECT}` }).click();
  await expect(page.getByRole("button", { name: "Stop sending" })).toBeVisible();
  expect(writes).toEqual([`stop ${PROJECT}`, `resume ${PROJECT}`]);
});
