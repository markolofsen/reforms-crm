import { expect, test, type Locator, type Page } from "@playwright/test";
import { stubChats } from "./messengers-stubs";
import { at, confirmReview } from "./support";

// P84c (owner, 2026-11-20): Messengers ▸ Chats simplified. One page for both channels with the channel a filter, the states in
// Mail's three views (Needs you, Waiting, All) with the link state a filter (P123 U3b), only fresh unlinked chats on Needs you, Hide ("not a client") with Undo, Unhide on
// Hidden. P102 (2026-11-21): one state menu per row (Link, Create, Hide, Unhide, Change client, Unlink), Link a chat… from a client. The
// accounts and the autolink's memory are stubbed (`messengers-stubs.ts`); the linked chats are the seed's (Rita waits, Sofia not).

const P = "lisbon-realty";
const view = (page: Page) => page.getByRole("button", { name: /^View:/ });
/** P123 U3b, P138 verdict 10: the link state lives in the filter button beside the search (Any is no filter). */
const link = (page: Page) => page.getByRole("button", { name: /^Filter chats/ });
const pickIn = async (page: Page, menu: (page: Page) => ReturnType<typeof view>, name: RegExp) => {
  await menu(page).click();
  await page.getByRole("menuitemradio", { name }).click();
  await closeMenu(page, menu(page));
};
/** Esc closes a filter menu and gives its trigger the focus (and the pointer still rests on it): its tooltip would then cover the
 * menu beside it, so the pointer moves away and the focus leaves before the next click. */
const closeMenu = async (page: Page, trigger: Locator) => {
  await page.keyboard.press("Escape");
  await page.mouse.move(0, 0);
  await trigger.blur();
  await expect(page.locator('[data-slot="tooltip-viewport"]')).toHaveCount(0);
};
const fresh = (page: Page) => page.getByRole("list", { name: "New chats" });
/** P102: a row's one state menu (P115: the compact "Chat actions for <name>"), opened, then one of its items. */
const pick = async (row: Locator, item: string) => {
  await row.getByRole("button", { name: /^Chat actions for / }).click();
  await row.page().getByRole("menuitem", { name: item }).click();
};

test("chats: To do holds the waiting linked chat and the fresh unlinked ones, the sentence once, a suggestion inline", async ({ page }) => {
  await stubChats(page);
  await page.goto(at(P, "/messengers"));
  await expect(page.getByRole("list", { name: "Chats", exact: true }).getByRole("listitem", { name: "Rita Falsa" })).toBeVisible();
  await expect(fresh(page).getByRole("listitem")).toHaveText([/Tomas Viera/, /Joana/, /Delivery bot fan/]);
  // P138 verdict 9: one padded group heading, the rule in its tooltip (the Why button's name).
  await expect(page.getByTestId("unlinked-heading").getByRole("heading")).toHaveText("Not linked · 3");
  await expect(page.getByRole("button", { name: "Why: 3 new chats of the last 14 days are not linked to a client: link or hide each." })).toHaveCount(1);
  await expect(page.getByText("No client in Notion has its phone or username.")).toHaveCount(0);
  await expect(fresh(page).getByRole("listitem", { name: "Joana" }).getByText(/^wrote 2 h ago$/)).toBeVisible();
  const tomas = fresh(page).getByRole("listitem", { name: "Tomas Viera" });
  await expect(tomas.getByText(/Suggested: Tomas Viera/)).toBeVisible();
  await expect(tomas.getByRole("button", { name: "Link Tomas Viera to Tomas Viera" })).toBeVisible();
  // P128 X5: the "since the server started" count is gone.
  await expect(page.getByText(/since the server started/)).toHaveCount(0);
  // 1 linked chat waits + 3 unlinked; All is the two seeded chats and the four remembered unlinked ones (P123 U3b); the link
  // filter counts Linked 2, Not linked 4 (with the old chat), Hidden 1.
  await expect(view(page)).toHaveText(/Needs you\s*4/);
  await view(page).click();
  await expect(page.getByRole("menuitemradio")).toHaveText([/Needs you\s*4/, /Waiting\s*\d+/, /All\s*6/]);
  await closeMenu(page, view(page));
  await link(page).click();
  await expect(page.getByRole("menuitemradio")).toHaveText([/^Linked\s*2/, /Not linked\s*4/, /Hidden\s*1/]);
  await closeMenu(page, link(page));
  await pickIn(page, view, /^All/);
  await pickIn(page, link, /Not linked/);
  await expect.poll(() => new URL(page.url()).search).toBe("?filter=all&link=unlinked");
  // P128 X5: Not linked lists the last 14 days; the 20-day-old chat is one line, and a search still finds it.
  await expect(fresh(page).getByRole("listitem")).toHaveText([/Tomas Viera/, /Joana/, /Delivery bot fan/]);
  await expect(page.getByTestId("unlinked-heading").getByRole("heading")).toHaveText("Not linked · 3");
  await expect(page.getByTestId("not-linked-older")).toHaveText("and 1 older, untouched. Search finds them.");
  await page.getByRole("searchbox", { name: "Search chats" }).fill("Olga");
  await expect(fresh(page).getByRole("listitem")).toHaveText([/Old Olga/]);
});

