import type { Repos } from "@hub/db";
import { fillChatIdentity, type ChatIdentity, type FillOutcome } from "@hub/notion/chat-client";
import { ops } from "@hub/log/ops";
import type { ProjectAutolink } from "./setup";

type UserChannel = "telegram_user" | "whatsapp";

/**
 * What the autolink's doors know of a chat's own identity (its username and phone) and how they write it to a Notion card: the
 * memory's, else the known chat's row (P141 U2: a seeded chat was never in memory). Never an overwrite in Notion.
 */
export function chatIdentityKit(repos: Repos) {
  /** P100: the chat's identity for Notion: its username, and its phone in +E.164 (Telegram hands digits without the `+`). */
  const identityFor = async (al: ProjectAutolink, slug: string, channel: UserChannel, chatId: string): Promise<ChatIdentity> => {
    const id = await identityOf(al, slug, channel, chatId);
    const digits = (id?.phone ?? "").replace(/\D/g, "");
    return { channel: channel === "whatsapp" ? "whatsapp" : "telegram", username: id?.username ?? null, phone: digits.length >= 7 ? `+${digits}` : null };
  };
  /** P131 O5: what the memory knows of the chat's own username and phone, kept on the chat row at link time. */
  const ownIdentity = async (al: ProjectAutolink, slug: string, channel: UserChannel, chatId: string) => {
    const id = await identityOf(al, slug, channel, chatId);
    return id ? { identity: { username: id.username, phone: id.phone } } : {};
  };
  /** The chat's username and phone: the memory's, else the known chat's row (P141 U2: a seeded chat was never in memory). */
  async function identityOf(al: ProjectAutolink, slug: string, channel: UserChannel, chatId: string): Promise<{ username: string | null; phone: string | null } | null> {
    const mem = al.autolink.identityOf(channel, chatId);
    if (mem) return mem;
    const row = await repos.messengers.chat(slug, channel, chatId);
    if (row && (row.username || row.phone)) return { username: row.username ?? null, phone: row.phone ?? null };
    return channel === "whatsapp" && !chatId.startsWith("lid:") ? { username: null, phone: chatId } : null;
  }
  const fillLine = (f: FillOutcome): string | null => (f.state === "written" ? `${f.property} set to ${f.value} in Notion` : f.state === "refused" ? f.note : f.reason.startsWith("nothing") ? null : `${f.reason} in Notion, kept`);

  /** P100: writes the chat's username or number into the card's empty Telegram or WhatsApp field; a failure leaves the link standing and is said in one line. */
  async function fillCard(al: ProjectAutolink, slug: string, pageId: string, channel: UserChannel, chatId: string): Promise<string | null> {
    if (!al.directory.dataSourceId) return null;
    try {
      return fillLine(await fillChatIdentity(await al.directory.notion(), { clientsDataSource: al.directory.dataSourceId, pageId, identity: await identityFor(al, slug, channel, chatId) }));
    } catch (e) {
      ops("notion").warn("filling the chat's field on the client failed", { error: e instanceof Error ? e.name : "error" });
      return "The Hub could not fill the chat's field in Notion (see the ops log); the link stands";
    }
  }

  return { identityFor, ownIdentity, fillLine, fillCard };
}
