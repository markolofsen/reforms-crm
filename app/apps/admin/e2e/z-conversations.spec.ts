import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { writeSendPolicy } from "./send-policy";
import { at, cardOf, cards, contextWarn, remember, viewMenu } from "./support";

// P99 S2 and S3: Mail lists people. A Mark-Effect-like client (two threads, "Re: Hello" finished and "Re: Wow" with an open draft,
// recorded the way the agent records them, `hub record-draft`) is ONE row; opening it shows both threads with a divider each, his
// messages and ours, and the unsent message at the bottom. The e2e run reads no Mail (fake Mailer), so the pane's Mail read is
// answered with a Mark-Effect-like history (the shape the server's AppleScript read returns). Named z-* because it records drafts.
test.describe.configure({ mode: "serial" });

const P = "demo-shop";
const EMAIL = "mark.effect@example.test";
const NAME = "Mark Effect";
const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-conv-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, P), { recursive: true });
contextWarn(join(projects, P, "project.md"));
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", P);
const record = (payload: object) =>
  JSON.parse(execFileSync("node", [hub, "record-draft", "--project", P], { input: JSON.stringify(payload), env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, NO_COLOR: "1" }, encoding: "utf8" })) as { ok: boolean; action: string; draftId: number };

const msg = (id: string, ours: boolean, date: string, subject: string, preview: string) => ({ messageId: id, ours, fromName: ours ? "" : NAME, fromEmail: ours ? "demo-shop@example.test" : EMAIL, date, subject, draftId: null, preview });
const HISTORY = {
  source: "mail",
  note: null,
  ms: 865,
  earlier: 0,
  threads: [
    {
      key: "hello-0@example.test",
      subject: "Re: Hello",
      brand: "Carapis",
      ourFrom: "demo-shop@example.test",
      messages: [msg("hello-0@example.test", false, "2026-11-14T08:00:00.000Z", "Hello", "How are you? There is a new request"), msg("hello-1@example.test", true, "2026-11-19T14:15:38.000Z", "Re: Hello", "Hi my friend, I read your letter"), msg("hello-2@example.test", false, "2026-11-19T16:00:00.000Z", "Re: Hello", "Thanks. Could you send the documents?")],
    },
    {
      key: "wow-0@example.test",
      subject: "Re: Wow",
      brand: "CMDOP",
      ourFrom: "demo-shop@example.test",
      messages: [msg("wow-0@example.test", false, "2026-11-19T18:00:00.000Z", "Wow", "How are you?"), msg("wow-1@example.test", true, "2026-11-20T15:50:08.000Z", "Re: Wow", "A lonely sail is gleaming white"), msg("wow-2@example.test", false, "2026-11-21T01:23:06.000Z", "Re: Wow", "Are you there? Send the offer")],
    },
  ],
};

async function mailHistory(page: Page) {
  await page.route(/\/api\/projects\/[^/]+\/clients\/\d+\/conversation\/mail$/, (route) => route.fulfill({ json: HISTORY }));
  await page.route(/\/api\/projects\/[^/]+\/clients\/\d+\/conversation\/text\?/, (route) => route.fulfill({ json: { text: "Are you there? Send the offer", quoted: false, note: null } }));
}
const row = (page: Page) => cards(page).filter({ hasText: NAME });
const status = (page: Page, project: string, id: number, s: string) => page.request.post(`/api/drafts/${id}/status`, { data: { project, status: s } });
let open = 0;

test.beforeEach(async ({ page }) => {
  await remember(page, P);
  await mailHistory(page);
});