test("chats: the channel is a sidebar child of Messengers (P125 L5), kept in the address with the view; the header has no channel control", async ({ page }) => {
  await stubChats(page);
  await page.goto(at(P, "/messengers"));
  await expect(page.getByRole("button", { name: /^Channel:/ })).toHaveCount(0);
  const channels = page.getByRole("navigation", { name: "Sections" }).getByRole("list", { name: "Messengers channels" });
  await expect(channels.getByRole("link")).toHaveText([/^Telegram/, /^WhatsApp/]);
  await channels.getByRole("link", { name: /^WhatsApp/ }).click();
  await expect.poll(() => new URL(page.url()).search).toBe("?channel=whatsapp");
  await expect(channels.getByRole("link", { name: /^WhatsApp/ })).toHaveAttribute("aria-current", "page");
  await expect(fresh(page).getByRole("listitem")).toHaveText([/Joana/]);
  await expect(page.getByRole("list", { name: "Chats", exact: true })).toHaveCount(0);
  await expect(view(page)).toHaveText(/Needs you\s*1/);
  // P138 verdict 10: the filter button lists only a state with chats (WhatsApp has no linked one); the address still opens it.
  await link(page).click();
  await expect(page.getByRole("menuitemradio", { name: /^Linked/ })).toHaveCount(0);
  await closeMenu(page, link(page));
  await page.goto(at(P, "/messengers?link=linked&channel=whatsapp"));
  await expect(page.getByText("No linked chats yet")).toBeVisible();
  // A deep link opens on its channel.
  await page.goto(at(P, "/messengers?channel=telegram"));
  await expect(channels.getByRole("link", { name: /^Telegram/ })).toHaveAttribute("aria-current", "page");
  await page.reload();
  await expect(channels.getByRole("link", { name: /^Telegram/ })).toHaveAttribute("aria-current", "page");
  // P123 U3b: `?filter=all` is the All view now (Needs you / Waiting / All), no longer an old address read as the default.
  await page.goto(at(P, "/messengers?filter=all"));
  await expect(view(page)).toHaveText(/All/);
});

