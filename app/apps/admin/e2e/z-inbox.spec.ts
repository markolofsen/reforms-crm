import { expect, test, type Page } from "@playwright/test";
import { address, at, remember } from "./support";

// P96: Mail ▸ Inbox, the clients who wrote and have no draft yet, as the server's Mail reader stored them (the seed holds two for
// demo-shop: the e2e run reads no Mail, its Mailer is fake). The arrival moves to Inbox; a row opens the client's message; Prepare
// reply pastes the request into the agent's dock without Enter (the fake shell echoes a line only after Enter); No reply needed
// closes the client with Undo. Named z-* because it starts a terminal session and writes a dismissal (undone at the end).
test.describe.configure({ mode: "serial" });

const P = "demo-shop";
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
  // The View menu counts Inbox like any view.
  await page.getByRole("button", { name: /^View:/ }).click();
  await expect(page.getByRole("menuitemradio", { name: /^Inbox/ })).toContainText("2");
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
