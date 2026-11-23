import { describe, expect, it } from "vitest";
import { buildDirectory, type DirectoryEntry } from "@hub/messengers";
import type { ClientDirectory } from "../../src/clients/directory";
import { createMessengerIdentityResolver } from "../../src/messengers/identity";

const entry: DirectoryEntry = { key: "notion-page-1", name: "Mark", email: "mark@example.com", relationship: "Client", identifiers: [] };
const directory = { current: () => buildDirectory([entry]) } satisfies Pick<ClientDirectory, "current">;

describe("MessengerIdentityResolver", () => {
  it("prefers the stored page reference over the directory index", () => {
    const resolver = createMessengerIdentityResolver({ project: "saas-support", directory });

    expect(resolver.resolve("saas-support", "mark@example.com", { notionPageId: "stored-page", notionUrl: null })).toEqual({
      state: "resolved",
      pageId: "stored-page",
      url: null,
    });
  });

  it("resolves a directory match and distinguishes loaded misses", () => {
    const resolver = createMessengerIdentityResolver({ project: "saas-support", directory });

    expect(resolver.resolve("saas-support", "mark@example.com", null)).toMatchObject({ state: "resolved", pageId: "notion-page-1" });
    expect(resolver.resolve("saas-support", "other@example.com", null)).toEqual({ state: "unresolved", pageId: null, url: null });
  });

  it("reports an unavailable directory outside the active project", () => {
    const resolver = createMessengerIdentityResolver({ project: null, directory });

    expect(resolver.resolve("realty-crm", "mark@example.com", null)).toEqual({ state: "unavailable", pageId: null, url: null });
  });

  it("maps the normalized identity into the client DTO", () => {
    const resolver = createMessengerIdentityResolver({ project: "saas-support", directory });

    expect(resolver.client("saas-support", { id: 1, name: "Mark", email: "mark@example.com" }, null)).toMatchObject({
      id: 1,
      notionPageId: "notion-page-1",
      notion: { state: "resolved" },
    });
  });
});

describe("P131 O5: the contact a chat or a Mail conversation opens Telegram and WhatsApp with", () => {
  const card: DirectoryEntry = {
    key: "notion-page-2",
    name: "Anna",
    email: "anna@example.com",
    relationship: "Client",
    identifiers: [{ kind: "username", value: "anna_k" }, { kind: "phone", value: "+351 912 345 678", channel: "whatsapp" }, { kind: "phone", value: "+44 7700 900123" }],
  };
  const resolver = createMessengerIdentityResolver({ project: "p", directory: { current: () => buildDirectory([card]) } });
  it("reads the Notion card by email or page id: its Telegram username, its WhatsApp number, its phone for Telegram", () => {
    expect(resolver.contact("p", { email: "anna@example.com" })).toEqual({ telegramUsername: "anna_k", telegramPhone: "447700900123", whatsappPhone: "351912345678" });
    expect(resolver.contact("p", { pageId: "notion-page-2" })).toMatchObject({ telegramUsername: "anna_k" });
    expect(resolver.contact("other", { email: "anna@example.com" })).toEqual({ telegramUsername: null, telegramPhone: null, whatsappPhone: null });
  });
  it("a WhatsApp chat's own number comes first; a group's id gives no WhatsApp link", () => {
    expect(resolver.contact("p", { email: "anna@example.com", chat: { channel: "whatsapp", chatId: "351911111111" } }).whatsappPhone).toBe("351911111111");
    expect(resolver.contact("p", { email: "anna@example.com", chat: { channel: "whatsapp", chatId: "120363025246125486@g.us" } }).whatsappPhone).toBeNull();
    expect(resolver.contact("p", { email: "anna@example.com", chat: { channel: "whatsapp", chatId: "351912345678-1608000000" } }).whatsappPhone).toBeNull();
  });
  it("a Telegram chat's own username or phone (the autolink memory) comes before the card's; without one the card's stays", () => {
    const seen = createMessengerIdentityResolver({
      project: "p",
      directory: { current: () => buildDirectory([card]) },
      identityOf: (_channel, chatId) => (chatId === "42" ? { username: "@anna_real", phone: null } : chatId === "43" ? { username: null, phone: "+351 900 000 000" } : null),
    });
    expect(seen.contact("p", { email: "anna@example.com", chat: { channel: "telegram_user", chatId: "42" } })).toMatchObject({ telegramUsername: "anna_real", telegramPhone: "447700900123" });
    expect(seen.contact("p", { chat: { channel: "telegram_user", chatId: "43" } })).toEqual({ telegramUsername: null, telegramPhone: "351900000000", whatsappPhone: null });
    expect(seen.contact("p", { email: "anna@example.com", chat: { channel: "telegram_user", chatId: "44" } })).toMatchObject({ telegramUsername: "anna_k" });
  });
  it("verdict 10: a linked chat's own username and phone, kept on its row, come first, and work with no Notion card at all", () => {
    const none = createMessengerIdentityResolver({ project: "p", directory: { current: () => null } });
    expect(none.contact("p", { chat: { channel: "telegram_user", chatId: "45", own: { username: "sofia_t", phone: null } } })).toEqual({ telegramUsername: "sofia_t", telegramPhone: null, whatsappPhone: null });
    expect(none.contact("p", { chat: { channel: "telegram_user", chatId: "45", own: { username: null, phone: "351900000001" } } })).toEqual({ telegramUsername: null, telegramPhone: "351900000001", whatsappPhone: null });
    const seen = createMessengerIdentityResolver({ project: "p", directory: { current: () => buildDirectory([card]) }, identityOf: () => ({ username: "from_memory", phone: null }) });
    expect(seen.contact("p", { email: "anna@example.com", chat: { channel: "telegram_user", chatId: "42", own: { username: "kept_on_row", phone: null } } })).toMatchObject({ telegramUsername: "kept_on_row", telegramPhone: "447700900123" });
    expect(seen.contact("p", { email: "anna@example.com", chat: { channel: "telegram_user", chatId: "42", own: { username: null, phone: null } } })).toMatchObject({ telegramUsername: "from_memory" });
  });
});
