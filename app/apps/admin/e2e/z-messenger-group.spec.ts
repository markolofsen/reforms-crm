import { execFileSync } from "node:child_process";
import { expect, test } from "@playwright/test";
import { at, remember } from "./support";

// P133 (P131 O5): a WhatsApp chat opens by its number, which is its chat id; a WhatsApp group has no link by id, so its
// header has no WhatsApp button, even for a client the Hub knows. The two linked chats are written here as a link would
// (the seeded instance has no WhatsApp account) and removed after: named z-* because it writes rows. No app is installed
// in the e2e probe, so the one-to-one chat opens on the web; nothing opens and nothing is prefilled.

test.describe.configure({ mode: "serial" });

const DB = process.env.HUB_E2E_DB ?? "";
const P = "lisbon-realty";
const ONE = "351911111222";
const GROUP = "120363025246125486@g.us";
const sql = (q: string): string => execFileSync("sqlite3", [DB, q], { encoding: "utf8", stdio: ["ignore", "pipe", "inherit"] }).trim();

function seedChat(chatId: string, title: string, text: string) {
  const client = sql(`SELECT id FROM clients WHERE project = '${P}' AND email = 'tiago@example.com'`);
  sql(`INSERT INTO messenger_chats (project, channel, chat_id, title) VALUES ('${P}', 'whatsapp', '${chatId}', '${title}')`);
  sql(`INSERT INTO client_identifiers (project, client_id, kind, value) VALUES ('${P}', ${client}, 'whatsapp', '${chatId}')`);
  sql(`INSERT INTO messenger_messages (project, channel, account, chat_id, remote_message_id, direction, text, sent_at, retain_until) VALUES ('${P}', 'whatsapp', '351900000000', '${chatId}', '${chatId}-1', 'in', '${text}', '${new Date(Date.now() - 3_600_000).toISOString()}', '${new Date(Date.now() + 90 * 86_400_000).toISOString()}')`);
  return sql(`SELECT id FROM messenger_chats WHERE project = '${P}' AND channel = 'whatsapp' AND chat_id = '${chatId}'`);
}

const ids: Record<string, string> = {};
test.beforeAll(() => {
  ids.one = seedChat(ONE, "Tiago (WhatsApp)", "Can we see the flat on Saturday?");
  ids.group = seedChat(GROUP, "Viewing on Saturday", "Who brings the keys?");
});
test.afterAll(() => {
  for (const chatId of [ONE, GROUP]) {
    for (const t of ["messenger_messages", "messenger_drafts", "messenger_chats"]) sql(`DELETE FROM ${t} WHERE project = '${P}' AND channel = 'whatsapp' AND chat_id = '${chatId}'`);
    sql(`DELETE FROM client_identifiers WHERE project = '${P}' AND kind = 'whatsapp' AND value = '${chatId}'`);
  }
});
test.beforeEach(async ({ page }) => {
  await remember(page, P);
});

test("a one-to-one WhatsApp chat opens by its number on the web; a group chat has no WhatsApp button", async ({ page }) => {
  const conversation = page.getByTestId("messenger-conversation");
  await page.goto(at(P, `/messengers/c/${ids.one}`));
  await expect(conversation).toContainText("Can we see the flat on Saturday?");
  const wa = conversation.getByRole("link", { name: "Open in WhatsApp (web)" });
  await expect(wa).toHaveAttribute("href", `https://wa.me/${ONE}`);
  await expect(wa).toHaveAttribute("target", "_blank");

  await page.goto(at(P, `/messengers/c/${ids.group}`));
  await expect(conversation).toContainText("Who brings the keys?");
  await expect(conversation.getByRole("link", { name: /Open in WhatsApp/ })).toHaveCount(0);
});
