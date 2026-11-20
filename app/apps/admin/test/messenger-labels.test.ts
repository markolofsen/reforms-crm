import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_RULES } from "@hub/config/chat-rules";
import type { MessengerChatDto } from "@hub/contract/messenger-panel";
import { chatName, confirmLine, lastText, lastWho, noDraftLine, rulesLine } from "../src/features/messengers/labels";

// The Messengers panel's words (P71 M3): who a chat is, its rules in one line, whose turn it is and why there is no draft.

const chat = (patch: Partial<MessengerChatDto> = {}): MessengerChatDto => ({
  id: 1,
  channel: "telegram_user",
  chatId: "700100",
  title: "Rita F.",
  client: { id: 3, name: "Rita Falsa", email: "rita@example.net" },
  rules: { ...DEFAULT_CHAT_RULES },
  inbound: 1,
  last: { direction: "in", kind: "text", text: "Hi!", at: "2026-11-20T08:00:00.000Z" },
  owed: true,
  draft: null,
  ...patch,
});

describe("messenger labels", () => {
  it("names the chat by its client, else its title, else its id", () => {
    expect(chatName(chat())).toBe("Rita Falsa");
    expect(chatName(chat({ client: null }))).toBe("Rita F.");
    expect(chatName(chat({ client: null, title: null }))).toBe("Chat 700100");
  });

  it("says the rules in one line, the follow-up days only while follow-ups are on", () => {
    expect(rulesLine(chat())).toBe("Telegram · Draft replies");
    expect(rulesLine(chat({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "on_request", mayNudge: true, nudgeAfterDays: 1, language: "pt" } }))).toBe("Telegram · Only when I ask · follow-up after 1 day · in pt");
  });

  it("says whose turn it is, and a message with no text by its kind", () => {
    expect(lastWho(chat())).toBe("They wrote");
    expect(lastWho(chat({ last: null }))).toBeNull();
    expect(lastText(chat({ last: { direction: "out", kind: "photo", text: "", at: "2026-11-20T08:00:00.000Z" } }))).toBe("(photo)");
  });

  it("without a draft, the line says why: the rule, or the phrase that drafts", () => {
    expect(noDraftLine(chat(), "lisbon-realty")).toBe("A reply is owed and no draft yet: say “triage messages for lisbon-realty” in a session.");
    expect(noDraftLine(chat({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "off" } }), "p")).toMatch(/never drafts here/);
    expect(noDraftLine(chat({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "on_request" } }), "p")).toMatch(/only when you ask/);
    expect(noDraftLine(chat({ owed: false }), "p")).toBe("You replied last.");
    expect(noDraftLine(chat({ draft: { id: 9, text: "Yes", nudge: false, ownerRequest: null, createdAt: "", updatedAt: "" } }), "p")).toBeNull();
  });

  it("the confirm step says who, on which channel, from which account, and that it cannot be recalled (P71 M4)", () => {
    expect(confirmLine({ to: "Rita Falsa", channel: "telegram_user", account: "42" })).toBe("To Rita Falsa on Telegram, from your account 42. A sent message cannot be recalled.");
  });
});
