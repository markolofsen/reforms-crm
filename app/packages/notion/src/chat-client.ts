// P100: the Hub's writes for a messenger chat, and nothing else. In the project's Clients data source it creates one card on the
// owner's click (Name, Email, Relationship Lead, and the chat's Telegram username or WhatsApp number) and, after the owner links a
// chat to a card, fills that card's `Telegram` or `WhatsApp` with the chat's identity ONLY when the property is empty. Never an
// overwrite, never another property, never a delete. Like `stamp.ts` and `lead-convert.ts` there is no generic page update here.
// It also builds the read-only live search the link box runs (one data source query, `contains` over the identity properties).
import notionhq from "@notionhq/client";
import { notionSdkLog } from "./sdk-log";
import { newClientProperties, notionFailure } from "./lead-convert";
import { ops } from "@hub/log/ops";
import type { DataSourceInfo, NotionReader, PageObject, PropertyValue } from "./types";

/** The chat's two identity properties of the pack's Clients (`schema/clients.json`). */
export type ChatProperty = "Telegram" | "WhatsApp";

export interface ChatClientWriter {
  /** One new Clients page with these property values; returns its id. */
  createClient(clientsDataSource: string, properties: Record<string, unknown>): Promise<string>;
  /** The page as it is now (to see whether a property is empty right before the write). */
  retrievePage(pageId: string): Promise<PageObject>;
  /** Exactly one property of one page: `Telegram` (text) or `WhatsApp` (phone number). The caller checked it is empty. */
  fillEmpty(pageId: string, property: { name: ChatProperty; type: "rich_text" | "phone_number" }, value: string): Promise<void>;
}

export function createChatClientWriter(token: string, options: { fetch?: typeof fetch } = {}): ChatClientWriter {
  const client = new notionhq.Client({ auth: token, timeoutMs: 30_000, retry: { maxRetries: 2, initialRetryDelayMs: 1000, maxRetryDelayMs: 10_000 }, ...notionSdkLog, ...(options.fetch ? { fetch: options.fetch as never } : {}) });
  return {
    async createClient(clientsDataSource, properties) {
      const r = (await client.pages.create({ parent: { data_source_id: clientsDataSource }, properties: properties as never })) as { id: string };
      return r.id;
    },
    async retrievePage(pageId) {
      return (await client.pages.retrieve({ page_id: pageId })) as unknown as PageObject;
    },
    async fillEmpty(pageId, property, value) {
      const v = property.type === "phone_number" ? { phone_number: value.slice(0, 60) } : { rich_text: [{ type: "text", text: { content: value.slice(0, 200) } }] };
      await client.pages.update({ page_id: pageId, properties: { [property.name]: v } as never });
    },
  };
}

const OTHER_EMAILS = /^(other|more|alt(ernative)?)\s*e-?mails?$/i;
const NUMBER_PROPS = /^(phone|mobile|tel|whatsapp)$/i;

/** The search term as the owner typed it, and its digits when it reads as a number (a phone, a WhatsApp chat id). */
export function searchTerms(q: string): { text: string; digits: string | null } {
  const text = q.trim().replace(/^@/, "");
  const digits = text.replace(/[\s\-().+]/g, "");
  return { text, digits: /^\d{5,15}$/.test(digits) ? digits : null };
}

/**
 * The read-only live search's filter: `contains` over the data source's title, email properties, `Other emails`, its phone
 * properties (with the digits when the term is a number) and `Telegram`. Null when the schema has none of them. Pure.
 */
export function chatSearchFilter(ds: DataSourceInfo, q: string): unknown {
  const { text, digits } = searchTerms(q);
  if (text.length < 2) return null;
  const or: unknown[] = [];
  for (const [name, c] of Object.entries(ds.properties)) {
    if (c.type === "title") or.push({ property: name, title: { contains: text } });
    else if (c.type === "email") or.push({ property: name, email: { contains: text.toLowerCase() } });
    else if (c.type === "rich_text" && (OTHER_EMAILS.test(name) || /^telegram$/i.test(name))) or.push({ property: name, rich_text: { contains: text } });
    else if (c.type === "phone_number" || (c.type === "rich_text" && NUMBER_PROPS.test(name))) {
      // A phone is stored as typed ("+7 912 …"): the digits' last 7 find it whatever the spacing of the first ones.
      if (digits) or.push({ property: name, [c.type]: { contains: digits.slice(-7) } });
    }
  }
  return or.length ? { or } : null;
}

