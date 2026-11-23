import { expect, test, type Page, type Route } from "@playwright/test";
import { at } from "./support";

// P71 M3: the Messengers section. The panel reads the seeded linked chats of lisbon-realty (Rita, who wrote last, with the
// agent's draft; Sofia, answered); Edit and Skip write the real row. The Telegram account routes are stubbed with
// `page.route`: the e2e instance has two projects, so its server keeps Telegram accounts off, and a real login is never made
// (the server side of the login runs on fakes in `apps/server/src/telegram-user.test.ts`; WhatsApp's in `whatsapp.test.ts`).

const P = "lisbon-realty";
const RITA = "Rita Falsa";
const chats = (page: Page) => page.getByRole("list", { name: "Chats" });
const rita = (page: Page) => chats(page).getByRole("listitem", { name: RITA });
const conversation = (page: Page) => page.getByTestId("messenger-conversation");

test("messengers: the panel lists the waiting chat with the agent's draft, a refused Send says why in words, and Drafts lists mail only", async ({ page }) => {
  await page.goto(at(P, "/messengers"));
  await expect(rita(page).getByText(/Draft ready/)).toBeVisible();
  await expect(rita(page).getByText(/notary on the 28th/)).toBeVisible();
  await expect(conversation(page)).toContainText("Hi! Is the notary on the 28th still on?");
  await expect(conversation(page)).toContainText("Telegram");
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("the 28th stands");
  // P71 M4: the e2e server connects no Telegram account, so the real dry run refuses, in words, and nothing is sent.
  await conversation(page).getByRole("button", { name: `Send the reply to ${RITA}` }).click();
  await expect(conversation(page).getByText(/^Not sent: \d+ reasons?$/)).toBeVisible();
  await expect(conversation(page).getByText("the Telegram account 100200300 is not connected (Messengers ▸ Settings)")).toBeVisible();
  await conversation(page).getByRole("button", { name: "Close" }).click();
  await expect(conversation(page).getByText(/^Not sent:/)).toHaveCount(0);
  await expect(rita(page)).toHaveAttribute("data-agent-ref", /^chat:\d+$/);
  await expect(page.getByRole("button", { name: /^View:/ })).toHaveText(/To do\s*1/);
  await expect(chats(page).getByRole("listitem")).toHaveCount(1);
  // Linked (P84c): Sofia's chat, where we replied last, says whose turn it is.
  await page.getByRole("button", { name: /^View:/ }).click();
  await page.getByRole("menuitemradio", { name: /Linked/ }).click();
  await expect.poll(() => new URL(page.url()).search).toBe("?filter=linked");
  await expect(chats(page).getByRole("listitem", { name: "Sofia Teste" }).getByText("Waiting for client")).toBeVisible();
  // P71 M-P: the seeded verdicts of Sofia's chat, counted by reason under its Pre-analysis switch (P115: the compact row shows
  // identity and state only).
  await page.goto(at(P, "/messengers/settings"));
  await expect(page.getByRole("listitem", { name: "Rules for Sofia Teste" }).getByText("Pre-analysis: hid 1 of 2 (1 closing).")).toBeVisible();
  // Mail drafts stay in Drafts, and messenger drafts never go there.
  await page.goto(at(P, "/mail?filter=all"));
  await page.locator('ul[aria-label="People"] > li').first().waitFor();
  await expect(page.getByText(/the 28th stands/)).toHaveCount(0);
});

test("messengers: Send reads the dry run, confirms in place with the exact text, and applies it with a messenger ticket", async ({ page }) => {
  // The server side runs on a fake Telegram client in `apps/server/src/messenger-send.test.ts`; here the door's replies are stubbed.
  const TEXT = "Hi Rita, the 28th stands (as the server read it).";
  const sends: unknown[] = [];
  const tickets: unknown[] = [];
  await page.route(/\/api\/projects\/[^/]+\/messengers\/drafts\/\d+\/send$/, async (r) => {
    const body = r.request().postDataJSON() as { apply: boolean };
    sends.push(body);
    await r.fulfill({ json: body.apply ? { ok: true, sendId: 77 } : { ok: true, dryRun: true, channel: "telegram_user", chatId: "700100", account: "100200300", to: RITA, text: TEXT } });
  });
  await page.route(/\/api\/sends\/tickets$/, async (r) => {
    tickets.push(r.request().postDataJSON());
    await r.fulfill({ json: { ticket: "t".repeat(43), expiresAt: "2099-01-01T00:00:00.000Z" } });
  });
  await page.goto(at(P, "/messengers"));
  const send = conversation(page).getByRole("button", { name: `Send the reply to ${RITA}` });
  const draft = conversation(page).getByTestId("messenger-draft");
  await expect(draft).toBeVisible();
  await send.click();
  await expect(conversation(page).getByRole("status")).toHaveText(`To ${RITA} on Telegram, from your account 100200300. A sent message cannot be recalled.`);
  await expect(draft).toContainText(TEXT);
  await expect(conversation(page).getByRole("button", { name: "Confirm send" })).toBeFocused();
  await expect(conversation(page).getByRole("button", { name: /^Edit/ })).toHaveCount(0);
  await page.keyboard.press("Escape");
  await expect(send).toBeVisible();
  expect(sends).toEqual([{ apply: false }]);
  await send.click();
  await conversation(page).getByRole("button", { name: "Confirm send" }).click();
  await expect(page.getByText(`Sent to ${RITA} on Telegram`)).toBeVisible();
  expect(tickets).toEqual([{ project: P, draftId: expect.any(Number), kind: "messenger" }]);
  expect(sends.at(-1)).toEqual({ apply: true, confirm: { chatId: "700100", text: TEXT }, ticket: "t".repeat(43) });
});

