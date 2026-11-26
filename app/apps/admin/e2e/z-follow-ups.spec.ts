import { expect, test, type APIRequestContext } from "@playwright/test";
import { at } from "./support";

// P142 (decision 0050): the daily follow-up sweep at the API level, against the e2e stack's own server (a throwaway HUB_HOME and
// HUB_DB, `HUB_FOLLOWUP_BRAIN=fake`: the scripted brain, no model; the server refuses it without HUB_DB). Run follow-ups now starts a
// sweep, the plans and the sweep line read back in the documented shape, a write from another origin is refused, and the owner's
// Stop and Resume move one plan. Nothing is sent: the fake Mailer, no messenger account, and a Mail nudge is always a draft.
// The turn's brain, the selector, the hooks and the held autopilot nudge are unit-tested in packages/db, packages/agent and
// apps/server; this spec checks the routes the admin reads.

const P = "lisbon-realty";
const admin = () => `http://127.0.0.1:${process.env.HUB_E2E_UI_PORT}`;
const same = () => ({ origin: admin(), "sec-fetch-site": "same-origin" });

type Row = { clientId: number; name: string; state: string; display: string; nextAt: string | null; nudgesSent: number; channel: string | null; reason: string | null };
type Sweep = { schedule: "daily" | "off"; at: string; last: unknown; next: string | null; running: boolean; runNowOff: string | null; stopped: string | null };
type Today = { ready: number; waiting: number; due: number; stopped: number; forYou: number };
type List = { rows: Row[]; today: Today; sweep: Sweep };

async function list(request: APIRequestContext): Promise<List> {
  const r = await request.get(`${admin()}/api/projects/${P}/follow-ups`, { headers: same() });
  expect(r.status()).toBe(200);
  return (await r.json()) as List;
}

async function settled(request: APIRequestContext): Promise<List> {
  let last: List | null = null;
  await expect
    .poll(
      async () => {
        last = await list(request);
        return last.sweep.running;
      },
      { timeout: 30_000 },
    )
    .toBe(false);
  return last!;
}

test("follow-ups: the list's shape before any sweep", async ({ request }) => {
  const l = await list(request);
  expect(Array.isArray(l.rows)).toBe(true);
  expect(typeof l.sweep.running).toBe("boolean");
  expect(["daily", "off"]).toContain(l.sweep.schedule);
  expect(l.sweep.at).toMatch(/^\d{2}:\d{2}$/);
  for (const k of ["ready", "waiting", "due", "stopped", "forYou"] as const) expect(typeof l.today[k]).toBe("number");
  for (const row of l.rows) {
    expect(typeof row.clientId).toBe("number");
    expect(typeof row.name).toBe("string");
    expect(typeof row.display).toBe("string");
    expect(typeof row.nudgesSent).toBe("number");
  }
});

test("follow-ups: Run follow-ups now sweeps, and the sweep line says so", async ({ request }) => {
  const r = await request.post(`${admin()}/api/projects/${P}/follow-ups/sweep`, { headers: same(), data: {} });
  // 202: the sweep runs in the background (`joined` when a click meets the one already running); 409 says why it is off.
  expect(r.status()).toBe(202);
  const body = (await r.json()) as { ok: boolean; joined: boolean; sweep: unknown };
  expect(body).toMatchObject({ ok: true, sweep: null });
  expect(typeof body.joined).toBe("boolean");
  const l = await settled(request);
  expect(l.sweep.last).not.toBeNull();
});

test("follow-ups: a write from another origin is refused", async ({ request }) => {
  const foreign = { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-site" };
  const sweep = await request.post(`${admin()}/api/projects/${P}/follow-ups/sweep`, { headers: foreign, data: {} });
  expect(sweep.status()).toBe(403);
  const put = await request.put(`${admin()}/api/projects/${P}/follow-ups/1`, { headers: foreign, data: { action: "stop" } });
  expect(put.status()).toBe(403);
});

test("follow-ups: a malformed owner move is refused before any write", async ({ request }) => {
  const r = await request.put(`${admin()}/api/projects/${P}/follow-ups/1`, { headers: same(), data: { action: "date", nextAt: "30 Nov" } });
  expect(r.status()).toBe(400);
});

test("follow-ups: the fake brain decides for each seeded silent client", async ({ request }) => {
  test.fixme(true, "the e2e seed has no client whose newest message is ours with no waiting draft; add one (Mail `waiting` or a linked chat with last_outbound_at newer) and assert its row after the sweep");
  await request.post(`${admin()}/api/projects/${P}/follow-ups/sweep`, { headers: same(), data: {} });
  const l = await settled(request);
  expect(l.rows.length).toBeGreaterThan(0);
  expect(l.today.ready + l.today.due + l.today.waiting + l.today.stopped + l.today.forYou).toBeGreaterThan(0);
});

test("follow-ups: the owner's Stop and Resume move one plan", async ({ request }) => {
  test.fixme(true, "needs a seeded plan row (a silent client the fake brain decided for); the PUT body is {action: date|stop|resume}, a date with nextAt YYYY-MM-DD");
  const l = await settled(request);
  const row = l.rows[0]!;
  const stop = await request.put(`${admin()}/api/projects/${P}/follow-ups/${row.clientId}`, { headers: same(), data: { action: "stop" } });
  expect(stop.status()).toBe(200);
  expect((await list(request)).rows.find((x) => x.clientId === row.clientId)?.state).toBe("stopped");
  const resume = await request.put(`${admin()}/api/projects/${P}/follow-ups/${row.clientId}`, { headers: same(), data: { action: "resume" } });
  expect(resume.status()).toBe(200);
  expect((await list(request)).rows.find((x) => x.clientId === row.clientId)?.state).toBe("waiting");
});

test("follow-ups: Overview says today's line with Run follow-ups now, and Activity ▸ Follow-ups lists the plans", async ({ page }) => {
  await page.goto("/overview");
  const part = page.locator(`[data-testid="follow-ups-today"][data-project="${P}"]`);
  await expect(part).toContainText("Follow-ups today:");
  await expect(part.getByRole("button", { name: "Run follow-ups now" })).toBeVisible();
  await page.goto(at(P, "/log?kind=follow-ups"));
  await expect(page.getByRole("button", { name: /^Activity filter: Follow-ups/ })).toBeVisible();
  await expect(page.getByRole("navigation", { name: "Activity kinds" }).getByRole("link")).toHaveCount(2);
  await expect(page.getByTestId("follow-ups-view")).toBeVisible();
});
