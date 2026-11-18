import { expect, test, type Page } from "@playwright/test";
import { existsSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { address } from "./support";

// The Connections page (P37, P48). The server runs with HUB_CONNECTIONS_PROBE=fake (every Test is a stub, nothing leaves the process; Mail "has" every
// account a project lists) and HUB_CONFIG_DIR inside the throwaway home, so a key written here can only land in a folder this run made. The keys are
// fakes; the one named REJECT is refused by the stub. Mail has no key (decision 0026): its rows are read-only.
const SECRETS = join(process.env.HUB_E2E_HOME ?? "", "secrets");
const GOOD = "ntn_E2EFAKEGOODVALUE1234567890";
const BAD = "ntn_E2EFAKEREJECTVALUE1234567890";
const ALL = [GOOD, BAD];
const notion = (page: Page) => page.locator("#connection-notion-notion-token");

test.describe.configure({ mode: "serial" });

test("connections: the address names no project, g c opens it, the title and the nav agree, and there is no WhatsApp row", async ({ page }) => {
  await page.goto("/drafts");
  await page.locator('ul[aria-label="Drafts"] > li').first().waitFor();
  await page.locator("body").click({ position: { x: 5, y: 5 } });
  await page.keyboard.press("g");
  await page.keyboard.press("c");
  await expect.poll(() => address(page)).toBe("/connections");
  await expect(page).toHaveTitle("Connections · Hub Workflow");
  await expect(page.getByRole("navigation", { name: "Sections" }).getByRole("link", { name: "Connections", exact: true })).toHaveAttribute("aria-current", "page");
  await page.goto("/connections?project=lisbon-realty");
  await expect.poll(() => address(page)).toBe("/connections");
  await expect(page.locator("#connection-whatsapp")).toHaveCount(0);
});

test("connections: Mail is read-only, one row per account a project lists, with whether Apple Mail has it and who uses it", async ({ page }) => {
  await page.goto("/connections");
  const mail = page.getByRole("table", { name: "Mail accounts" });
  for (const slug of ["lisbon-realty", "demo-shop"]) {
    const row = mail.locator(`tr[data-account="${slug}@example.test"]`);
    await expect(row).toContainText("Found in Apple Mail");
    await expect(row).toContainText(slug);
  }
  await expect(mail.getByRole("button")).toHaveCount(0);
  await expect(page.getByRole("heading", { name: "Mail", exact: true })).toBeVisible();
  await expect(page.getByText(/IMAP|App password/)).toHaveCount(0);
  // Notion and Telegram keep their key controls.
  await expect(notion(page).getByRole("button", { name: "Set key for Notion" })).toBeVisible();
  await expect(page.locator("#connection-telegram-bot").getByRole("button", { name: /^Set key for / })).toBeVisible();
});

test("connections: Mail not running says so, never found or not found", async ({ page }) => {
  await page.route(/\/api\/connections$/, async (route) => {
    const res = await route.fetch();
    const dto = (await res.json()) as { mail: { foundInMail: boolean | null }[] };
    await route.fulfill({ response: res, json: { ...dto, mail: dto.mail.map((m) => ({ ...m, foundInMail: null })) } });
  });
  await page.goto("/connections");
  const mail = page.getByRole("table", { name: "Mail accounts" });
  await expect(mail.getByText("Mail is not running").first()).toBeVisible();
  await expect(mail.getByText(/Found in Apple Mail|Not found in Apple Mail/)).toHaveCount(0);
});

test("connections: a key is written, tested, refused when invalid, replaced, and removed; it is never shown, stored in the browser or answered", async ({ page }) => {
  const seen: string[] = [];
  page.on("response", async (r) => {
    if (r.url().includes("/api/connections")) seen.push(await r.text().catch(() => ""));
  });
  const requests: string[] = [];
  page.on("request", (r) => requests.push(r.url()));
  await page.goto("/connections");
  const n = notion(page);
  await expect(n).toContainText("Not set");

  // An invalid key: refused inline, nothing stored.
  await n.getByRole("button", { name: "Set key for Notion" }).click();
  const field = page.getByLabel("Integration token");
  await expect(field).toHaveAttribute("type", "password");
  await expect(field).toHaveAttribute("autocomplete", "new-password");
  await field.fill("short one");
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "Not stored" })).toBeVisible();
  expect(existsSync(join(SECRETS, "notion-token"))).toBe(false);

  // A good key: saved, the field is gone, the row says stored, the file is mode 600.
  await field.fill(GOOD);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(page.getByRole("status").filter({ hasText: "key saved" })).toBeVisible();
  await expect(n).toContainText("Key stored");
  await expect(page.getByLabel("Integration token")).toHaveCount(0);
  expect(readFileSync(join(SECRETS, "notion-token"), "utf8").trim()).toBe(GOOD);
  expect(statSync(join(SECRETS, "notion-token")).mode & 0o777).toBe(0o600);

  // Test: the stub answers with its public name.
  await n.getByRole("button", { name: "Test Notion" }).click();
  await expect(n).toContainText("Tested");
  await expect(n).toContainText("Fake Notion bot");

  // Replace with a key the stub refuses: the test fails with a fix line and no provider text.
  await n.getByRole("button", { name: "Replace key for Notion" }).click();
  await page.getByLabel("Integration token").fill(BAD);
  await page.getByRole("button", { name: "Save key" }).click();
  await expect(n).toContainText("Not tested yet");
  await n.getByRole("button", { name: "Test Notion" }).click();
  await expect(page.getByRole("alert").filter({ hasText: "test failed" })).toBeVisible();
  await expect(n).toContainText("Test failed");

  // The browser holds no key anywhere, and no reply or address held one.
  const page$ = await page.content();
  const stores = await page.evaluate(() => JSON.stringify([Object.entries(localStorage), Object.entries(sessionStorage), document.cookie, location.href]));
  for (const k of ALL) {
    expect(page$).not.toContain(k);
    expect(stores).not.toContain(k);
    for (const body of seen) expect(body).not.toContain(k);
    for (const u of requests) expect(u).not.toContain(k);
  }

  // Remove asks first, then deletes the file.
  await n.getByRole("button", { name: "Remove key for Notion" }).click();
  await expect(page.getByText(/cannot be brought back/)).toBeVisible();
  await page.getByRole("button", { name: "Remove key", exact: true }).click();
  await expect(page.getByRole("status").filter({ hasText: "key removed" })).toBeVisible();
  await expect(n).toContainText("Not set");
  expect(existsSync(join(SECRETS, "notion-token"))).toBe(false);
});

test("connections: Retry shows when the list cannot load, and the page recovers", async ({ page }) => {
  let fail = true;
  await page.route(/\/api\/connections$/, (route) => (fail ? route.fulfill({ status: 500, json: { error: "server error", code: "server" } }) : route.continue()));
  await page.goto("/connections");
  await expect(page.getByText("Could not load the connections")).toBeVisible();
  fail = false;
  await page.getByRole("button", { name: "Retry" }).click();
  await expect(page.getByRole("heading", { name: "Mail", exact: true })).toBeVisible();
});