test("messengers: Edit changes the draft's text, Skip sets it aside with Undo", async ({ page }) => {
  await page.goto(at(P, "/messengers"));
  await conversation(page).getByRole("button", { name: `Edit the draft for ${RITA}` }).click();
  // P93: the Markdown composer, named by its aria-label; its help line says what Save does.
  const box = page.getByLabel("Edit the messenger draft", { exact: true });
  await expect(box).toBeFocused();
  await box.fill("Hi Rita, yes: the 28th at 10:00 stands.");
  await box.press("ControlOrMeta+Enter");
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("the 28th at 10:00 stands");
  await page.reload();
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("the 28th at 10:00 stands");

  await conversation(page).getByRole("button", { name: `Skip the draft for ${RITA}` }).click();
  await expect(page.getByText(`Skipped the draft for ${RITA}`)).toBeVisible();
  await expect(conversation(page).getByTestId("messenger-draft")).toHaveCount(0);
  await expect(conversation(page).getByText(/A reply is owed and no draft yet/)).toBeVisible();
  await expect(conversation(page).getByRole("button", { name: "Prepare reply" })).toBeVisible();
  await conversation(page).getByRole("button", { name: "Prepare reply" }).click();
  await expect(conversation(page).getByTestId("messenger-draft")).toContainText("fake");
});

test("messengers settings: a chat's reply mode and instruction are saved and read back", async ({ page }) => {
  await page.goto(at(P, "/messengers/settings"));
  const rules = page.getByRole("listitem", { name: `Rules for ${RITA}` });
  await rules.getByRole("button", { name: "Only when I ask" }).click();
  await expect(rules.getByRole("button", { name: "Only when I ask" })).toHaveAttribute("aria-pressed", "true");
  await rules.getByLabel("Your instruction for this chat").fill("Short and formal.");
  await rules.getByRole("button", { name: "Save instruction" }).click();
  await expect(rules.getByRole("button", { name: "Save instruction" })).toBeDisabled();
  await page.reload();
  await expect(rules.getByRole("button", { name: "Only when I ask" })).toHaveAttribute("aria-pressed", "true");
  // P93: the instruction is a Markdown editor, so its text is read, not a value.
  await expect(rules.getByLabel("Your instruction for this chat")).toHaveText("Short and formal.");
  // P71 M-P: the switch's note says what it does (the e2e server runs HUB_LLM=fake: nothing leaves it).
  await expect(rules.getByText(/A cheap model reads each new message and the two before it/)).toBeVisible();
  await expect(rules.getByText(/local test model; no request leaves this computer/)).toBeVisible();
  await expect(page.getByText(/nothing reads this switch/)).toHaveCount(0);
  await page.goto(at(P, "/messengers?filter=linked"));
  await expect(rita(page)).toContainText(/Only when I ask|Client wrote|Draft ready/);
  // Back to the default, so the specs after this one see the seed's rules.
  await page.goto(at(P, "/messengers/settings"));
  await rules.getByRole("button", { name: "Draft replies" }).click();
  await expect(rules.getByRole("button", { name: "Draft replies" })).toHaveAttribute("aria-pressed", "true");
});

test("messengers settings: the project reply policy names its language and instruction, nothing about delivery", async ({ page }) => {
  await page.goto(at(P, "/messengers/settings"));
  const policy = page.getByRole("region", { name: "Reply policy" });
  await expect(policy).toContainText("Language follows the client by default");
  await expect(policy.getByRole("button", { name: "Open project policy" })).toBeVisible();
  await expect(policy).toContainText("messengers.language");
  await expect(policy).not.toContainText(/Provider|Delivery|response mode|reply provider/i);
});