/** The live search: at most `limit` pages of the Clients data source matching the term. Read only. */
export async function searchClientPages(reader: NotionReader, dataSourceId: string, q: string, limit = 8): Promise<PageObject[]> {
  if (!reader.findPages) return [];
  const ds = await reader.retrieveDataSource(dataSourceId);
  const filter = chatSearchFilter(ds, q);
  return filter ? reader.findPages(dataSourceId, filter, limit) : [];
}

/**
 * P141 C3: the Clients cards that hold exactly this chat's identity (its Telegram username, or its number in Phone, WhatsApp or
 * Telegram), so Create links an existing card instead of making a second one when there is no email to look it up by. Read only;
 * a `Synthetic` card does not count.
 */
export async function findChatClientPages(reader: NotionReader, dataSourceId: string, id: ChatIdentity): Promise<PageObject[]> {
  const user = (id.username ?? "").replace(/^@/, "").toLowerCase();
  const digits = digitsOf(id.phone ?? "");
  const seen = new Map<string, PageObject>();
  for (const q of [user, digits.length >= 7 ? digits : ""].filter((x) => x.length >= 2)) for (const p of await searchClientPages(reader, dataSourceId, q, 10)) seen.set(p.id, p);
  return [...seen.values()].filter((p) => {
    if (p.properties["Synthetic"]?.type === "checkbox" && p.properties["Synthetic"].checkbox === true) return false;
    const tg = textOf(p.properties["Telegram"]).trim().replace(/^@/, "").toLowerCase();
    if (user && tg === user) return true;
    return digits.length >= 7 && ["Phone", "WhatsApp", "Telegram"].some((k) => digitsOf(textOf(p.properties[k])) === digits);
  });
}

const textOf = (p: PropertyValue | undefined): string => {
  if (!p) return "";
  if (p.type === "phone_number") return typeof p.phone_number === "string" ? p.phone_number : "";
  if (p.type === "rich_text" && Array.isArray(p.rich_text)) return (p.rich_text as Array<{ plain_text?: unknown }>).map((x) => (typeof x.plain_text === "string" ? x.plain_text : "")).join("");
  return "";
};
const digitsOf = (s: string) => s.replace(/\D/g, "");

/** The chat's identity to write: a Telegram chat's username (else its phone in +E.164), a WhatsApp chat's number. */
export interface ChatIdentity {
  channel: "telegram" | "whatsapp";
  username: string | null;
  phone: string | null;
}

/** The property and value a chat fills, or null when it has nothing to write or the schema lacks the property. Pure. */
export function chatProperty(ds: DataSourceInfo, id: ChatIdentity): { name: ChatProperty; type: "rich_text" | "phone_number"; value: string } | null {
  if (id.channel === "telegram") {
    const c = ds.properties["Telegram"];
    const value = id.username ? id.username.replace(/^@/, "") : id.phone;
    if (!value || !c || (c.type !== "rich_text" && c.type !== "phone_number")) return null;
    if (c.type === "phone_number" && !id.phone) return null;
    return { name: "Telegram", type: c.type, value: c.type === "phone_number" ? id.phone! : value };
  }
  const c = ds.properties["WhatsApp"];
  if (!id.phone || !c || (c.type !== "rich_text" && c.type !== "phone_number")) return null;
  return { name: "WhatsApp", type: c.type, value: id.phone };
}

const INSERT_FIX = "Notion did not let the Hub create the client: give the hub integration Insert content (app.notion.com ▸ Developer tools ▸ Developer connections ▸ Hub ▸ Configuration ▸ Capabilities), then try again";
const UPDATE_FIX = "Notion did not let the Hub fill the chat's field on the client: give the hub integration Update content (app.notion.com ▸ Developer tools ▸ Developer connections ▸ Hub ▸ Configuration ▸ Capabilities)";
const refused = (e: unknown) => {
  const f = notionFailure(e);
  return f.status === 403 || f.status === 401 || f.code === "restricted_resource";
};

