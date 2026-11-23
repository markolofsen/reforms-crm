import type { Page, Route } from "@playwright/test";

// P84c: the e2e instance has two projects, so its server runs no Telegram or WhatsApp account and its autolink serves no project
// (`recent` and `hidden` are empty there). The Chats views of unlinked and hidden chats are driven by these stubs; the server side
// (freshness, Hide's keyed hash, Unhide) runs on fakes in `apps/server/src/messengers/autolink/hidden.test.ts`. Nothing here reaches a messenger.

const P = "lisbon-realty";
const ago = (min: number) => new Date(Date.now() - min * 60_000).toISOString();
const dir = { state: "ready", reason: null, entries: 3028, withIdentifier: 211, byRelationship: { Lead: 208, Prospect: 2, Client: 1 }, readAt: ago(30) };

type Recent = { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; title: string; seenAt: string; why: string; by: string | null; candidates: unknown[]; last: { at: string; inbound: boolean } | null; username: string | null; phone: string | null };

export const RECENT: Recent[] = [
  { channel: "telegram_user", account: "42", chatId: "9001", title: "Tomas Viera", seenAt: ago(5), why: "ambiguous", by: "phone", candidates: [{ key: "n-1", name: "Tomas Viera", email: "tomas@example.test", relationship: "Lead" }, { key: "n-2", name: "T. Viera (office)", email: "office@example.test", relationship: "Client" }], last: { at: ago(5), inbound: true }, username: null, phone: "+351911000999" },
  { channel: "whatsapp", account: "351900000001", chatId: "+351911000111", title: "Joana", seenAt: ago(120), why: "none", by: null, candidates: [], last: { at: ago(120), inbound: true }, username: null, phone: "+351911000111" },
  { channel: "telegram_user", account: "42", chatId: "9002", title: "Delivery bot fan", seenAt: ago(60 * 26), why: "none", by: null, candidates: [], last: { at: ago(60 * 26), inbound: true }, username: "suenot", phone: null },
];
/** P102: Not linked also holds a chat of any age (the fresh window drops it from To do). */
export const OLD: Recent = { channel: "telegram_user", account: "42", chatId: "9003", title: "Old Olga", seenAt: ago(60 * 24 * 20), why: "none", by: null, candidates: [], last: { at: ago(60 * 24 * 20), inbound: true }, username: null, phone: null };

/** Both accounts connected and the autolink's state, with Hide and Unhide moving a chat between the lists. Returns the POSTs. */
/** P128 X5: an agent's proposed hide of a remembered chat, as the server's state lists it. */
export type Proposal = { channel: "telegram_user" | "whatsapp"; account: string; chatId: string; title: string; reason: string; at: string };

