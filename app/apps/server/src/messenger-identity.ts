import { NO_CONTACT, phoneDigits, type ContactLinksDto } from "@hub/contract/local";
import type { MessengerChatDto, MessengerNotionIdentityDto } from "@hub/contract/messenger-panel";
import type { ClientDirectory } from "./client-directory";

type ClientSource = { id: number; name: string; email: string };
type NotionSource = { notionPageId: string | null; notionUrl: string | null } | null;
/** A chat's own identity as the autolink memory saw it (Telegram username and phone), when the server runs one. */
export type ChatIdentityOf = (channel: "telegram_user" | "whatsapp", chatId: string) => { username: string | null; phone: string | null } | null;
type IdentitySource = { project: string | null; directory: Pick<ClientDirectory, "current">; identityOf?: ChatIdentityOf };
type ClientDto = NonNullable<MessengerChatDto["client"]>;

export type MessengerIdentityResolver = ReturnType<typeof createMessengerIdentityResolver>;

export function createMessengerIdentityResolver(source: IdentitySource | undefined) {
  const index = (slug: string): ReadonlyMap<string, string> => {
    if (source?.project !== slug) return new Map();
    return new Map((source.directory.current()?.all ?? []).flatMap((entry) => (entry.email ? [[entry.email.trim().toLowerCase(), entry.key] as const] : [])));
  };

  const resolve = (slug: string, email: string | null, ref: NotionSource): MessengerNotionIdentityDto => {
    const directoryKey = email ? index(slug).get(email.trim().toLowerCase()) ?? null : null;
    const pageId = ref?.notionPageId ?? directoryKey;
    const url = ref?.notionUrl ?? null;
    return {
      state: pageId || url ? "resolved" : source?.project === slug && source.directory.current() ? "unresolved" : "unavailable",
      pageId,
      url,
    };
  };

  const client = (slug: string, value: ClientSource | null, ref: NotionSource): ClientDto | null => {
    if (!value) return null;
    const notion = resolve(slug, value.email, ref);
    return { ...value, notionPageId: notion.pageId, notionUrl: notion.url, notion };
  };

  /**
   * P131 O5: the Telegram username or phone and the WhatsApp number to open a chat with: the chat's own identity first (a
   * WhatsApp chat id is the number), then the client's Notion card (the directory's `Telegram`, `WhatsApp` and phone fields).
   * Memory only, never a Notion read here; nulls when nothing is known.
   */
  const contact = (slug: string, o: { email?: string | null; pageId?: string | null; chat?: { channel: string; chatId: string } }): ContactLinksDto => {
    const all = source?.project === slug ? (source.directory.current()?.all ?? []) : [];
    const key = o.pageId?.replaceAll("-", "").toLowerCase() ?? (o.email ? index(slug).get(o.email.trim().toLowerCase()) : undefined);
    const entry = key ? all.find((e) => e.key.replaceAll("-", "").toLowerCase() === key.replaceAll("-", "").toLowerCase()) : undefined;
    const phones = (channel: "telegram" | "whatsapp") => (entry?.identifiers ?? []).flatMap((i) => (i.kind === "phone" && (i.channel === channel || i.channel === undefined) ? [{ value: i.value, exact: i.channel === channel }] : []));
    const best = (channel: "telegram" | "whatsapp") => {
      const list = phones(channel);
      return phoneDigits((list.find((p) => p.exact) ?? list[0])?.value);
    };
    const card: ContactLinksDto = entry
      ? { telegramUsername: entry.identifiers.find((i) => i.kind === "username")?.value ?? null, telegramPhone: best("telegram"), whatsappPhone: best("whatsapp") }
      : NO_CONTACT;
    // The chat's own Telegram identity comes before the card's (verdict 10: it is the conversation he means).
    if (o.chat?.channel === "telegram_user") {
      const own = source?.project === slug ? source.identityOf?.("telegram_user", o.chat.chatId) : null;
      const username = own?.username?.replace(/^@/, "") || null;
      const phone = phoneDigits(own?.phone);
      if (username || phone) return { ...card, telegramUsername: username ?? card.telegramUsername, telegramPhone: phone ?? card.telegramPhone };
    }
    // A WhatsApp chat id is its number; anything else (a group's id) gives no link by id.
    if (o.chat?.channel === "whatsapp") return { ...card, whatsappPhone: /^\+?\d{7,15}$/.test(o.chat.chatId) ? phoneDigits(o.chat.chatId) : null };
    return card;
  };

  return { client, contact, index, resolve };
}