// P128 X5 ("sort the chats"): the agent's proposed hides are said once and reviewed in ONE dialog naming every chat with its
// reason; Keep drops one proposal, Hide hides the rest, and one toast's Undo brings them back.
test("chats: the agent's proposed hides, one dialog naming each chat, Keep one, Hide the rest with one Undo", async ({ page }) => {
  const at0 = new Date().toISOString();
  const { posts } = await stubChats(page, {
    proposals: [
      { channel: "telegram_user", account: "42", chatId: "9002", title: "Delivery bot fan", reason: "A delivery service's notices.", at: at0 },
      { channel: "whatsapp", account: "351900000001", chatId: "+351911000111", title: "Joana", reason: "A private contact.", at: at0 },
    ],
  });
  await page.goto(at(P, "/messengers"));
  const line = page.getByTestId("proposed-hides");
  // P138 verdict 9: the proposed hides are one Hide all… on the Not linked heading's line.
  await expect(page.getByTestId("unlinked-heading").getByTestId("proposed-hides")).toHaveCount(1);
  await line.getByRole("button", { name: /^Hide all the 2 chats the agent proposes to hide\s*…$/ }).click();
  const dialog = page.getByTestId("review-dialog");
  await expect(dialog.getByRole("heading", { name: "Hide 2 chats: not clients?" })).toBeVisible();
  await expect(dialog).toContainText("Delivery bot fan (Telegram): A delivery service's notices.");
  await expect(dialog).toContainText("Joana (WhatsApp): A private contact.");
  await dialog.getByRole("button", { name: "Keep Joana" }).click();
  await expect(dialog.getByRole("heading", { name: "Hide 1 chat: not clients?" })).toBeVisible();
  await confirmReview(page); // P105: a confirm inside the dialog's dwell is ignored on purpose
  await expect(page.getByText("Hid 1 chat: not clients")).toBeVisible();
  expect(posts.map((p) => p.path.replace(/^.*\/autolink\//, ""))).toEqual(["proposals/drop", "hide"]);
  await expect(page.getByTestId("proposed-hides")).toHaveCount(0);
  await page.getByRole("button", { name: "Undo" }).click();
  await expect.poll(() => posts.map((p) => p.path.replace(/^.*\/autolink\//, ""))).toContain("unhide");
});

test("chats: Hide takes a chat off To do with Undo; Hidden lists it with Unhide and says how many it cannot name", async ({ page }) => {
  const s = await stubChats(page);
  await page.goto(at(P, "/messengers"));
  await pick(fresh(page).getByRole("listitem", { name: "Joana" }), "Hide: not a client");
  await expect(page.getByText("Hid Joana: not a client")).toBeVisible();
  await expect(fresh(page).getByRole("listitem", { name: "Joana" })).toHaveCount(0);
  await page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Undo" }).click();
  await expect(fresh(page).getByRole("listitem", { name: "Joana" })).toBeVisible();
  expect(s.posts.map((p) => p.path)).toEqual([`/api/projects/${P}/messengers/autolink/hide`, `/api/projects/${P}/messengers/autolink/unhide`]);
  expect(s.posts[0]?.body).toEqual({ channel: "whatsapp", chatId: "+351911000111" });

  await pick(fresh(page).getByRole("listitem", { name: "Delivery bot fan" }), "Hide: not a client");
  await pickIn(page, view, /^All/);
  await pickIn(page, link, /Hidden/);
  await expect.poll(() => new URL(page.url()).search).toBe("?filter=all&link=hidden");
  const hidden = page.getByRole("list", { name: "Hidden chats" });
  await expect(hidden.getByRole("listitem")).toHaveText([/Delivery bot fan/, /Spam Sender/]);
  await expect(page.getByText(/^1 more hidden chat is kept as a fingerprint only/)).toBeVisible();
  await pick(hidden.getByRole("listitem", { name: "Spam Sender" }), "Unhide");
  await expect(page.getByText("Spam Sender is back in Not linked")).toBeVisible();
  await expect(hidden.getByRole("listitem")).toHaveText([/Delivery bot fan/]);
});

test("chats: the link box finds the card made a minute ago by name or email, shows the email, says what the link loaded; Create when only a namesake", async ({ page }) => {
  const s = await stubChats(page);
  await page.goto(at(P, "/messengers"));
  const row = fresh(page).getByRole("listitem", { name: "Delivery bot fan" });
  await pick(row, "Link to a client…");
  const box = row.getByRole("searchbox", { name: /A client in Notion/ });
  await expect(box).toHaveAttribute("placeholder", "Name, email, @username or phone");
  await box.fill("Евгений");
  const found = row.getByRole("list", { name: "Matching clients in Notion" });
  await expect(found.getByRole("button")).toHaveText([/Евгений Тен · Lead\s*john\.ten@example\.test/, /^Евгений\s*suenot@example\.test$/]);
  // A namesake is not this person: Create is offered under any answer.
  await expect(row.getByRole("button", { name: "Create client «Delivery bot fan» in Notion" })).toBeVisible();
  await box.fill("suenot@");
  await expect(found.getByRole("button")).toHaveText([/^Евгений\s*suenot@example\.test$/]);
  await found.getByRole("button").click();
  await expect(page.getByText("7 messages from the last 30 days loaded")).toBeVisible();
  await expect(page.getByText("Telegram set to suenot in Notion")).toBeVisible();
  await expect(fresh(page).getByRole("listitem", { name: "Delivery bot fan" })).toHaveCount(0);
  expect(s.posts.filter((p) => p.path.endsWith("/autolink/link")).map((p) => p.body)).toEqual([{ channel: "telegram_user", account: "42", chatId: "9002", key: "n-evg", title: "Delivery bot fan" }]);
});

test("chats: nothing matches, so Create client makes the card with the chat's username and links it", async ({ page }) => {
  const s = await stubChats(page);
  await page.goto(at(P, "/messengers"));
  const row = fresh(page).getByRole("listitem", { name: "Delivery bot fan" });
  await pick(row, "Link to a client…");
  await row.getByRole("searchbox", { name: /A client in Notion/ }).fill("Zorro");
  await expect(row.getByText("No client in Notion matches.")).toBeVisible();
  await row.getByRole("button", { name: "Create client «Delivery bot fan» in Notion" }).click();
  const form = row.getByRole("form", { name: "New client for Delivery bot fan" });
  await expect(form.getByRole("textbox", { name: "Name" })).toHaveValue("Delivery bot fan");
  await expect(form.getByText("Telegram suenot is written to the card, with Relationship Lead.")).toBeVisible();
  await expect(form.getByRole("button", { name: "Create and link" })).toBeDisabled();
  await form.getByRole("textbox", { name: "Name" }).fill("Evgeniy");
  await form.getByRole("textbox", { name: "Email" }).fill("suenot@example.test");
  await form.getByRole("button", { name: "Create and link" }).click();
  await expect(page.getByText("7 messages from the last 30 days loaded")).toBeVisible();
  await expect(page.getByText("Created Evgeniy in Notion with Telegram suenot")).toBeVisible();
  expect(s.posts.filter((p) => p.path.endsWith("/autolink/create")).map((p) => p.body)).toEqual([{ channel: "telegram_user", account: "42", chatId: "9002", title: "Delivery bot fan", name: "Evgeniy", email: "suenot@example.test" }]);
});

const rita = (page: Page) => page.getByRole("list", { name: "Chats", exact: true }).getByRole("listitem", { name: "Rita Falsa" });

test("chats: Change client moves the chat with its messages (Undo moves it back); Unlink says what it deletes and asks once, in place", async ({ page }) => {
  const s = await stubChats(page);
  await page.goto(at(P, "/messengers"));
  await expect(rita(page).getByRole("button", { name: /^Chat actions for / })).toBeVisible();
  await pick(rita(page), "Change client…");
  await rita(page).getByRole("searchbox", { name: /A client in Notion/ }).fill("suenot@");
  await rita(page).getByRole("list", { name: "Matching clients in Notion" }).getByRole("button").click();
  await expect(page.getByText("Moved Rita F. to Евгений")).toBeVisible();
  await expect(page.getByText(/Its messages stayed with the chat\. The draft for Rita Falsa was skipped; Undo brings it back\./)).toBeVisible();
  await page.getByRole("region", { name: "Notifications" }).getByRole("button", { name: "Undo" }).click();
  const writes = s.posts.filter((p) => !p.path.endsWith("/autolink/records"));
  expect(writes.map((p) => p.path.replace(/\/\d+\//, "/:id/"))).toEqual([`/api/projects/${P}/messengers/chats/:id/client`, `/api/projects/${P}/messengers/chats/:id/client/undo`]);
  expect(writes[0]?.body).toEqual({ key: "n-evg" });
  expect(writes[1]?.body).toEqual({ clientId: 7, draftId: 11 });

  // P105 S3: Unlink is reviewed in the one dialog; Cancel keeps everything.
  const dialog = page.getByTestId("review-dialog");
  await pick(rita(page), "Unlink…");
  await expect(dialog.getByTestId("review-lead")).toHaveText(/^Unlink Rita F\. from Rita Falsa: its 1 stored message and its draft are deleted\. Linking again reloads the last 30 days\.$/);
  await dialog.getByRole("button", { name: "Cancel" }).click();
  await expect(dialog).toHaveCount(0);
  await pick(rita(page), "Unlink…");
  await page.waitForTimeout(450);
  await dialog.getByRole("button", { name: "Unlink and delete" }).click();
  await expect(page.getByText("Unlinked Rita F.")).toBeVisible();
  expect(s.posts.at(-1)?.path).toMatch(/\/chats\/\d+\/unlink$/);
});

test("chats: a hidden chat can be linked, and Link a chat… starts from the client and lists the chats marked for it", async ({ page }) => {
  const s = await stubChats(page);
  await page.goto(at(P, "/messengers?filter=all&link=hidden"));
  const spam = page.getByRole("list", { name: "Hidden chats" }).getByRole("listitem", { name: "Spam Sender" });
  await pick(spam, "Link to a client…");
  await spam.getByRole("searchbox", { name: /A client in Notion/ }).fill("suenot@");
  await spam.getByRole("list", { name: "Matching clients in Notion" }).getByRole("button").click();
  await expect(page.getByText("7 messages from the last 30 days loaded")).toBeVisible();
  expect(s.posts.find((p) => p.path.endsWith("/autolink/link"))?.body).toEqual({ channel: "whatsapp", account: "351900000001", chatId: "+351922000222", key: "n-evg", title: "Spam Sender" });

  await page.goto(at(P, "/messengers"));
  // P138 verdict 10: Link a chat… is an item of the list's ⋯, not a "+" of its own.
  await page.getByRole("button", { name: "More chat actions" }).click();
  await page.getByRole("menuitem", { name: "Link a chat…" }).click();
  const box = page.getByRole("region", { name: "Link a chat" });
  await box.getByRole("searchbox", { name: /A client in Notion/ }).fill("suenot@");
  await box.getByRole("list", { name: "Matching clients in Notion" }).getByRole("button").click();
  const chats = box.getByRole("list", { name: "Chats of 42" });
  await expect(chats.getByRole("listitem")).toHaveText([/Delivery bot fan.*@suenot.*Matches Евгений/, /Rita F\..*Already linked/]);
  await chats.getByRole("button", { name: "Link Delivery bot fan to Евгений" }).click();
  await expect(page.getByText("7 messages from the last 30 days loaded")).toBeVisible();
});