export async function stubChats(page: Page, o: { proposals?: Proposal[] } = {}) {
  let proposals = [...(o.proposals ?? [])];
  const posts: { path: string; body: unknown }[] = [];
  let recent = [...RECENT];
  let hidden: { channel: "telegram_user" | "whatsapp"; account: string | null; chatId: string; title: string; hiddenAt: string }[] = [{ channel: "whatsapp", account: "351900000001", chatId: "+351922000222", title: "Spam Sender", hiddenAt: ago(60 * 50) }];
  await page.route(/\/api\/messengers\/telegram-user$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: [{ account: "42", state: "running", parked: null, fix: null, failures: 0, stored: 0 }] } }));
  await page.route(/\/api\/messengers\/whatsapp$/, (r) => r.fulfill({ json: { state: "on", project: P, accounts: [{ account: "351900000001", state: "running", parked: null, fix: null, failures: 0, stored: 0 }] } }));
  await page.route(/\/messengers\/autolink\/state$/, (r) => r.fulfill({ json: { enabled: true, directory: dir, unlinkedActive: 2, recent, unlinked: [...recent, OLD], freshDays: 14, hidden, hiddenUnnamed: 1, proposals: proposals.filter((p) => recent.some((x) => x.chatId === p.chatId)) } }));
  await page.route(/\/messengers\/autolink\/proposals\/drop$/, async (r) => {
    const body = r.request().postDataJSON() as { items: { chatId: string }[] };
    posts.push({ path: new URL(r.request().url()).pathname, body });
    proposals = proposals.filter((p) => !body.items.some((i) => i.chatId === p.chatId));
    await r.fulfill({ json: { ok: true } });
  });
  const move = (to: "hidden" | "recent") => async (r: Route) => {
    const body = r.request().postDataJSON() as { channel: "telegram_user" | "whatsapp"; chatId: string };
    posts.push({ path: new URL(r.request().url()).pathname, body });
    if (to === "hidden") {
      const row = recent.find((x) => x.chatId === body.chatId);
      recent = recent.filter((x) => x.chatId !== body.chatId);
      hidden = [{ channel: body.channel, account: row?.account ?? null, chatId: body.chatId, title: row?.title ?? body.chatId, hiddenAt: new Date().toISOString() }, ...hidden];
    } else {
      const row = hidden.find((x) => x.chatId === body.chatId);
      hidden = hidden.filter((x) => x.chatId !== body.chatId);
      const back = RECENT.find((x) => x.chatId === body.chatId);
      if (back) recent = [back, ...recent];
      else if (row) recent = [{ channel: row.channel, account: "1", chatId: row.chatId, title: row.title, seenAt: ago(1), why: "none", by: null, candidates: [], last: { at: ago(1), inbound: true }, username: null, phone: null }, ...recent];
    }
    await r.fulfill({ json: { ok: true, channel: body.channel, chatId: body.chatId, hidden: to === "hidden" } });
  };
  // P100: the link box. Notion is stubbed: "Евгений" finds a namesake and the card made a minute ago; Create links the chat.
  await page.route(/\/messengers\/autolink\/records$/, async (r) => {
    const { q } = r.request().postDataJSON() as { q: string };
    posts.push({ path: new URL(r.request().url()).pathname, body: { q } });
    const all = [
      { key: "n-ten", name: "Евгений Тен", email: "john.ten@example.test", relationship: "Lead" },
      { key: "n-evg", name: "Евгений", email: "suenot@example.test", relationship: null },
    ];
    const t = q.replace(/^@/, "").toLowerCase();
    await r.fulfill({ json: { records: all.filter((x) => x.name.toLowerCase().includes(t) || x.email.includes(t)), live: true, liveError: null } });
  });
  const linked = async (r: Route) => {
    const body = r.request().postDataJSON() as { chatId: string };
    posts.push({ path: new URL(r.request().url()).pathname, body });
    recent = recent.filter((x) => x.chatId !== body.chatId);
    const created = r.request().url().endsWith("/create");
    await r.fulfill({ json: { ok: true, chatId: body.chatId, imported: 7, importError: null, days: 30, notion: created ? "Created Evgeniy in Notion with Telegram suenot" : "Telegram set to suenot in Notion" } });
  };
  await page.route(/\/messengers\/autolink\/link$/, linked);
  await page.route(/\/messengers\/autolink\/create$/, linked);
  // P102: Link a chat… (the dialogs of each account marked against the picked record), Change client and its Undo, Unlink.
  await page.route(/\/messengers\/autolink\/dialogs$/, async (r) => {
    posts.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    const wa = (r.request().postDataJSON() as { channel: string }).channel === "whatsapp";
    await r.fulfill({ json: { dialogs: wa ? [] : [{ chatId: "9002", title: "Delivery bot fan", username: "suenot", phone: null, suggested: true, linked: false }, { chatId: "700100", title: "Rita F.", username: null, phone: null, suggested: false, linked: true }] } });
  });
  await page.route(/\/messengers\/chats\/\d+\/client$/, async (r) => {
    posts.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    await r.fulfill({ json: { ok: true, id: 1, fromClientId: 7, fromName: "Rita Falsa", toName: "Евгений", skippedDraftId: 11, notion: "Telegram set to ritaf in Notion" } });
  });
  await page.route(/\/messengers\/chats\/\d+\/client\/undo$/, async (r) => {
    posts.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    await r.fulfill({ json: { ok: true, id: 1, draftRestored: true } });
  });
  await page.route(/\/messengers\/chats\/\d+\/(unlink|never)$/, async (r) => {
    // The seed's linked chats are other specs' fixtures: the unlink is stubbed, never reaches the real server.
    posts.push({ path: new URL(r.request().url()).pathname, body: r.request().postDataJSON() });
    await r.fulfill({ json: { ok: true, id: 1, never: r.request().url().endsWith("/never") } });
  });
  await page.route(/\/messengers\/autolink\/hide$/, move("hidden"));
  await page.route(/\/messengers\/autolink\/unhide$/, move("recent"));
  return { posts };
}
