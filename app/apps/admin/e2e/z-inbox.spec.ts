import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { writeSendPolicy } from "./send-policy";
import { address, at, remember } from "./support";

// P96: Mail ▸ Inbox, the clients who wrote and have no draft yet, as the server's Mail reader stored them (the seed holds two for
// demo-shop: the e2e run reads no Mail, its Mailer is fake). The arrival moves to Inbox; a row opens the client's message; Prepare
// reply pastes the request into the agent's dock without Enter (the fake shell echoes a line only after Enter); No reply needed
// closes the client with Undo. Named z-* because it starts a terminal session and writes a dismissal (undone at the end).
test.describe.configure({ mode: "serial" });

const P = "demo-shop";
// P98: a draft recorded the way the agent records one (`hub record-draft`, as z-record-draft does), so the open card must change live.
const hub = fileURLToPath(new URL("../../installer/bin/hub.mjs", import.meta.url));
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-inbox-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, P), { recursive: true });
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", P);
const record = (payload: object) =>
  JSON.parse(execFileSync("node", [hub, "record-draft", "--project", P], { input: JSON.stringify(payload), env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, NO_COLOR: "1" }, encoding: "utf8" })) as { ok: boolean; action: string; draftId: number };
const rows = (page: Page) => page.getByTestId("inbound-row");
const screenText = (page: Page) =>
  page.getByRole("tabpanel").locator(".xterm-rows").evaluate((el) => [...el.children].map((r) => (r.textContent ?? "").replace(/\u00a0/g, " ")).join(""));

async function endAll(page: Page) {
  const res = await page.request.get("/api/terminal");
  for (const s of ((await res.json()) as { sessions: { id: string }[] }).sessions) await page.request.delete(`/api/terminal/sessions/${encodeURIComponent(s.id)}`);
}

test.beforeEach(async ({ page }) => {
  await remember(page, P);
});
test.afterAll(async ({ request }) => {
  const res = await request.get("/api/terminal");
  for (const s of ((await res.json()) as { sessions: { id: string }[] }).sessions) await request.delete(`/api/terminal/sessions/${encodeURIComponent(s.id)}`);
});

test("inbox: the arrival opens Inbox, the clients who wrote with their first words; the status line and the nav count them", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await expect.poll(() => address(page)).toBe(at(P, "/mail?filter=inbox"));
  await expect(rows(page)).toHaveCount(2);
  await expect(rows(page).first()).toContainText("Lea Sample");
  await expect(rows(page).first()).toContainText("Re: Your order");
  await expect(rows(page).first().getByTestId("inbound-preview")).toContainText("Thank you, that works for me.");
  await expect(page.getByTestId("status-line")).toContainText("2 clients wrote");
  // Demo mode: the reader is off and says why, never "read just now".
  await expect(page.getByTestId("inbound-read")).toContainText("Demo mode: Mail is not read");
  await expect(page.getByRole("navigation", { name: "Sections" }).first().getByTestId("nav-count-mail")).toContainText("2");
  // The View menu counts Inbox like any view: the two clients and, since P97, the two seeded New leads.
  await page.getByRole("button", { name: /^View:/ }).click();
  await expect(page.getByRole("menuitemradio", { name: /^Inbox/ })).toContainText("4");
  await page.keyboard.press("Escape");
});

test("inbox: a row opens the client's message; Prepare reply pastes the request into the dock, and nothing runs before Enter", async ({ page }) => {
  await endAll(page);
  await page.goto(at(P, "/mail?filter=inbox"));
  await rows(page).filter({ hasText: "Lea Sample" }).getByRole("link").click();
  await expect.poll(() => address(page)).toMatch(new RegExp(`^/${P}/mail/in/\\d+\\?filter=inbox$`));
  const card = page.getByTestId("inbound-card");
  await expect(card).toContainText("lea@example.test");
  await expect(card.getByTestId("inbound-text")).toContainText("Thank you, that works for me.");
  await card.getByRole("button", { name: "Prepare reply" }).click();
  await expect.poll(() => screenText(page), { timeout: 20_000 }).toContain(`handle the mail from lea@example.test (Re: Your order) in project ${P}`);
  // Pasted, not entered: the fake shell echoes "> <line>" only after Enter.
  expect(await screenText(page)).not.toContain("> handle the mail");
  await endAll(page);
});

test("inbox: No reply needed closes the client, and Undo brings them back", async ({ page }) => {
  await page.goto(at(P, "/mail?filter=inbox"));
  await rows(page).filter({ hasText: "Omar Test" }).getByRole("link").click();
  await page.getByTestId("inbound-card").getByRole("button", { name: "No reply needed" }).click();
  await expect(rows(page)).toHaveCount(1);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(rows(page)).toHaveCount(2);
});

test("P98: the clients who wrote come before New leads, and the status line keeps its height at 360, 768 and 1280", async ({ page }) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(at(P, "/mail?filter=inbox"));
    await expect(rows(page)).toHaveCount(2);
    const leads = page.getByTestId("leads-group");
    await expect(leads).toBeVisible();
    const firstRow = await rows(page).first().boundingBox();
    const group = await leads.boundingBox();
    expect(firstRow && group && firstRow.y < group.y, `${width}: clients above leads`).toBe(true);
    // Item 2: the line is never squeezed under its own content (it painted over "New leads" at 1280 with the dock open).
    const line = page.getByTestId("status-line");
    const fit = await line.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(fit, `${width}: status line fits its content`).toBeLessThanOrEqual(1);
  }
});

test("P98: a draft recorded for the open message turns its card into Draft ready live, and the client leaves Inbox", async ({ page }) => {
  await page.goto(at(P, "/mail?filter=inbox"));
  await rows(page).filter({ hasText: "Omar Test" }).getByRole("link").click();
  const card = page.getByTestId("inbound-card");
  await expect(card.getByRole("button", { name: "Prepare reply" })).toBeVisible();
  const { draftId } = record({ email: "omar@example.test", name: "Omar Test", subject: "Re: Question about sizes", mailRef: "<seed-in-omar@example.test>", excerpt: "Yes, the jacket comes in XL.", reason: "He asked about sizes.", repliesOwed: true, skill: "triage-mail" });
  // No reload: the live topic `drafts` refreshes the card's state (its Mail text is not read again).
  const answer = card.getByTestId("inbound-answer");
  await expect(answer).toContainText("Draft ready", { timeout: 15_000 });
  await expect(answer).toContainText("Yes, the jacket comes in XL.");
  await expect(card.getByRole("button", { name: "Prepare reply" })).toHaveCount(0);
  await expect(rows(page)).toHaveCount(1);
  await answer.getByRole("link", { name: "Open draft" }).click();
  await expect.poll(() => address(page)).toMatch(new RegExp(`^/${P}/mail/${draftId}(\\?|$)`));
});
