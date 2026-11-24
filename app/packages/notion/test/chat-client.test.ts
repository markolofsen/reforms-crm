import { describe, expect, it } from "vitest";
import { chatProperty, chatSearchFilter, createChatClient, fillChatIdentity, findChatClientPages, searchTerms, type ChatClientWriter } from "../src/chat-client";
import type { DataSourceInfo, NotionReader, PageObject } from "../src/types";

// P100: the live search's filter, and the chat writer's one rule: fill Telegram or WhatsApp only when it is empty.

const DS: DataSourceInfo = {
  id: "ds",
  title: "Clients",
  properties: { Name: { type: "title" }, Email: { type: "email" }, "Other emails": { type: "rich_text" }, Phone: { type: "phone_number" }, WhatsApp: { type: "phone_number" }, Telegram: { type: "rich_text" }, Notes: { type: "rich_text" } },
};
const reader: NotionReader = { retrieveDataSource: async () => DS, listPages: async function* () {}, retrieveMarkdown: async () => ({ markdown: "", truncated: false, unknownBlockIds: [] }) };
const card = (o: { telegram?: string; whatsapp?: string; phone?: string } = {}): PageObject => ({
  id: "c1",
  last_edited_time: "x",
  properties: {
    Telegram: { type: "rich_text", rich_text: o.telegram ? [{ plain_text: o.telegram }] : [] },
    WhatsApp: { type: "phone_number", phone_number: o.whatsapp ?? null },
    Phone: { type: "phone_number", phone_number: o.phone ?? null },
  },
});
const writerFor = (page: PageObject, writes: unknown[]): ChatClientWriter => ({
  createClient: async () => "x",
  retrievePage: async () => page,
  fillEmpty: async (...a) => void writes.push(a),
});

describe("the live search filter", () => {
  it("asks the title, emails, Other emails and Telegram for a word; never another text property", () => {
    expect(chatSearchFilter(DS, "@suenot")).toEqual({
      or: [
        { property: "Name", title: { contains: "suenot" } },
        { property: "Email", email: { contains: "suenot" } },
        { property: "Other emails", rich_text: { contains: "suenot" } },
        { property: "Telegram", rich_text: { contains: "suenot" } },
      ],
    });
    expect(chatSearchFilter(DS, "a")).toBeNull();
  });

  it("asks the phone fields for a number's last seven digits, whatever its spacing", () => {
    expect(searchTerms("+7 (912) 345-67-89")).toEqual({ text: "+7 (912) 345-67-89", digits: "79123456789" });
    const f = chatSearchFilter(DS, "+7 912 345 67 89") as { or: unknown[] };
    expect(f.or).toContainEqual({ property: "Phone", phone_number: { contains: "3456789" } });
    expect(f.or).toContainEqual({ property: "WhatsApp", phone_number: { contains: "3456789" } });
  });
});

describe("the chat's field", () => {
  it("is the Telegram username, else the phone; the WhatsApp number for WhatsApp", () => {
    expect(chatProperty(DS, { channel: "telegram", username: "suenot", phone: "+79123456789" })).toEqual({ name: "Telegram", type: "rich_text", value: "suenot" });
    expect(chatProperty(DS, { channel: "telegram", username: null, phone: "+79123456789" })).toEqual({ name: "Telegram", type: "rich_text", value: "+79123456789" });
    expect(chatProperty(DS, { channel: "whatsapp", username: null, phone: "+351911000111" })).toEqual({ name: "WhatsApp", type: "phone_number", value: "+351911000111" });
    expect(chatProperty(DS, { channel: "telegram", username: null, phone: null })).toBeNull();
  });

  it("fills an empty field once and never overwrites a filled one or repeats Phone", async () => {
    const w1: unknown[] = [];
    expect(await fillChatIdentity({ reader, writer: writerFor(card(), w1) }, { clientsDataSource: "ds", pageId: "c1", identity: { channel: "telegram", username: "suenot", phone: null } })).toEqual({ state: "written", property: "Telegram", value: "suenot" });
    expect(w1).toEqual([["c1", { name: "Telegram", type: "rich_text" }, "suenot"]]);
    const w2: unknown[] = [];
    expect(await fillChatIdentity({ reader, writer: writerFor(card({ telegram: "other_one" }), w2) }, { clientsDataSource: "ds", pageId: "c1", identity: { channel: "telegram", username: "suenot", phone: null } })).toMatchObject({ state: "kept" });
    expect(await fillChatIdentity({ reader, writer: writerFor(card({ phone: "+351 911 000 111" }), w2) }, { clientsDataSource: "ds", pageId: "c1", identity: { channel: "whatsapp", username: null, phone: "+351911000111" } })).toEqual({ state: "kept", reason: "Phone already holds this number" });
    expect(w2).toEqual([]);
  });

  it("a refused write is the fix sentence, not a throw", async () => {
    const writer: ChatClientWriter = { ...writerFor(card(), []), fillEmpty: async () => Promise.reject(Object.assign(new Error("x"), { status: 403 })) };
    expect(await fillChatIdentity({ reader, writer }, { clientsDataSource: "ds", pageId: "c1", identity: { channel: "telegram", username: "suenot", phone: null } })).toMatchObject({ state: "refused", note: expect.stringMatching(/Update content/) });
  });
});

describe("P141 C3: a chat's client without an email", () => {
  it("is created with no Email property, and its title is the name given", async () => {
    const made: Record<string, unknown>[] = [];
    const writer: ChatClientWriter = { createClient: async (_ds, props) => (made.push(props), "new"), retrievePage: async () => card(), fillEmpty: async () => undefined };
    const r = await createChatClient({ reader, writer }, { clientsDataSource: "ds", name: "WhatsApp +966544555430", email: null, identity: { channel: "whatsapp", username: null, phone: "+966544555430" } });
    expect(r.state).toBe("created");
    expect(made[0]).not.toHaveProperty("Email");
    expect(made[0]).toMatchObject({ Name: { title: [{ text: { content: "WhatsApp +966544555430" } }] }, WhatsApp: { phone_number: "+966544555430" } });
  });

  it("finds the cards that hold exactly the chat's username or number, never a namesake or a Synthetic card", async () => {
    const page = (id: string, p: Record<string, unknown>): PageObject => ({ id, last_edited_time: "x", properties: p as never });
    const pages = [
      page("tg", { Telegram: { type: "rich_text", rich_text: [{ plain_text: "@Qimma_K" }] } }),
      page("ph", { Phone: { type: "phone_number", phone_number: "+966 54 455 5430" } }),
      page("near", { Telegram: { type: "rich_text", rich_text: [{ plain_text: "qimma_k2" }] } }),
      page("syn", { Phone: { type: "phone_number", phone_number: "+966544555430" }, Synthetic: { type: "checkbox", checkbox: true } }),
    ];
    const live: NotionReader = { ...reader, findPages: async () => pages };
    const found = await findChatClientPages(live, "ds", { channel: "telegram", username: "qimma_k", phone: "966544555430" });
    expect(found.map((p) => p.id).sort()).toEqual(["ph", "tg"]);
  });
});
