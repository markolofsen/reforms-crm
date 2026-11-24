import { expect, test, type Page } from "@playwright/test";
import { at } from "./support";

// P143 D2 and N1 (owner, 2026-11-25): a chat whose client said only "yes" can be closed without a reply. No reply needed in the
// conversation header, in the row's menu and on D takes it out of Needs you (state Done) with Undo on the toast; their next message
// reopens it. A linked chat is titled by its client, the number or @username is its subtitle. The seed's chats: Rita (she wrote
// last, the agent's draft waits) and Sofia (we replied last, username sofia_t). The spec leaves Rita's draft as it found it.

const P = "lisbon-realty";
const RITA = "Rita Falsa";
const chats = (page: Page) => page.getByRole("list", { name: "Chats" });
const conversation = (page: Page) => page.getByTestId("messenger-conversation");
const noReply = (page: Page) => conversation(page).getByTestId("chat-no-reply-needed");

test("messengers: No reply needed closes an owed chat with Undo, from the header, the row menu and D; a draft's Skip comes first", async ({ page }) => {
  await page.goto(at(P, "/messengers"));
  await expect(conversation(page).getByRole("heading", { name: RITA })).toBeVisible();
  // While the agent's draft waits, its Skip is the move: no No reply needed.
  await expect(conversation(page).getByTestId("messenger-draft")).toBeVisible();
  await expect(noReply(page)).toHaveCount(0);
  await conversation(page).getByRole("button", { name: `Skip the draft for ${RITA}` }).click();
  await expect(conversation(page).getByText(/Wrote you/)).toBeVisible();

  // The header's button: Done, the toast names the chat, Needs you no longer holds it.
  await noReply(page).click();
  await expect(page.getByText(`No reply needed: ${RITA}`)).toBeVisible();
  await expect(conversation(page).getByText(/^Done$/)).toBeVisible();
  await expect(conversation(page).getByTestId("chat-done-line")).toHaveText("Marked done");
  await expect(noReply(page)).toHaveCount(0);
  await expect(chats(page).getByRole("listitem", { name: RITA })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(conversation(page).getByText(/Wrote you/)).toBeVisible();

  // D does the same; Undo again.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("d");
  await expect(page.getByText(`No reply needed: ${RITA}`)).toBeVisible();
  await expect(conversation(page).getByText(/^Done$/)).toBeVisible();
  await page.getByRole("button", { name: "Undo" }).last().click();
  await expect(conversation(page).getByText(/Wrote you/)).toBeVisible();

  // The row's menu offers it too while a reply is owed and no draft waits.
  await page.getByRole("button", { name: `Chat actions for ${RITA}` }).click();
  await expect(page.getByRole("menuitem", { name: "No reply needed" })).toBeVisible();
  await page.keyboard.press("Escape");

  // U puts the skipped draft back: the next specs find Rita as the seed left her.
  await page.locator("body").click({ position: { x: 1, y: 1 } });
  await page.keyboard.press("u");
  await expect(conversation(page).getByTestId("messenger-draft")).toBeVisible();
});

test("messengers: a linked chat is titled by its client; the @username is the subtitle, in the header and on the row", async ({ page }) => {
  await page.goto(at(P, "/messengers?filter=all"));
  const sofia = chats(page).getByRole("listitem", { name: "Sofia Teste" });
  await expect(sofia).toBeVisible();
  await expect(sofia.getByText("@sofia_t")).toBeVisible();
  await sofia.getByRole("link").click();
  await expect(conversation(page).getByRole("heading", { name: "Sofia Teste" })).toBeVisible();
  await expect(conversation(page).getByTestId("chat-handle")).toHaveText("@sofia_t");
});
