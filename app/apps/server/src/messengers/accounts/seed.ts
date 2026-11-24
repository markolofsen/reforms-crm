import type { Repos } from "@hub/db";
import { CACHE_DAYS, ingest, type InboundMessage, type UserDialog, type WaAddress, type WaAppSession } from "@hub/messengers";
import { errFields, ops } from "@hub/log/ops";

/**
 * P141 U2 (coordinator's verdict a, decision 0049 point 6): the known chats start from the recent conversations, so the Messengers
 * list shows what the owner sees in WhatsApp and Telegram, not only what wrote since the Hub started.
 * - WhatsApp: the Mac app's private chats with a message in the last `SEED_DAYS`, read one at a time (read only, local).
 * - Telegram: the account's dialogs with a message in the last `SEED_DAYS`, at most `SEED_TELEGRAM_MAX` history reads on his main
 *   account (0036 point 2), once per connect.
 * Each chat's messages go through the one ingest with the cache: a chat becomes known only when the person wrote in it, never one
 * the owner hid, never a group. Chats cached before their row existed (P141 W2) get it here. Nothing is linked: that is the
 * autolink's (an exact phone or username) or the owner's. One ops line, counts only.
 */
export const SEED_DAYS = 14;
export const SEED_TELEGRAM_MAX = 30;
/** At most this many WhatsApp chats are read from the Mac's app in one seed. */
export const SEED_WHATSAPP_MAX = 200;

type Hidden = (chatId: string) => Promise<boolean>;

/** Gives every chat whose inbound messages were cached before it had a row (W2) its known row. Returns how many. */
export async function adoptCached(repos: Repos, project: string, channel: "whatsapp" | "telegram_user", hidden: Hidden): Promise<number> {
  let n = 0;
  for (const chatId of await repos.messengers.cachedWithoutRow(project, channel)) {
    if (await hidden(chatId)) continue;
    if (await repos.messengers.knowChat(project, channel, chatId, channel === "whatsapp" && !chatId.startsWith("lid:") ? { phone: chatId } : {})) n++;
  }
  return n;
}

export async function seedWhatsApp(o: {
  repos: Repos;
  project: string;
  account: string;
  hidden: Hidden;
  recent: (since: Date, limit: number) => WaAppSession[];
  read: (chat: WaAddress, since: Date, account: string) => InboundMessage[];
  cacheDays: number;
  now?: () => Date;
}): Promise<{ adopted: number; seeded: number }> {
  const at = (o.now ?? (() => new Date()))();
  const log = ops("whatsapp");
  try {
    const adopted = await adoptCached(o.repos, o.project, "whatsapp", o.hidden);
    let seeded = 0;
    const since = new Date(at.getTime() - o.cacheDays * 86_400_000);
    for (const s of o.recent(new Date(at.getTime() - SEED_DAYS * 86_400_000), SEED_WHATSAPP_MAX)) {
      if (s.chatId === `+${o.account}` || (await o.repos.messengers.isKnown(o.project, "whatsapp", s.chatId)) || (await o.hidden(s.chatId))) continue;
      const rows = o.read({ chatId: s.chatId, jid: s.jid }, since, o.account).map((m) => ({ ...m, chatJid: s.jid, ...(s.name ? { chatTitle: s.name } : {}) }));
      const r = await ingest({ project: o.project, repos: o.repos, now: () => at, retentionDays: o.cacheDays, cache: { channel: "whatsapp", hidden: o.hidden } }, rows);
      if (r.stored && (await o.repos.messengers.isKnown(o.project, "whatsapp", s.chatId))) seeded++;
    }
    if (adopted || seeded) log.info("known chats seeded from the Mac's WhatsApp app", { account: o.account, adopted, seeded });
    return { adopted, seeded };
  } catch (e) {
    log.warn("seeding the known chats failed", { account: o.account, ...errFields(e) });
    return { adopted: 0, seeded: 0 };
  }
}

export async function seedTelegram(o: {
  repos: Repos;
  project: string;
  account: string;
  hidden: Hidden;
  dialogs: (limit: number) => Promise<UserDialog[]>;
  history: (chatId: string, h: { since: Date; limit?: number }) => Promise<InboundMessage[]>;
  now?: () => Date;
}): Promise<{ adopted: number; seeded: number }> {
  const at = (o.now ?? (() => new Date()))();
  const log = ops("telegram");
  try {
    const adopted = await adoptCached(o.repos, o.project, "telegram_user", o.hidden);
    const fresh = at.getTime() - SEED_DAYS * 86_400_000;
    let reads = 0;
    let seeded = 0;
    for (const d of await o.dialogs(200)) {
      if (reads >= SEED_TELEGRAM_MAX) break;
      if (!d.last || Date.parse(d.last.at) < fresh) continue;
      if ((await o.repos.messengers.isKnown(o.project, "telegram_user", d.chatId)) || (await o.hidden(d.chatId))) continue;
      reads++;
      const rows = await o.history(d.chatId, { since: new Date(at.getTime() - CACHE_DAYS * 86_400_000), limit: 50 });
      const r = await ingest({ project: o.project, repos: o.repos, now: () => at, retentionDays: CACHE_DAYS, cache: { channel: "telegram_user", hidden: o.hidden } }, rows.map((m) => ({ ...m, backfill: true })));
      if (r.stored && (await o.repos.messengers.isKnown(o.project, "telegram_user", d.chatId))) seeded++;
    }
    if (adopted || seeded) log.info("known chats seeded from the Telegram dialogs", { account: o.account, adopted, seeded, reads });
    return { adopted, seeded };
  } catch (e) {
    log.warn("seeding the known chats failed", { account: o.account, ...errFields(e) });
    return { adopted: 0, seeded: 0 };
  }
}
