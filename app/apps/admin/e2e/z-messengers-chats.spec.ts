import { expect, test, type Page } from "@playwright/test";
import { stubChats } from "./messengers-stubs";
import { at } from "./support";

// P84c (owner, 2026-11-20): Messengers ▸ Chats simplified. One page for both channels with the channel a filter, three states in
// one View menu (To do, Linked, Hidden), only fresh unlinked chats, Hide ("not a client") with Undo, Unhide on Hidden. The
// accounts and the autolink's memory are stubbed (`messengers-stubs.ts`); the linked chats are the seed's (Rita waits, Sofia not).

const P = "lisbon-realty";
const view = (page: Page) => page.getByRole("button", { name: /^View:/ });
const fresh = (page: Page) => page.getByRole("list", { name: "New chats" });

test("chats: To do holds the waiting linked chat and the fresh unlinked ones, the sentence once, a suggestion inline", async ({ page }) => {
  await stubChats(page);
  await page.goto(at(P, "/messengers"));
  await expect(page.getByRole("list", { name: "Chats", exact: true }).getByRole("listitem", { name: "Rita Falsa" })).toBeVisible();
  await expect(fresh(page).getByRole("listitem")).toHaveText([/Tomas Viera/, /Joana/, /Delivery bot fan/]);
  await expect(page.getByText(/^New chats no client in Notion has the phone or username of, from the last 14 days/)).toHaveCount(1);
  await expect(page.getByText("No client in Notion has its phone or username.")).toHaveCount(0);
  await expect(fresh(page).getByRole("listitem", { name: "Joana" }).getByText(/^wrote 2 h ago$/)).toBeVisible();
  const tomas = fresh(page).getByRole("listitem", { name: "Tomas Viera" });
  await expect(tomas.getByText(/Suggested: Tomas Viera/)).toBeVisible();
  await expect(tomas.getByRole("button", { name: "Link Tomas Viera to Tomas Viera" })).toBeVisible();
  await expect(page.getByText("2 unlinked chats have written since the server started (counted in memory, never stored).")).toBeVisible();
  // 1 linked chat waits + 3 unlinked; Linked is the two seeded chats; Hidden names one.
  await expect(view(page)).toHaveText(/To do\s*4/);
  await view(page).click();
  await expect(page.getByRole("menuitemradio")).toHaveText([/To do\s*4/, /Linked\s*2/, /Hidden\s*1/]);
  await page.keyboard.press("Escape");
});

test("chats: the channel is a filter of the same page, kept in the address with the view", async ({ page }) => {
  await stubChats(page);
  await page.goto(at(P, "/messengers"));
  const channel = page.getByRole("radiogroup", { name: "Channel" });
  await expect(channel.getByRole("radio")).toHaveText(["All", "Telegram", "WhatsApp"]);
  await channel.getByRole("radio", { name: "WhatsApp" }).click();
  await expect.poll(() => new URL(page.url()).search).toBe("?channel=whatsapp");
  await expect(fresh(page).getByRole("listitem")).toHaveText([/Joana/]);
  await expect(page.getByRole("list", { name: "Chats", exact: true })).toHaveCount(0);
  await expect(view(page)).toHaveText(/To do\s*1/);
  await view(page).click();
  await page.getByRole("menuitemradio", { name: /Linked/ }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => new URL(page.url()).search).toBe("?filter=linked&channel=whatsapp");
  await expect(page.getByText("No linked chats yet")).toBeVisible();
  await page.reload();
  await expect(channel.getByRole("radio", { name: "WhatsApp" })).toBeChecked();
  // The old "All chats" address reads as the default view.
  await page.goto(at(P, "/messengers?filter=all"));
  await expect(view(page)).toHaveText(/To do/);
});

test("chats: Hide takes a chat off To do with Undo; Hidden lists it with Unhide and says how many it cannot name", async ({ page }) => {
  const s = await stubChats(page);
  await page.goto(at(P, "/messengers"));
  await fresh(page).getByRole("button", { name: "Hide Joana: not a client" }).click();
  await expect(page.getByText("Hid Joana: not a client")).toBeVisible();
  await expect(fresh(page).getByRole("listitem", { name: "Joana" })).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect(fresh(page).getByRole("listitem", { name: "Joana" })).toBeVisible();
  expect(s.posts.map((p) => p.path)).toEqual([`/api/projects/${P}/messengers/autolink/hide`, `/api/projects/${P}/messengers/autolink/unhide`]);
  expect(s.posts[0]?.body).toEqual({ channel: "whatsapp", chatId: "+351911000111" });

  await fresh(page).getByRole("button", { name: "Hide Delivery bot fan: not a client" }).click();
  await view(page).click();
  await page.getByRole("menuitemradio", { name: /Hidden/ }).click();
  await page.keyboard.press("Escape");
  await expect.poll(() => new URL(page.url()).search).toBe("?filter=hidden");
  const hidden = page.getByRole("list", { name: "Hidden chats" });
  await expect(hidden.getByRole("listitem")).toHaveText([/Delivery bot fan/, /Spam Sender/]);
  await expect(page.getByText(/^1 more hidden chat is kept as a fingerprint only/)).toBeVisible();
  await hidden.getByRole("button", { name: "Unhide Spam Sender" }).click();
  await expect(page.getByText("Spam Sender is back on To do")).toBeVisible();
  await expect(hidden.getByRole("listitem")).toHaveText([/Delivery bot fan/]);
});
