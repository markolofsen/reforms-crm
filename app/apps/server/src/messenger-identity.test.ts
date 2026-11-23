import { describe, expect, it } from "vitest";
import { buildDirectory, type DirectoryEntry } from "@hub/messengers";
import type { ClientDirectory } from "./client-directory";
import { createMessengerIdentityResolver } from "./messenger-identity";

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
});
