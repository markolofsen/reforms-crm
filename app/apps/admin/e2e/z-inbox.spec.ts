import { execFileSync } from "node:child_process";
import { cpSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath } from "node:url";
import { expect, test, type Page } from "@playwright/test";
import { writeSendPolicy } from "./send-policy";
import { address, at, cardOf, cards, contextWarn, remember, viewMenu } from "./support";

// P96, P99: the clients who wrote and have no draft yet, as the server's Mail reader stored them (the seed holds two for demo-shop:
// the e2e run reads no Mail, its Mailer is fake). Since P99 they are people in Mail's Needs you, the word Wrote you on their row;
// opening one shows the conversation (the Hub's own rows, demo mode), Prepare reply pastes the request into the agent's dock without
// Enter (the fake shell echoes a line only after Enter); No reply needed closes them with Undo. Named z-* because it starts a
// terminal session and writes a dismissal (undone at the end).
test.describe.configure({ mode: "serial" });

const P = "demo-shop";
// P98: a draft recorded the way the agent records one (the seeder of draft_write's writer, as z-record-draft does), so the open card must change live.
// P129 A3: `hub record-draft` is gone (the agent records through draft_write); flows seed a draft row with the same writer.
const seedDraft = fileURLToPath(new URL("../../installer/test/support/seed-draft.mjs", import.meta.url));
const projects = mkdtempSync(join(tmpdir(), "hub-e2e-inbox-"));
cpSync(fileURLToPath(new URL("../../../packages/projects/test/fixtures/projects/acme-travel", import.meta.url)), join(projects, P), { recursive: true });
contextWarn(join(projects, P, "project.md"));
writeSendPolicy(process.env.HUB_E2E_HOME ?? "", P);
const record = (payload: object) =>
  JSON.parse(execFileSync("node", [seedDraft, "--project", P], { input: JSON.stringify(payload), env: { ...process.env, HUB_HOME: process.env.HUB_E2E_HOME, HUB_DB: process.env.HUB_E2E_DB, HUB_PROJECTS: projects, NO_COLOR: "1" }, encoding: "utf8" })) as { ok: boolean; action: string; draftId: number };
const person = (page: Page, name: string) => cards(page).filter({ hasText: name });
const pane = (page: Page) => page.getByTestId("conversation");
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

test("inbox: the arrival is Needs you, the clients who wrote are its people with their first words; the nav counts them", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  // The default view carries no filter; the wide pane opens the first person in the address.
  await expect.poll(() => address(page)).toMatch(new RegExp(`^/${P}/mail/c/\\d+$`));
  await expect(viewMenu(page)).toContainText("Needs you");
  const lea = person(page, "Lea Sample");
  await expect(lea.getByTestId("person-state")).toHaveText("Wrote you");
  await expect(lea.getByTestId("person-subject")).toContainText("Re: Your order");
  await expect(lea.getByTestId("person-preview")).toContainText("Thank you, that works for me.");
  await expect(person(page, "Omar Test").getByTestId("person-state")).toHaveText("Wrote you");
  // P99 verdict 14: who wrote is the Needs you count of the View menu, not a number on the line; demo mode says why Mail is not read.
  await expect(page.getByTestId("status-line")).not.toContainText("wrote");
  await expect(page.getByTestId("status-line")).toContainText("Demo mode: Mail is not read");
  // P128 X0 (F5): the rail's badge is Mail's Needs you count, not who wrote (its own test below checks the number).
  await expect(page.getByRole("navigation", { name: "Sections" }).first().getByTestId("nav-count-mail")).toContainText("need you");
  await viewMenu(page).click();
  await expect(page.getByRole("menuitemradio", { name: /^Needs you/ })).toContainText(String(await cards(page).count()));
  await page.keyboard.press("Escape");
});

test("inbox: a row opens the conversation; Prepare reply pastes the request into the dock, and nothing runs before Enter", async ({ page }) => {
  await endAll(page);
  await page.goto(at(P, "/mail"));
  await person(page, "Lea Sample").getByRole("button").first().click();
  await expect.poll(() => address(page)).toMatch(new RegExp(`^/${P}/mail/c/\\d+$`));
  await expect(pane(page)).toContainText("lea@example.test");
  await expect(pane(page).getByTestId("conversation-state")).toHaveText("Wrote you");
  // Demo mode: the history is the Hub's own row of her message, its stored first words.
  await expect(pane(page).getByTestId("history-note")).toContainText("Demo mode");
  await expect(pane(page).getByTestId("conversation-history")).toContainText("Thank you, that works for me.");
  await pane(page).getByRole("button", { name: "Prepare reply" }).click();
  await expect.poll(() => screenText(page), { timeout: 20_000 }).toContain(`handle the mail from lea@example.test (Re: Your order) in project ${P}`);
  // Pasted, not entered: the fake shell echoes "> <line>" only after Enter.
  expect(await screenText(page)).not.toContain("> handle the mail");
  await endAll(page);
});

test("inbox: No reply needed closes the client, and Undo brings them back", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await person(page, "Omar Test").getByRole("button").first().click();
  await pane(page).getByRole("button", { name: "No reply needed" }).click();
  await expect(person(page, "Omar Test")).toHaveCount(0);
  // The toast's Undo; the reply composer of the next person has its own (text) Undo.
  await page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Undo" }).click();
  await expect(person(page, "Omar Test")).toHaveCount(1);
});