test("a client with two threads is one row, Draft ready, the newest thread's subject", async ({ page }) => {
  const hello = record({ email: EMAIL, name: NAME, subject: "Re: Hello", mailRef: "<hello-2@example.test>", excerpt: "Here are the documents.", reason: "He asked for the documents.", repliesOwed: true, skill: "triage-mail" });
  expect(hello).toMatchObject({ ok: true, action: "created" });
  expect((await status(page, P, hello.draftId, "done")).ok()).toBe(true);
  const wow = record({ email: EMAIL, name: NAME, subject: "Re: Wow", mailRef: "<wow-2@example.test>", excerpt: "Yes, I am here. The offer follows.", reason: "He asked for the offer.", repliesOwed: true, skill: "triage-mail" });
  expect(wow).toMatchObject({ ok: true, action: "created" });
  open = wow.draftId;

  for (const view of ["", "?filter=all"]) {
    await page.goto(at(P, `/mail${view}`));
    await expect(row(page)).toHaveCount(1);
    await expect(row(page).getByTestId("person-state")).toHaveText("Draft ready");
    await expect(row(page).getByTestId("person-subject")).toContainText("Re: Wow");
  }
});

test("opening the row shows both threads with dividers, his messages and ours in order, and the unsent message at the bottom", async ({ page }) => {
  await page.goto(at(P, "/mail?filter=all"));
  await row(page).getByRole("button").first().click();
  const pane = page.getByTestId("conversation");
  await expect(pane).toHaveAttribute("aria-label", `Conversation with ${NAME}`);
  await expect(pane.getByTestId("conversation-state")).toHaveText("Draft ready");
  const dividers = pane.getByTestId("thread-divider");
  await expect(dividers).toHaveCount(2);
  await expect(dividers.nth(0)).toContainText("Re: Hello");
  await expect(dividers.nth(0)).toContainText("Carapis");
  await expect(dividers.nth(1)).toContainText("Re: Wow");
  await expect(dividers.nth(1)).toContainText("CMDOP");
  const messages = pane.getByTestId("history-message");
  await expect(messages).toHaveCount(6);
  expect(await messages.evaluateAll((els) => els.map((e) => e.getAttribute("data-ours")))).toEqual(["false", "true", "false", "false", "true", "false"]);
  // The newest of his is open: its text read on demand.
  await expect(messages.nth(5).getByTestId("message-text")).toContainText("Are you there? Send the offer");
  // One unsent message, under the last thing he said.
  const card = cardOf(page, NAME);
  await expect(card).toHaveCount(1);
  const last = await messages.nth(5).boundingBox();
  const unsent = await card.boundingBox();
  expect(last && unsent && unsent.y > last.y, "the unsent message sits below the history").toBe(true);
  expect(page.url()).toMatch(new RegExp(`/${P}/mail/c/\\d+\\?filter=all$`));
});

test("the state word follows each view: Needs you holds Wrote you and Draft ready, Waiting holds Waiting for them, All every word", async ({ page }) => {
  const words = async () => cards(page).getByTestId("person-state").allTextContents();
  await page.goto(at(P, "/mail"));
  await expect(viewMenu(page)).toContainText("Needs you");
  await expect(row(page)).toHaveCount(1);
  for (const w of await words()) expect(["Wrote you", "Draft ready"]).toContain(w);
  // The seeded client who wrote and has no draft (the Mail reader's row) is Wrote you.
  await expect(cards(page).filter({ hasText: "Lea Sample" }).getByTestId("person-state")).toHaveText("Wrote you");

  // Done on the open draft: he leaves Needs you, and All says Done (our last word was never sent, so not Waiting).
  expect((await status(page, P, open, "done")).ok()).toBe(true);
  await page.reload();
  await expect(cards(page).first()).toBeVisible();
  await expect(row(page)).toHaveCount(0);
  await page.goto(at(P, "/mail?filter=all"));
  await expect(row(page).getByTestId("person-state")).toHaveText("Done");
  await expect(cards(page).filter({ hasText: "Kim Placeholder" }).getByTestId("person-state")).toHaveText("On hold");

  // Waiting: the seeded client we wrote to (lisbon-realty's Tiago, sent 25 days ago) and only that word.
  await remember(page, "lisbon-realty");
  await page.goto(at("lisbon-realty", "/mail?filter=waiting"));
  await expect(cards(page).filter({ hasText: "Tiago Amostra" })).toHaveCount(1);
  for (const w of await words()) expect(w).toBe("Waiting for them");
});