/** A refusal's Notion status and code for a line: the code goes in `kind` (a field named `code` is masked as a secret). */
const failed = (e: unknown): { status: number | null; kind: string | null } => {
  const f = notionFailure(e);
  return { status: f.status, kind: f.code };
};

export type CreateChatClientOutcome = { state: "created"; pageId: string; page: PageObject } | { state: "refused"; note: string } | { state: "no_schema"; note: string };

/**
 * Create, the owner's and the agent's (P143 L2): one Clients card (Name, Email and Phone when known, Relationship Lead, the chat's
 * Telegram or WhatsApp). `identity` is the chat's, or the Telegram username the agent was given for a client with no chat; null
 * when there is neither. A 403 is the fix sentence.
 */
export async function createChatClient(
  deps: { reader: NotionReader; writer: ChatClientWriter },
  o: { clientsDataSource: string; name: string; email?: string | null; phone?: string | null; identity: ChatIdentity | null },
): Promise<CreateChatClientOutcome> {
  const ds = await deps.reader.retrieveDataSource(o.clientsDataSource);
  const props = newClientProperties(ds, { name: o.name, email: o.email, phone: o.phone ?? null });
  if (!props) return { state: "no_schema", note: "the Clients database has no title property" };
  const chat = o.identity ? chatProperty(ds, o.identity) : null;
  if (chat) props[chat.name] = chat.type === "phone_number" ? { phone_number: chat.value.slice(0, 60) } : { rich_text: [{ type: "text", text: { content: chat.value.slice(0, 200) } }] };
  try {
    const pageId = await deps.writer.createClient(o.clientsDataSource, props);
    // The card as the directory reads it, from what was written (no second request).
    const properties: Record<string, PropertyValue> = {};
    for (const [k, v] of Object.entries(props)) {
      const c = ds.properties[k];
      if (!c) continue;
      const val = (v as Record<string, unknown>)[c.type];
      // A title or text value was written as `[{ text: { content } }]`; the reader sees `plain_text`.
      const asRead = Array.isArray(val) ? (val as Array<{ text?: { content?: string } }>).map((x) => ({ plain_text: x.text?.content ?? "" })) : val;
      properties[k] = { type: c.type, [c.type]: asRead };
    }
    ops("notion").info("client card created in Notion", { property: chat?.name ?? null, withPhone: "Phone" in props });
    return { state: "created", pageId, page: { id: pageId, last_edited_time: new Date().toISOString(), properties } };
  } catch (e) {
    if (refused(e)) {
      ops("notion").warn("client card not created in Notion: the integration may not insert", failed(e));
      return { state: "refused", note: INSERT_FIX };
    }
    throw e;
  }
}

export type FillOutcome = { state: "written"; property: ChatProperty; value: string } | { state: "kept"; reason: string } | { state: "refused"; note: string };

/**
 * After the owner's Link: the chat's username or number into the card's `Telegram` or `WhatsApp`, only when that property is empty
 * on the page as it is now (and, for WhatsApp, `Phone` does not already hold the same number). A filled property is never touched.
 */
export async function fillChatIdentity(deps: { reader: NotionReader; writer: ChatClientWriter }, o: { clientsDataSource: string; pageId: string; identity: ChatIdentity }): Promise<FillOutcome> {
  const ds = await deps.reader.retrieveDataSource(o.clientsDataSource);
  const chat = chatProperty(ds, o.identity);
  if (!chat) return { state: "kept", reason: "nothing to write, or the Clients database has no such field" };
  const page = await deps.writer.retrievePage(o.pageId);
  if (textOf(page.properties[chat.name]).trim()) return { state: "kept", reason: `${chat.name} is already filled` };
  if (chat.name === "WhatsApp" && digitsOf(textOf(page.properties["Phone"])) === digitsOf(chat.value)) return { state: "kept", reason: "Phone already holds this number" };
  try {
    await deps.writer.fillEmpty(o.pageId, { name: chat.name, type: chat.type }, chat.value);
    ops("notion").info("client card's chat field filled in Notion", { property: chat.name });
    return { state: "written", property: chat.name, value: chat.value };
  } catch (e) {
    if (refused(e)) {
      ops("notion").warn("client card's chat field not filled: the integration may not update", { property: chat.name, ...failed(e) });
      return { state: "refused", note: UPDATE_FIX };
    }
    throw e;
  }
}
