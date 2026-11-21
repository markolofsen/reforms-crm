import { expect, test, type Page } from "@playwright/test";
import { remember } from "./support";

// Settings ▸ Sending by frequency (P70, `admin-principles.md` rule 9; the Project landing and its Setup page until then): the
// sentence and Stop sending first, then Send to and Autosend read only with the owner's command; nothing else. The checks before
// sending are their own pane, Settings ▸ Checks (P75): every rule in view, grouped by level, nothing folded. Controls only: the send
// history is Activity ▸ Sends (UX pass 2026-11-20), tested here too. The sends are held in this file (a queued send exists only with autosend, which the e2e server
// does not run; Stop all is exercised for real in `z-send.spec.ts`). Two projects, so the address names the project first.
const PROJECT = "lisbon-realty";
const AT = `/${PROJECT}/settings`;
const CHECKS = `/${PROJECT}/settings/checks`;
const SENDS = `/${PROJECT}/log?filter=sends`;
const API = () => `http://127.0.0.1:${process.env.HUB_E2E_API_PORT}`;

test.beforeEach(async ({ page }) => {
  await remember(page, PROJECT);
});

type Row = { id: number; draftId: number | null; clientId: number | null; channel: "mail"; messengerDraftId: null; mode: "auto" | "manual"; status: "queued" | "sent" | "failed" | "cancelled" | "sending"; actor: string; createdAt: string; dueAt: string | null; doneAt: string | null; toAddr: string; ccAddr: string | null; subject: string; body: string; error: string | null };
const queued: Row = { id: 3, draftId: 9, clientId: 19, channel: "mail", messengerDraftId: null, mode: "auto", status: "queued", actor: "auto", createdAt: "2026-11-15T10:00:00.000Z", dueAt: "2026-11-15T10:10:00.000Z", doneAt: null, toAddr: "ana@example.com", ccAddr: null, subject: "Re: Order status", body: "Hello Ana", error: null };
const sent: Row = { id: 2, draftId: 8, clientId: 18, channel: "mail", messengerDraftId: null, mode: "manual", status: "sent", actor: "admin", createdAt: "2026-11-14T09:00:00.000Z", dueAt: null, doneAt: "2026-11-14T09:00:02.000Z", toAddr: "bo@example.com", ccAddr: "mark@example.org", subject: "Re: Refund question", body: "Hello Bo", error: null };

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

const checksStatus = (page: Page) => page.getByTestId("checks-status");
/** A rule set through the API, as the agent or another tab would; the test puts it back after. */
const setRule = (page: Page, kind: string, enabled: boolean) => page.request.put(`${API()}/api/safety-rules/${kind}`, { data: { project: PROJECT, enabled } });

test("sending: the first viewport at 1280 shows the sentence and Stop sending; then Send to and Autosend only; no fold, no send history", async ({ page }) => {
  await sendsServer(page, { sends: [sent], stopped: [] });
  await page.goto(AT);
  const status = page.getByTestId("sending-status");
  await expect(status).toHaveText(/\S/);
  // Test mode is a setting: the Send to line says it, the sentence does not say it again (UX pass).
  await expect(status).not.toContainText("Test mode");
  const stop = page.getByRole("button", { name: "Stop sending" });
  for (const l of [status, stop]) {
    await expect(l).toBeInViewport();
    expect((await l.boundingBox())?.y ?? 9999).toBeLessThan(800);
  }
  // Rule 9's order, the policy read only with the owner's own command (P70 Q1: no switch for it here).
  await expect(page.locator("#main li").getByText(/^(Send to|Autosend|Checks)$/)).toHaveText(["Send to", "Autosend"]);
  await expect(page.getByTestId("send-to")).toContainText(`./run.sh send policy set ${PROJECT} draft.recipients`);
  await expect(page.getByTestId("send-to").getByRole("button", { name: /^Copy/ })).toBeVisible();
  // P75: the rules left for Settings ▸ Checks, and nothing on Sending opens or closes.
  await expect(page.getByRole("switch")).toHaveCount(0);
  await expect(page.locator("#main [aria-expanded]:visible")).toHaveCount(0);
  // The setup facts are no longer here: health is Overview's, the filters are Mail's; the sends are Activity's.
  await expect(page.getByRole("button", { name: /^(Health|Mail filters|Advanced)/ })).toHaveCount(0);
  await expect(page.getByRole("table", { name: "Sends" })).toHaveCount(0);
});

test("activity ▸ sends: the history is a view of Activity's View menu with its count; none yet says so", async ({ page }) => {
  await sendsServer(page, { sends: [], stopped: [] });
  await page.goto(`/${PROJECT}/log`);
  await page.getByRole("button", { name: /^View: All/ }).click();
  await page.getByRole("menuitemradio", { name: /^Sends/ }).click();
  await expect.poll(() => new URL(page.url()).pathname + new URL(page.url()).search).toBe(SENDS);
  await expect(page.getByText("No sends yet")).toBeVisible();
  await expect(page.getByRole("table", { name: "Sends" })).toHaveCount(0);
});

