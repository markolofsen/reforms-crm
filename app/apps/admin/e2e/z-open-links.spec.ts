import { mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { expect, test, type Page } from "@playwright/test";
import { at, remember } from "./support";

// P131 O2, O3, O5: open in the app when this Mac has it, else on the web. The e2e server's opener is the fake one
// (HUB_OPENER=fake): its app probe reads `state/opener-apps.json` of the e2e instance at every probe, so the spec switches
// apps on and off and presses Settings ▸ This Mac's Check again. Nothing opens and nothing is prefilled. Named z-* because
// it writes that file (removed at the end, and the probe asked again, so later specs see no app).

test.describe.configure({ mode: "serial" });

const HOME = process.env.HUB_E2E_HOME ?? "";
const APPS = join(HOME, "state", "opener-apps.json");
const SHOP = "demo-shop";
const REALTY = "lisbon-realty";

async function setApps(page: Page, apps: { notion: boolean; telegram: boolean; whatsapp: boolean } | null) {
  mkdirSync(join(HOME, "state"), { recursive: true });
  if (apps) writeFileSync(APPS, JSON.stringify(apps));
  else rmSync(APPS, { force: true });
  await page.goto("/settings/mac");
  await page.getByRole("button", { name: "Check again" }).click();
  await expect(page.getByRole("status").filter({ hasText: "Checked." })).toBeVisible();
}

test.afterAll(async ({ browser }) => {
  const page = await browser.newPage();
  await setApps(page, null);
  await page.close();
});

test("P131 O2: This Mac lists the three apps as the probe saw them; Check again picks up an install", async ({ page }) => {
  await setApps(page, null);
  const apps = page.getByTestId("mac-apps");
  await expect(apps.locator('[data-app="notion"]')).toHaveText("Notion: not installed, links open in the browser");
  await setApps(page, { notion: true, telegram: true, whatsapp: false });
  await expect(apps.locator('[data-app="notion"]')).toHaveText("Notion: installed, links open in the app");
  await expect(apps.locator('[data-app="telegram"]')).toHaveAttribute("data-installed", "true");
  await expect(apps.locator('[data-app="whatsapp"]')).toHaveAttribute("data-installed", "false");
});

test("P131 O3: a lead's Notion page opens in the app when it is installed, else in a new browser tab", async ({ page }) => {
  await remember(page, SHOP);
  const openLead = async () => {
    await page.goto(at(SHOP, "/mail"));
    await page.getByTestId("lead-row").first().getByRole("link").click();
    await expect(page.locator('[data-pane="aside"]')).toBeVisible();
  };
  await setApps(page, { notion: true, telegram: false, whatsapp: false });
  await openLead();
  const inApp = page.locator('[data-pane="aside"]').getByRole("link", { name: "Open in Notion" });
  await expect(inApp).toHaveAttribute("href", /^notion:\/\/www\.notion\.so\/[0-9a-f]{32}$/);
  await expect(inApp).not.toHaveAttribute("target", "_blank");

  await setApps(page, { notion: false, telegram: false, whatsapp: false });
  await openLead();
  const web = page.locator('[data-pane="aside"]').getByRole("link", { name: /Open in browser/ });
  await expect(web).toHaveAttribute("href", /^https:\/\/www\.notion\.so\/[0-9a-f]{32}$/);
  await expect(web).toHaveAttribute("target", "_blank");
});

test("P131 O5: a chat's header opens Telegram and WhatsApp by the contact's identity, app or web; none without one, nothing prefilled", async ({ page }) => {
  await remember(page, REALTY);
  // Rita's chat as the server reads it, with a contact the Notion card would give (the e2e instance reads no Notion).
  let contact: { telegramUsername: string | null; telegramPhone: string | null; whatsappPhone: string | null } = { telegramUsername: "rita_f", telegramPhone: null, whatsappPhone: "351912345678" };
  await page.route(/\/api\/projects\/[^/]+\/messengers\/chats\/\d+\/conversation$/, async (r) => {
    const res = await r.fetch();
    const body = (await res.json()) as { chat: { contact: unknown } };
    await r.fulfill({ response: res, json: { ...body, chat: { ...body.chat, contact } } });
  });
  const header = (p: Page) => p.getByTestId("messenger-conversation").getByRole("group", { name: "Conversation tools" });

  await setApps(page, { notion: false, telegram: true, whatsapp: false });
  await page.goto(at(REALTY, "/messengers"));
  const tg = header(page).getByRole("link", { name: "Open in Telegram" });
  await expect(tg).toHaveAttribute("href", "tg://resolve?domain=rita_f");
  await expect(tg).not.toHaveAttribute("target", "_blank");
  const wa = header(page).getByRole("link", { name: "Open in WhatsApp (web)" });
  await expect(wa).toHaveAttribute("href", "https://wa.me/351912345678");
  await expect(wa).toHaveAttribute("target", "_blank");

  // A Telegram phone has no web form: without the app there is no Telegram button; no number, no WhatsApp button.
  contact = { telegramUsername: null, telegramPhone: "+351 912 345 678", whatsappPhone: null };
  await setApps(page, { notion: false, telegram: false, whatsapp: false });
  await page.goto(at(REALTY, "/messengers"));
  await expect(page.getByTestId("messenger-conversation")).toContainText("Is the notary on the 28th still on?");
  await expect(page.getByTestId("messenger-conversation").getByRole("link", { name: /Open in (Telegram|WhatsApp)/ })).toHaveCount(0);

  // Unstubbed, Rita's chat has no identity the Hub knows: no chat-app button at all.
  await page.unrouteAll({ behavior: "ignoreErrors" });
  await page.goto(at(REALTY, "/messengers"));
  await expect(page.getByTestId("messenger-conversation")).toContainText("Is the notary on the 28th still on?");
  await expect(page.getByTestId("messenger-conversation").getByRole("link", { name: /Open in (Telegram|WhatsApp)/ })).toHaveCount(0);
});

test("P131 O5 (verdict 10): a linked chat opens Telegram by its own username, kept at link time, with no Notion card", async ({ page }) => {
  await remember(page, REALTY);
  const openSofia = async () => {
    await page.goto(at(REALTY, "/messengers?filter=linked"));
    await page.getByRole("list", { name: "Chats" }).getByRole("listitem", { name: "Sofia Teste" }).getByRole("link").first().click();
    await expect(page.getByTestId("messenger-conversation")).toContainText("Any news on the offer?");
  };
  const conversation = () => page.getByTestId("messenger-conversation");
  await setApps(page, { notion: false, telegram: true, whatsapp: false });
  await openSofia();
  const tg = conversation().getByRole("link", { name: "Open in Telegram" });
  await expect(tg).toHaveAttribute("href", "tg://resolve?domain=sofia_t");
  await expect(tg).not.toHaveAttribute("target", "_blank");
  // Without the app a username has a web form.
  await setApps(page, { notion: false, telegram: false, whatsapp: false });
  await openSofia();
  const web = conversation().getByRole("link", { name: "Open in Telegram (web)" });
  await expect(web).toHaveAttribute("href", "https://t.me/sofia_t");
  await expect(web).toHaveAttribute("target", "_blank");
});