/** Stubs M1's account routes: none connected, then one after the login's last step. Records each POST's path and body. */
async function stubTelegram(page: Page, opts: { connected: boolean }) {
  const posts: { path: string; body: unknown }[] = [];
  let connected = opts.connected;
  const account = { account: "42", state: "running", parked: null, fix: null, failures: 0, stored: 0 };
  await page.route(/\/api\/messengers\/telegram-user$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: connected ? [account] : [] } }));
  const reply = (json: unknown) => async (r: Route) => {
    posts.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    await r.fulfill({ json });
  };
  const FLOW = "flow-0123456789abcdef";
  await page.route(/\/login\/start$/, reply({ step: "code", flow: FLOW }));
  await page.route(/\/login\/code$/, reply({ step: "password", flow: FLOW }));
  await page.route(/\/login\/password$/, async (r) => {
    connected = true;
    await reply({ step: "done", account: "42", name: "Mark Owner" })(r);
  });
  return { posts, flow: FLOW };
}

test("messengers settings: the connect form drives M1's routes step by step, with the risk sentence", async ({ page }) => {
  const t = await stubTelegram(page, { connected: false });
  await page.goto(at(P, "/messengers/settings"));
  const form = page.getByTestId("telegram-connect");
  await expect(form.getByText(/your own, personal Telegram account/)).toBeVisible();
  await form.getByLabel("api_id").fill("12345");
  await form.getByLabel("api_hash").fill("0123456789abcdef0123456789abcdef");
  await form.getByLabel("Phone").fill("+351 900 000 000");
  await form.getByRole("button", { name: "Send me the code" }).click();
  await form.getByLabel("Code").fill("12345");
  await form.getByRole("button", { name: "Continue" }).click();
  await form.getByLabel("Password").fill("secret");
  await form.getByRole("button", { name: "Connect" }).click();
  await expect(page.getByRole("list", { name: "Telegram accounts" }).getByText("Telegram account 42")).toBeVisible();
  expect(t.posts).toEqual([
    { path: "/api/messengers/telegram-user/login/start", body: { apiId: 12345, apiHash: "0123456789abcdef0123456789abcdef", phone: "+351 900 000 000" } },
    { path: "/api/messengers/telegram-user/login/code", body: { flow: t.flow, code: "12345" } },
    { path: "/api/messengers/telegram-user/login/password", body: { flow: t.flow, password: "secret" } },
  ]);
  // Nothing of the login reached the address.
  expect(page.url()).not.toMatch(/12345|secret|0123456789abcdef/);
});

test("messengers settings: WhatsApp shows the QR code only after Connect, then the linked number", async ({ page }) => {
  // P71 M5: the routes are stubbed; the server side of the pairing runs on a fake Baileys socket in
  // `apps/server/src/whatsapp.test.ts`. Nothing here reaches WhatsApp and no code is scanned.
  const posts: string[] = [];
  let linked = false;
  let reads = 0;
  const FLOW = "flow-wa-0123456789abcdef";
  const account = { account: "351900000001", state: "running", parked: null, fix: null, failures: 0, stored: 0 };
  const rows = Array.from({ length: 21 }, (_, y) => Array.from({ length: 21 }, (_, x) => ((x * y + x) % 3 === 0 ? "1" : "0")).join(""));
  await page.route(/\/api\/messengers\/whatsapp$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: linked ? [account] : [] } }));
  await page.route(/\/api\/messengers\/whatsapp\/connect$/, async (r) => {
    posts.push(new URL(r.request().url()).pathname);
    await r.fulfill({ json: { flow: FLOW } });
  });
  await page.route(/\/api\/messengers\/whatsapp\/connect\/state$/, async (r) => {
    posts.push(new URL(r.request().url()).pathname);
    expect(r.request().postDataJSON()).toEqual({ flow: FLOW });
    reads++;
    if (reads < 2) return r.fulfill({ json: { step: "qr", size: 21, rows } });
    linked = true;
    return r.fulfill({ json: { step: "done", account: account.account, name: "Mark Owner" } });
  });
  await page.goto(at(P, "/messengers/settings"));
  const box = page.getByTestId("whatsapp-connect");
  await expect(box.getByText(/your own, personal WhatsApp number/)).toBeVisible();
  await expect(box.getByRole("img", { name: /QR code/ })).toHaveCount(0);
  expect(posts).toEqual([]);
  await box.getByRole("button", { name: "Connect" }).click();
  await expect(box.getByRole("img", { name: /QR code/ })).toBeVisible();
  await expect(box.getByText(/Linked devices ▸ Link a device/)).toBeVisible();
  await expect(page.getByRole("list", { name: "WhatsApp numbers" }).getByText("WhatsApp +351900000001")).toBeVisible();
  expect(posts.slice(0, 2)).toEqual(["/api/messengers/whatsapp/connect", "/api/messengers/whatsapp/connect/state"]);
  expect(page.url()).not.toMatch(/flow-wa/);
});
