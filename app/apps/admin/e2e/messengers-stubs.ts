import type { Page, Route } from "@playwright/test";

// P84c: the e2e instance has two projects, so its server runs no Telegram or WhatsApp account and its autolink serves no project
// (`recent` and `hidden` are empty there). The Chats views of unlinked and hidden chats are driven by these stubs; the server side
// (freshness, Hide's keyed hash, Unhide) runs on fakes in `apps/server/src/autolink-hidden.test.ts`. Nothing here reaches a messenger.

const P = "lisbon-realty";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const dir = { state: "ready", reason: null, entries: 3028, withIdentifier: 211, byRelationship: { Lead: 208, Prospect: 2, Client: 1 }, readAt: ago(30) };

type Recent = { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; title: string; seenAt: string; why: string; by: string | null; candidates: unknown[]; last: { at: string; inbound: boolean } | null };

export const RECENT: Recent[] = [
  { channel: "telegram_user", account: "42", chatId: "9001", title: "Tomas Viera", seenAt: ago(5), why: "ambiguous", by: "phone", candidates: [{ key: "n-1", name: "Tomas Viera", email: "tomas@example.test", relationship: "Lead" }, { key: "n-2", name: "T. Viera (office)", email: "office@example.test", relationship: "Client" }], last: { at: ago(5), inbound: true } },
  { channel: "whatsapp", account: "351900000001", chatId: "+351911000111", title: "Joana", seenAt: ago(120), why: "none", by: null, candidates: [], last: { at: ago(120), inbound: true } },
  { channel: "telegram_user", account: "42", chatId: "9002", title: "Delivery bot fan", seenAt: ago(60 * 26), why: "none", by: null, candidates: [], last: { at: ago(60 * 26), inbound: true } },
];

/** Both accounts connected and the autolink's state, with Hide and Unhide moving a chat between the two lists. Returns the POSTs. */
export async function stubChats(page: Page) {
  const posts: { path: string; body: unknown }[] = [];
  let recent = [...RECENT];
  let hidden: { channel: "telegram_user" | "whatsapp"; chatId: string; title: string; hiddenAt: string }[] = [{ channel: "whatsapp", chatId: "+351922000222", title: "Spam Sender", hiddenAt: ago(60 * 50) }];
  await page.route(/\/api\/messengers\/telegram-user$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: [{ account: "42", state: "running", parked: null, fix: null, failures: 0, stored: 0 }] } }));
  await page.route(/\/api\/messengers\/whatsapp$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: [{ account: "351900000001", state: "running", parked: null, fix: null, failures: 0, stored: 0 }] } }));
  await page.route(/\/messengers\/autolink\/state$/, (r) => r.fulfill({ json: { enabled: true, directory: dir, unlinkedActive: 2, recent, freshDays: 14, hidden, hiddenUnnamed: 1 } }));
  const move = (to: "hidden" | "recent") => async (r: Route) => {
    const body = r.request().postDataJSON() as { channel: "telegram_user" | "whatsapp"; chatId: string };
    posts.push({ path: new URL(r.request().url()).pathname, body });
    if (to === "hidden") {
      const row = recent.find((x) => x.chatId === body.chatId);
      recent = recent.filter((x) => x.chatId !== body.chatId);
      hidden = [{ channel: body.channel, chatId: body.chatId, title: row?.title ?? body.chatId, hiddenAt: new Date().toISOString() }, ...hidden];
    } else {
      const row = hidden.find((x) => x.chatId === body.chatId);
      hidden = hidden.filter((x) => x.chatId !== body.chatId);
      const back = RECENT.find((x) => x.chatId === body.chatId);
      if (back) recent = [back, ...recent];
      else if (row) recent = [{ channel: row.channel, account: "1", chatId: row.chatId, title: row.title, seenAt: ago(1), why: "none", by: null, candidates: [], last: { at: ago(1), inbound: true } }, ...recent];
    }
    await r.fulfill({ json: { ok: true, channel: body.channel, chatId: body.chatId, hidden: to === "hidden" } });
  };
  await page.route(/\/messengers\/autolink\/hide$/, move("hidden"));
  await page.route(/\/messengers\/autolink\/unhide$/, move("recent"));
  return { posts };
}