test("checks: every rule in view, grouped Blocks Send then Warns, each with its switch; the words and the days inline; nothing folded", async ({ page }) => {
  await page.goto(CHECKS);
  await expect(page).toHaveTitle(`Checks · ${PROJECT} · Hub Workflow`);
  await expect(page.getByRole("navigation", { name: "Settings pages" }).getByRole("link", { name: "Checks", exact: true })).toHaveAttribute("aria-current", "page");
  await expect(checksStatus(page)).toHaveText(/^All \d+ on$/);
  const table = page.getByRole("table", { name: "Checks before sending" });
  const rules = table.locator("tr[data-rule]");
  const count = await rules.count();
  expect(count).toBeGreaterThan(10);
  await expect(table.getByRole("switch")).toHaveCount(count);
  await expect(table.getByLabel("Risky words, separated by commas")).toBeVisible();
  await expect(table.getByRole("textbox", { name: /Within/ })).toBeVisible();
  // The level is the group, said once: two headings in this order, no badge per row.
  await expect(table.locator("tr[data-level-head]")).toHaveText([/^Blocks Send/, /^Warns/]);
  await expect(table.getByText(/^(Red|Amber)$/)).toHaveCount(0);
  await expect(page.locator("#main [aria-expanded]:visible")).toHaveCount(0);
  await page.reload();
  await expect(table.locator("tr[data-rule]")).toHaveCount(count);
});

test("checks: a rule that is off is named in the sentence and shows off, in words not colours", async ({ page }) => {
  expect((await setRule(page, "risky_word", false)).ok()).toBe(true);
  try {
    await page.goto(CHECKS);
    await expect(checksStatus(page)).toContainText("Risky words is off");
    await expect(page.getByRole("switch", { name: "Risky words" })).toHaveAttribute("aria-checked", "false");
  } finally {
    expect((await setRule(page, "risky_word", true)).ok()).toBe(true);
  }
  await page.reload();
  await expect(checksStatus(page)).toHaveText(/^All \d+ on$/);
});

test("checks: a rule switch writes once and reports a refusal inline, in an alert", async ({ page }) => {
  let asked = 0;
  await page.route(/\/api\/safety-rules\//, (route) => {
    if (route.request().method() !== "PUT") return route.fallback();
    asked += 1;
    return route.fulfill({ status: 409, json: { error: "Rules are locked in this test.", code: "wrong_state" } });
  });
  await page.goto(CHECKS);
  const first = page.getByRole("switch").first();
  const before = await first.getAttribute("aria-checked");
  await first.click();
  await expect(page.getByRole("alert").filter({ hasText: "Rules are locked in this test." })).toBeVisible();
  expect(asked).toBe(1);
  await expect(first).toHaveAttribute("aria-checked", before ?? "true");
});

test("activity ▸ sends: Cancel exists only on a queued send, and the row reads cancelled after", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [queued, sent], stopped: [] });
  await page.goto(SENDS);
  const table = page.getByRole("table", { name: "Sends" });
  await expect(table.locator("tr[data-send]")).toHaveCount(2);
  await expect(table.getByRole("button", { name: /^Cancel send/ })).toHaveCount(1); // a sent mail cannot be recalled
  await expect(table.locator('tr[data-send="3"]')).toContainText("goes out");
  await table.getByRole("button", { name: "Cancel send 3: Re: Order status" }).click();
  await expect(table.locator('tr[data-send="3"]')).toContainText("cancelled");
  await expect(table.getByRole("button", { name: /^Cancel send/ })).toHaveCount(0);
  expect(writes).toEqual(["cancel 3"]);
  // P99: the subject leads to the conversation of the draft's client.
  await expect(table.getByRole("link", { name: "Re: Refund question" })).toHaveAttribute("href", `/${PROJECT}/mail/c/18`);
});

test("sending: Stop sending asks inline for the scope, Keep sending backs out, Stop all halts every project and Resume lifts it", async ({ page }) => {
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

test("sending: Stop sending for one project, then Resume that project", async ({ page }) => {
  const writes = await sendsServer(page, { sends: [], stopped: [] });
  await page.goto(AT);
  await page.getByRole("button", { name: "Stop sending" }).click();
  await page.getByRole("group", { name: "Stop sending" }).getByRole("button", { name: "Stop sending" }).click();
  await page.getByRole("button", { name: `Resume ${PROJECT}` }).click();
  await expect(page.getByRole("button", { name: "Stop sending" })).toBeVisible();
  expect(writes).toEqual([`stop ${PROJECT}`, `resume ${PROJECT}`]);
});
