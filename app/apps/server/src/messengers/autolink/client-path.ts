import type { Context } from "hono";
import { agentChatLinkedDto } from "@hub/contract/messengers";
import { chatClientTitle, isRealName, plainName } from "@hub/config/profile";
import { humanActor, linkUserChatToRecord, type HumanActor } from "@hub/messengers/human";
import { findClientPages } from "@hub/notion";
import { createChatClient, fillChatIdentity, findChatClientPages } from "@hub/notion/chat-client";
import { entryOf } from "../../clients/directory";
import { notFound } from "../../http/http";
import type { MessengersContext } from "../context";
import type { chatIdentityKit } from "./chat-identity";
import { clientWithoutChat, nameWithCompany, type NewClientBody } from "./client-new";
import type { ProjectAutolink } from "./setup";

/**
 * P100, P143 L2: the one path of Link and Create from a chat, shared by the owner's doors (the admin) and the agent's (attended,
 * `hub mcp` with the agent token), so both link, fill the card and read it back the same way. The routes stay in `routes.ts`.
 */
export function clientPath({ repos, kit }: { repos: MessengersContext["repos"]; kit: ReturnType<typeof chatIdentityKit> }) {
  const { identityFor, ownIdentity, fillLine, fillCard } = kit;
  type UserChannel = "telegram_user" | "whatsapp";
  type Linked = { pageId: string; name: string; imported: number; importError: string | null; notion: string | null; how: "created" | "linked_existing" | "linked" };
  type Refused = { refused: string; code: "wrong_state" | "not_found" };

  /**
   * P100, P143 L2: the one Link of a chat to a client record, the owner's (the admin) and the agent's (attended): the link, the
   * hidden chat's refusal forgotten, the chat's number or username filled into the card's empty field, and the card read back.
   */
  async function linkToRecord(slug: string, a: ProjectAutolink, actor: HumanActor, b: { channel: UserChannel; account: string; chatId: string; key: string; title?: string | undefined }): Promise<Linked | Refused> {
    const rec = a.autolink.record(b.key);
    if (!rec) return { refused: "That client record is not in the directory now.", code: "wrong_state" };
    const adapter = a.autolink.adapterOf(b.channel, b.account);
    if (!adapter) return { refused: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" };
    // P141 C1: a record links whether or not it has an Email; the Hub's client row is keyed by its card.
    const r = await linkUserChatToRecord({ repos, adapter }, actor, { project: slug, client: { pageId: rec.key, email: rec.email, name: rec.name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}), ...(await ownIdentity(a, slug, b.channel, b.chatId)) });
    // P102: a hidden chat linked by hand forgets its refusal in the same call.
    await a.autolink.forget(b.channel, b.chatId);
    // P100: the chat's username or number into the card's empty Telegram or WhatsApp, so the next chat links by itself. Never an overwrite.
    const notion = await fillCard(a, slug, rec.key, b.channel, b.chatId);
    // P143 N2: the card as it is now names the Hub's client (after a Hub write to it).
    void a.directory.readCard(rec.key, { force: true });
    return { pageId: rec.key, name: rec.name || rec.email || "the client", imported: r.imported, importError: r.importError, notion, how: "linked" };
  }

  /**
   * P100, P141 C3, P143 L2: Create from this chat, the owner's and the agent's: a card that already holds the email, or exactly this
   * chat's username or number, is linked instead; else one Clients card (Name, the Email when known, Relationship Lead, the chat's
   * username or number) is made, put into memory and the chat linked to it. A name that is only a number takes the channel's
   * placeholder ("WhatsApp +55…", P141 verdict 18), never the bare number. Insert content refused: nothing made, the fix said.
   */
  async function createFromChat(slug: string, a: ProjectAutolink, actor: HumanActor, b: { channel: UserChannel; account: string; chatId: string; title?: string | undefined; name: string; email?: string | null | undefined }): Promise<Linked | Refused> {
    if ((await a.autolink.state()).project !== slug) return { refused: "The autolink serves another project.", code: "wrong_state" };
    if (!a.directory.dataSourceId) return { refused: "This project has no Clients database in project.md.", code: "wrong_state" };
    const adapter = a.autolink.adapterOf(b.channel, b.account);
    if (!adapter) return { refused: "That account is not connected (parked, stopped or unknown): see its state.", code: "wrong_state" };
    if (await repos.messengers.isLinked(slug, b.channel, b.chatId)) return { refused: "That chat is already linked.", code: "wrong_state" };
    const identity = await identityFor(a, slug, b.channel, b.chatId);
    const own = await ownIdentity(a, slug, b.channel, b.chatId);
    const email = b.email ?? null;
    const name = isRealName(b.name, email) ? plainName(b.name) : chatClientTitle({ channel: identity.channel, username: identity.username, phone: identity.phone, chatId: b.chatId });
    const deps = await a.directory.notion();
    // A card with this email, or with exactly this chat's username or number, already: link to it, never a second one.
    const existing = (email ? await findClientPages(deps.reader, a.directory.dataSourceId, email) : await findChatClientPages(deps.reader, a.directory.dataSourceId, identity))[0];
    if (existing) {
      const entry = entryOf(existing as never);
      if (entry) a.directory.put(entry);
      const r = await linkUserChatToRecord({ repos, adapter }, actor, { project: slug, client: { pageId: existing.id, email: entry?.email ?? email, name: entry?.name || name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}), ...own });
      await a.autolink.forget(b.channel, b.chatId);
      const filled = fillLine(await fillChatIdentity(deps, { clientsDataSource: a.directory.dataSourceId, pageId: existing.id, identity }));
      const who = entry?.name || email || "this chat";
      return { pageId: existing.id, name: who, imported: r.imported, importError: r.importError, notion: `Linked to the existing card of ${who}${filled ? `; ${filled}` : ""}`, how: "linked_existing" };
    }
    const made = await createChatClient(deps, { clientsDataSource: a.directory.dataSourceId, name, email, identity });
    if (made.state !== "created") return { refused: made.note, code: "wrong_state" };
    const entry = entryOf(made.page as never);
    if (entry) a.directory.put(entry);
    const r = await linkUserChatToRecord({ repos, adapter }, actor, { project: slug, client: { pageId: made.pageId, email, name }, chatId: b.chatId, ...(b.title ? { title: b.title } : {}), ...own });
    await a.autolink.forget(b.channel, b.chatId);
    const field = identity.channel === "telegram" ? (identity.username ?? identity.phone) : identity.phone;
    return { pageId: made.pageId, name, imported: r.imported, importError: r.importError, notion: `Created ${name} in Notion${field ? ` with ${identity.channel === "telegram" ? "Telegram" : "WhatsApp"} ${field}` : ""}`, how: "created" };
  }
  const refusedOf = (c: Context, r: Refused) => c.json({ error: r.refused, code: r.code }, r.code === "not_found" ? 404 : 409);

  /** P143 L2: the agent's chat doors, on a known user chat of this project. Only `hub mcp` of a session the owner started calls them (its token; a background run has no such tool). */
  async function agentChat(c: Context, slug: string, chat: number): Promise<{ row: NonNullable<Awaited<ReturnType<MessengersContext["repos"]["messengers"]["chatById"]>>>; channel: UserChannel; account: string } | Response> {
    const row = await repos.messengers.chatById(slug, chat);
    if (!row) return notFound(c, "chat");
    if (row.channel === "telegram_bot") return c.json({ error: "A bot chat is not linked by the autolink.", code: "wrong_state" as const }, 409);
    if (!row.account) return c.json({ error: "The Hub does not know which account reads this chat yet: the owner links it in the admin.", code: "wrong_state" as const }, 409);
    return { row, channel: row.channel, account: row.account };
  }
  const agentActor = () => humanActor("agent (owner present)");

  const createWithoutChat = clientWithoutChat({ repos });

  /**
   * P143 L2: the agent's Create, from this chat (one lookup by the person's identities first, P141 C2, else `createFromChat`) or,
   * with no chat, a Clients card alone (`clientWithoutChat`).
   */
  async function agentCreate(c: Context, slug: string, a: ProjectAutolink, b: NewClientBody & { chat?: number | undefined }): Promise<Response> {
    if (b.chat === undefined) return createWithoutChat(c, slug, a, b);
    const at = await agentChat(c, slug, b.chat);
    if (at instanceof Response) return at;
    // P141 C2: one lookup by the person's identities first: a client the Hub knows by this email or this number is linked to.
    const phone = at.channel === "whatsapp" && /^\+\d{7,15}$/.test(at.row.chatId) ? at.row.chatId : at.row.phone ? `+${at.row.phone.replace(/\D/g, "")}` : null;
    const byPhone = async (n: string) => (await repos.clients.findByIdentity(slug, "phone", n)) ?? (await repos.clients.findByIdentity(slug, "whatsapp", n));
    const known = (b.email ? await repos.clients.findByIdentity(slug, "email", b.email) : undefined) ?? (phone ? await byPhone(phone) : undefined);
    const page = known === undefined ? null : ((await repos.clients.notionPageOf(slug, known)) ?? null);
    if (page) {
      await a.directory.readCard(page, { force: true });
      const r = await linkToRecord(slug, a, agentActor(), { channel: at.channel, account: at.account, chatId: at.row.chatId, key: page, ...(at.row.title ? { title: at.row.title } : {}) });
      if ("refused" in r) return refusedOf(c, r);
      return c.json(agentChatLinkedDto.parse({ ok: true, chat: b.chat, clientId: known ?? null, name: r.name, how: "linked_existing", notion: r.notion, imported: r.imported, importError: r.importError }));
    }
    const name = nameWithCompany(b.name, b.company);
    const r = await createFromChat(slug, a, agentActor(), { channel: at.channel, account: at.account, chatId: at.row.chatId, name, ...(at.row.title ? { title: at.row.title } : {}), ...(b.email ? { email: b.email } : {}) });
    if ("refused" in r) return refusedOf(c, r);
    const clientId = (await repos.clients.findByNotionPage(slug, r.pageId)) ?? null;
    return c.json(agentChatLinkedDto.parse({ ok: true, chat: b.chat, clientId, name: r.name, how: r.how, notion: r.notion, imported: r.imported, importError: r.importError }));
  }

  return { linkToRecord, createFromChat, refusedOf, agentChat, agentActor, agentCreate };
}
