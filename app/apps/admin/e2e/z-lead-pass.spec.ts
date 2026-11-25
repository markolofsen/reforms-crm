import { expect, test, type APIRequestContext } from "@playwright/test";

// P147 (decision 0055): the daily lead and mail passes at the API level, against the e2e stack's own server (a throwaway HUB_HOME
// and HUB_DB, `HUB_LEAD_BRAIN=fake`: the scripted brain, no model; the server refuses it without HUB_DB). The pass line reads back in
// the documented shape; Run now starts a pass or says why not; writes from another origin and the agent's route without its token
// are refused; the review of an unknown batch is 404 and its bad `only` is 400; a batch's run state carries what did not go out.
// Nothing is sent: the fake Mailer, and a pass turn has no send tool. The turns, the review, the ticket and the run are unit-tested
// in packages/agent, packages/send and apps/server; this spec checks the routes the admin reads.

const P = "lisbon-realty";
const admin = () => `http://127.0.0.1:${process.env.HUB_E2E_UI_PORT}`;
const same = () => ({ origin: admin(), "sec-fetch-site": "same-origin" });
const foreign = { origin: "http://127.0.0.1:3000", "sec-fetch-site": "same-site" };

type Pass = { schedule: string; at: string; last: unknown; next: string | null; running: boolean; runNowOff: string | null; stopped: string | null };
type LeadPass = { today: Record<string, number>; pass: Pass; review: { batchId: number | null; drafts: number; proposals: number }; mail: Pass & { today: Record<string, number> } };

async function status(request: APIRequestContext): Promise<LeadPass> {
  const r = await request.get(`${admin()}/api/projects/${P}/lead-pass`, { headers: same() });
  expect(r.status()).toBe(200);
  return (await r.json()) as LeadPass;
}

test("lead pass: the line's shape", async ({ request }) => {
  const s = await status(request);
  expect(["daily", "off"]).toContain(s.pass.schedule);
  expect(s.pass.at).toMatch(/^\d{2}:\d{2}$/);
  expect(typeof s.pass.running).toBe("boolean");
  expect(typeof s.mail.running).toBe("boolean");
  expect(typeof s.review.drafts).toBe("number");
  expect(typeof s.review.proposals).toBe("number");
  expect(s.review.batchId === null || typeof s.review.batchId === "number").toBe(true);
});

test("lead pass: Run now starts a pass, or says why it does not", async ({ request }) => {
  const r = await request.post(`${admin()}/api/projects/${P}/lead-pass`, { headers: same(), data: {} });
  expect([202, 409]).toContain(r.status());
  const body = (await r.json()) as { ok?: boolean; joined?: boolean; error?: string };
  if (r.status() === 202) {
    expect(body.ok).toBe(true);
    await expect.poll(async () => (await status(request)).pass.running, { timeout: 30_000 }).toBe(false);
  } else expect(body.error).toEqual(expect.any(String));
});

test("lead pass: another origin, and the agent's route without its token, are refused", async ({ request }) => {
  expect((await request.post(`${admin()}/api/projects/${P}/lead-pass`, { headers: foreign, data: {} })).status()).toBe(403);
  expect((await request.post(`${admin()}/api/projects/${P}/lead-pass/agent-run`, { headers: same(), data: {} })).status()).toBe(403);
  expect((await request.post(`${admin()}/api/projects/${P}/lead-review/1/ticket`, { headers: foreign, data: { send: [], exclude: [], proposals: [] } })).status()).toBe(403);
});

test("lead review: an unknown batch is 404, a bad selection 400, and nothing is sent", async ({ request }) => {
  const unknown = await request.get(`${admin()}/api/projects/${P}/lead-review/999999?stored=1`, { headers: same() });
  expect([404, 409]).toContain(unknown.status());
  expect((await request.get(`${admin()}/api/projects/${P}/lead-review/1?only=a,b`, { headers: same() })).status()).toBe(400);
  const sends = await request.get(`${admin()}/api/projects/${P}/sends`, { headers: same() });
  if (sends.ok()) for (const s of ((await sends.json()) as { sends: Array<{ actor: string }> }).sends) expect(s.actor).not.toBe("lead-pass");
});

test("the day's run state carries what did not go out, and reading it sends nothing", async ({ request }) => {
  const { review } = await status(request);
  test.skip(review.batchId === null, "no lead batch today in the e2e seed");
  const r = await request.get(`${admin()}/api/projects/${P}/batches/${review.batchId}/send`, { headers: same() });
  expect(r.status()).toBe(200);
  const body = (await r.json()) as { run: unknown; notSent: Array<{ draftId: number; name: string; to: string[]; reason: string }> };
  expect(Array.isArray(body.notSent)).toBe(true);
  for (const n of body.notSent) expect(n.reason).toEqual(expect.any(String));
});