test("P98: the people come before New leads, and the status line keeps its height at 360, 768 and 1280", async ({ page }) => {
  for (const width of [360, 768, 1280]) {
    await page.setViewportSize({ width, height: 800 });
    await page.goto(at(P, "/mail"));
    await expect(person(page, "Lea Sample")).toHaveCount(1);
    const leads = page.getByTestId("leads-group");
    await expect(leads).toBeVisible();
    const firstRow = await cards(page).first().boundingBox();
    const group = await leads.boundingBox();
    expect(firstRow && group && firstRow.y < group.y, `${width}: people above leads`).toBe(true);
    // Item 2: the line is never squeezed under its own content (it painted over "New leads" at 1280 with the dock open).
    const line = page.getByTestId("status-line");
    const fit = await line.evaluate((el) => el.scrollHeight - el.clientHeight);
    expect(fit, `${width}: status line fits its content`).toBeLessThanOrEqual(1);
  }
});

test("P98: a draft recorded for their message turns the conversation into Draft ready live, its unsent message at the bottom", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await person(page, "Omar Test").getByRole("button").first().click();
  await expect(pane(page).getByRole("button", { name: "Prepare reply" })).toBeVisible();
  const at0 = await address(page);
  record({ email: "omar@example.test", name: "Omar Test", subject: "Re: Question about sizes", mailRef: "<seed-in-omar@example.test>", excerpt: "Yes, the jacket comes in XL.", reason: "He asked about sizes.", repliesOwed: true, skill: "triage-mail" });
  // No reload: the live topic `drafts` refreshes the row and the pane (Mail is not read again).
  await expect(pane(page).getByTestId("conversation-state")).toHaveText("Draft ready", { timeout: 15_000 });
  await expect(person(page, "Omar Test").getByTestId("person-state")).toHaveText("Draft ready");
  await expect(cardOf(page, "Omar Test")).toBeVisible();
  await expect(pane(page).getByRole("button", { name: "Prepare reply" })).toHaveCount(0);
  // The same conversation stays open: a draft is a part of it, not a page of its own.
  expect(await address(page)).toBe(at0);
});

test("P128 X0 (F16): a New lead opens at a split width and stays open; a cold load of its address stays too", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(at(P, "/mail"));
  // The list settles and opens its first person by itself (P53); a lead's click must not be replaced by that.
  await expect(page).toHaveURL(/\/mail\/c\/\d+/);
  const lead = page.getByTestId("lead-row").first();
  await lead.getByRole("link").click();
  await expect(page).toHaveURL(/\/mail\/lead\/[0-9a-f]{32}/);
  const leadUrl = page.url();
  await page.waitForTimeout(1500);
  expect(page.url()).toBe(leadUrl);
  await expect(page.locator('[data-pane="aside"]')).toBeVisible();
  await page.goto(leadUrl);
  await expect(page.locator('[data-pane="aside"]')).toBeVisible();
  await page.waitForTimeout(1500);
  expect(page.url()).toBe(leadUrl);
});

test("P123 U0: Mail's composer is plain text: no formatting buttons, Markdown typed stays as typed", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await person(page, "Omar Test").getByRole("button").first().click();
  // In a full run P98's test above has recorded Omar's draft: the pane shows its card, whose Edit opens the same editor.
  const edit = pane(page).getByRole("button", { name: "Edit", exact: true });
  const editing = await edit.isVisible();
  if (editing) await edit.click();
  // P128 X1: without a draft the composer rests closed; Write it myself (or Write again) opens it with focus in the body.
  else await pane(page).getByTestId("write-myself").click();
  const box = pane(page).getByRole("textbox", { name: /^((Reply|New message) composer|Edit the Mail draft)$/ });
  await expect(box).toBeVisible();
  if (!editing) await expect(box).toBeFocused();
  await expect(box).toHaveJSProperty("tagName", "TEXTAREA");
  await expect(pane(page).getByRole("toolbar")).toHaveCount(0);
  for (const name of ["Bold", "Italic", "Link", "Quote", "Bulleted list"]) await expect(pane(page).getByRole("button", { name, exact: true })).toHaveCount(0);
  await box.fill("**not bold** and - not a list");
  await expect(box).toHaveValue("**not bold** and - not a list");
  if (editing) await box.press("Escape");
  else await box.fill("");
});

test("P128 X0 (F5): the rail's Mail badge is Mail's Needs you count, and says need you", async ({ page }) => {
  await page.setViewportSize({ width: 1280, height: 800 });
  await page.goto(at(P, "/mail"));
  const res = await page.request.get(`/api/projects/${P}/conversations?view=needs_you&offset=0`);
  expect(res.ok()).toBe(true);
  const n = ((await res.json()) as { counts: Record<string, number> }).counts.needs_you ?? 0;
  expect(n).toBeGreaterThan(0);
  const mail = page.getByRole("navigation", { name: "Sections" }).locator('a[href*="/mail"]').first();
  await expect(mail).toContainText(`${n} need you`);
  await expect(viewMenu(page)).toContainText(String(n));
});

test("P128 X1: a person with no draft shows one action row and no open composer; Close folds the composer again", async ({ page }) => {
  await page.goto(at(P, "/mail"));
  await person(page, "Omar Test").getByRole("button").first().click();
  const start = pane(page).getByTestId("reply-start");
  if ((await start.count()) === 0) return; // a full run has given Omar a draft: its card is the composer
  await expect(pane(page).getByRole("textbox", { name: /composer$/ })).toHaveCount(0);
  expect(await start.locator('[data-variant="primary"]').count()).toBeLessThanOrEqual(1);
  await pane(page).getByTestId("write-myself").click();
  await expect(pane(page).getByRole("textbox", { name: /composer$/ })).toBeFocused();
  await pane(page).getByRole("button", { name: "Close", exact: true }).click();
  await expect(pane(page).getByRole("textbox", { name: /composer$/ })).toHaveCount(0);
});

