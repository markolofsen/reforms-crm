import type { Context } from "hono";
import { agentChatLinkedDto } from "@hub/contract/messengers";
import { isRealName, plainName } from "@hub/config/profile";
import { findClientPages } from "@hub/notion";
import { createChatClient, findChatClientPages, type ChatIdentity } from "@hub/notion/chat-client";
import { entryOf } from "../../clients/directory";
import type { MessengersContext } from "../context";
import type { ProjectAutolink } from "./setup";

/** The name the card takes: the person's, with the company after a comma when the name does not already say it. */
export const nameWithCompany = (name: string, company?: string): string => (company && !name.toLowerCase().includes(company.toLowerCase()) ? `${name}, ${company}` : name);

/** What the agent gave for a client with no chat (P143): a name and at least one identity; the route's schema checked both. */
export type NewClientBody = { name: string; email?: string | undefined; phone?: string | undefined; telegram?: string | undefined; company?: string | undefined };

/**
 * P143 L2: the agent's Create with no chat (attended only; `clientPath` checks that first). One lookup by every identity given
 * (P141 C2): a Hub client by its email, phone, WhatsApp number or Telegram username, then a Clients card by its email or by this
 * number or username; a hit is answered and nothing is made. Else one Clients card through the chat Create's own door
 * (`createChatClient`: Name, Email, Phone, Telegram, Relationship Lead), put into the directory's memory. No Hub row is made: a
 * `clients` row comes with a draft, a kept message or a linked chat (rule 16, decision 0009).
 */
export function clientWithoutChat({ repos }: { repos: MessengersContext["repos"] }) {
  const answer = (c: Context, v: { clientId: number | null; name: string; how: "created" | "existing"; notion: string }) => c.json(agentChatLinkedDto.parse({ ok: true, chat: null, imported: 0, importError: null, ...v }));

  /** A Hub client of this project with any of these identities, or undefined. */
  async function hubClient(slug: string, b: { email: string | null; phone: string | null; username: string | null }): Promise<number | undefined> {
    const tries: Array<[Parameters<typeof repos.clients.findByIdentity>[1], string | null]> = [["email", b.email], ["phone", b.phone], ["whatsapp", b.phone], ["telegram_username", b.username]];
    for (const [kind, value] of tries) {
      const id = value ? await repos.clients.findByIdentity(slug, kind, value) : undefined;
      if (id !== undefined) return id;
    }
    return undefined;
  }

  return async function createWithoutChat(c: Context, slug: string, a: ProjectAutolink, b: NewClientBody): Promise<Response> {
    const ds = a.directory.dataSourceId;
    if (!ds) return c.json({ error: "This project has no Clients database in project.md.", code: "wrong_state" as const }, 409);
    const name = plainName(nameWithCompany(b.name, b.company));
    const email = b.email ?? null;
    if (!isRealName(name, email)) return c.json({ error: "Give the person's or the company's name, not a number or an address.", code: "invalid" as const }, 400);
    const phone = b.phone ? `+${b.phone.replace(/\D/g, "")}` : null;
    const username = b.telegram ? b.telegram.replace(/^@/, "") : null;
    const known = await hubClient(slug, { email, phone, username });
    if (known !== undefined) {
      const row = await repos.clients.get(slug, known);
      const page = await repos.clients.notionPageOf(slug, known);
      return answer(c, { clientId: known, name: row?.name || name, how: "existing", notion: page ? "Already a Hub client with its Clients card; nothing was created" : "Already a Hub client (no Clients card yet); nothing was created" });
    }
    const deps = await a.directory.notion();
    const identity: ChatIdentity = { channel: "telegram", username, phone };
    const existing = [...(email ? await findClientPages(deps.reader, ds, email) : []), ...(phone || username ? await findChatClientPages(deps.reader, ds, identity) : [])][0];
    if (existing) {
      const entry = entryOf(existing as never);
      if (entry) a.directory.put(entry);
      const who = entry?.name || email || name;
      return answer(c, { clientId: (await repos.clients.findByNotionPage(slug, existing.id)) ?? null, name: who, how: "existing", notion: `An existing Clients card of ${who}; nothing was created` });
    }
    const made = await createChatClient(deps, { clientsDataSource: ds, name, email, phone, identity: username ? { channel: "telegram", username, phone: null } : null });
    if (made.state !== "created") return c.json({ error: made.note, code: "wrong_state" as const }, 409);
    const entry = entryOf(made.page as never);
    if (entry) a.directory.put(entry);
    const fields = [email && "Email", phone && "Phone", username && "Telegram"].filter(Boolean).join(", ");
    return answer(c, { clientId: null, name, how: "created", notion: `Created ${name} in Notion with ${fields}` });
  };
}
