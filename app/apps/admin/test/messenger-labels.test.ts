import { describe, expect, it } from "vitest";
import { DEFAULT_CHAT_RULES } from "@hub/config/chat-rules";
import type { MessengerChatDto } from "@hub/contract/messenger-panel";
import { chatName, chatStateLine, confirmLine, createIdentityLine, createLabel, emptyLine, linkedLine, lastText, lastWho, noDraftLine, notionIdentityLine, notionStatusLine, prefilterNote, readsLine, rulesLine, triageLine, whyLine } from "../src/features/messengers/labels";

// The Messengers panel's words (P71 M3): who a chat is, its rules in one line, whose turn it is and why there is no draft.

const chat = (patch: Partial<MessengerChatDto> = {}): MessengerChatDto => ({
  id: 1,
  channel: "telegram_user",
  chatId: "700100",
  title: "Rita F.",
  client: {
    id: 3,
    name: "Rita Falsa",
    email: "rita@example.net",
    notionPageId: "page-3",
    notionUrl: "https://notion.so/page-3",
    notion: { state: "resolved", pageId: "page-3", url: "https://notion.so/page-3" },
  },
  rules: { ...DEFAULT_CHAT_RULES },
  inbound: 1,
  stored: 3,
  last: { direction: "in", kind: "text", text: "Hi!", at: "2026-11-20T08:00:00.000Z", hidden: null },
  owed: true,
  draft: null,
  autolinked: null,
  triage: { judged: 0, hidden: { closing: 0, automated: 0, personal: 0 }, unjudged: 0 },
  contact: { telegramUsername: null, telegramPhone: null, whatsappPhone: null },
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
    expect(rulesLine(chat({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "on_request", language: "pt" } }))).toBe("Telegram · Only when I ask · in pt");
  });

  it("says whose turn it is, and a message with no text by its kind", () => {
    expect(lastWho(chat())).toBe("They wrote");
    expect(lastWho(chat({ last: null }))).toBeNull();
    expect(lastText(chat({ last: { direction: "out", kind: "photo", text: "", at: "2026-11-20T08:00:00.000Z", hidden: null } }))).toBe("(photo)");
  });

  it("states the next decision explicitly", () => {
    expect(chatStateLine(chat())).toBe("Wrote you");
    expect(chatStateLine(chat({ draft: { id: 9, text: "Yes", createdBy: "agent", nudge: false, ownerRequest: null, createdAt: "", updatedAt: "" } }))).toBe("Draft ready");
    expect(chatStateLine(chat({ owed: false, last: { direction: "out", kind: "text", text: "Done", at: "2026-11-20T08:00:00.000Z", hidden: null } }))).toBe("Waiting for them");
    expect(chatStateLine(chat({ owed: false, last: { direction: "in", kind: "text", text: "thanks", at: "2026-11-20T08:00:00.000Z", hidden: "closing" } }))).toBe("Done"); // P123 U3: Mail's state words
  });

  it("keeps the compact Notion marker short without losing the full identity line", () => {
    expect(notionStatusLine(chat())).toBe("Notion");
    expect(notionStatusLine(chat({ client: { ...chat().client!, notionPageId: null, notionUrl: null, notion: { state: "unresolved", pageId: null, url: null } } }))).toBe("Notion not found");
    expect(notionIdentityLine(chat())).toBe("Notion · Rita Falsa");
    expect(notionStatusLine(chat({ client: { ...chat().client!, notion: { state: "unavailable", pageId: null, url: null } } }))).toBe("Notion unavailable");
    expect(notionIdentityLine(chat({ client: { ...chat().client!, notion: { state: "unavailable", pageId: null, url: null } } }))).toBe("Notion unavailable · Rita Falsa");
  });

  it("without a draft, the line says why and points to the preparation action", () => {
    expect(noDraftLine(chat())).toBe("A reply is owed and no draft yet. Prepare a reply to ask the agent to draft it.");
    expect(noDraftLine(chat({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "off" } }))).toMatch(/never drafts here/);
    expect(noDraftLine(chat({ rules: { ...DEFAULT_CHAT_RULES, replyMode: "on_request" } }))).toMatch(/Prepare a reply when you want/);
    expect(noDraftLine(chat({ owed: false }))).toBe("You replied last.");
    expect(noDraftLine(chat({ draft: { id: 9, text: "Yes", createdBy: "agent", nudge: false, ownerRequest: null, createdAt: "", updatedAt: "" } }))).toBeNull();
  });

  it("the confirm step says who, on which channel, from which account, and that it cannot be recalled (P71 M4)", () => {
    expect(confirmLine({ to: "Rita Falsa", channel: "telegram_user", account: "42" })).toBe("To Rita Falsa on Telegram, from your account 42. A sent message cannot be recalled.");
  });

  it("P84: the account row says what is read, and the empty state names both accounts and why nothing shows", () => {
    expect(readsLine(3)).toBe("· reads only chats linked to a client (3 linked)");
    expect(emptyLine({ telegram: true, whatsapp: true, enabled: true, withIdentifier: 224, directoryReady: true })).toBe(
      "The Hub reads your Telegram account and your WhatsApp number, but only the chats linked to a client: no other chat is stored. A chat links itself when its phone or username equals one of the 224 clients in Notion that have one.",
    );
    expect(emptyLine({ telegram: true, whatsapp: false, enabled: false, withIdentifier: 0, directoryReady: true })).toMatch(/your Telegram account, .*Autolink is off for this project/);
    expect(emptyLine({ telegram: false, whatsapp: false, enabled: true, withIdentifier: 0, directoryReady: false })).toMatch(/^No Telegram account or WhatsApp number is connected/);
  });

  it("P84: says why a seen chat was not linked by itself", () => {
    const c = { key: "k", name: "Bob", email: "bob@example.test", relationship: null };
    expect(whyLine({ why: "ambiguous", by: "phone", candidates: [c, c] })).toBe("Its phone belongs to 2 clients: pick the right one.");
    expect(whyLine({ why: "off", by: "phone", candidates: [c] })).toMatch(/Autolink is off/);
    expect(whyLine({ why: "none", by: null, candidates: [] })).toBe("No client in Notion has its phone or username.");
  });

  it("P71 M-P: the pre-analysis' counts by reason, the hidden newest message, and the switch's note with and without a key", () => {
    const on = { ...DEFAULT_CHAT_RULES, prefilter: true };
    expect(triageLine(chat())).toBeNull();
    expect(triageLine(chat({ rules: on }))).toBe("Pre-analysis: nothing read yet.");
    expect(triageLine(chat({ rules: on, triage: { judged: 5, hidden: { closing: 2, automated: 1, personal: 0 }, unjudged: 1 } }))).toBe("Pre-analysis: hid 3 of 5 (2 closing, 1 automated) · 1 could not be judged and reached the agent.");
    expect(triageLine(chat({ triage: { judged: 2, hidden: { closing: 0, automated: 0, personal: 0 }, unjudged: 0 } }))).toBe("Pre-analysis (off now): read 2, hid none.");
    const hidden = chat({ owed: false, last: { direction: "in", kind: "text", text: "thanks", at: "2026-11-20T08:00:00.000Z", hidden: "closing" } });
    expect(noDraftLine(hidden)).toBe("Their last message was hidden by the pre-analysis (closing): no reply owed.");
    expect(prefilterNote({ state: "no_key", fix: "No OpenRouter key: set OPENROUTER_API_KEY." })).toBe("Needs an OpenRouter key: pre-analysis stays off until the Hub instance is configured.");
    expect(prefilterNote({ state: "ready", fix: null })).toMatch(/^A cheap model reads each new message and the two before it \(never a name or the chat's title\)/);
    expect(prefilterNote({ state: "fake", fix: null })).toMatch(/local test model; no request leaves this computer/);
    for (const s of ["ready", "fake", "no_key"] as const) expect(prefilterNote({ state: s, fix: null })).not.toMatch(/nothing reads this switch/);
  });

  it("P100: a link says what history it loaded, and Create says what it writes to the card", () => {
    expect(linkedLine({ imported: 12, importError: null, days: 30 })).toBe("12 messages from the last 30 days loaded");
    expect(linkedLine({ imported: 1, importError: null, days: 30 })).toBe("1 message from the last 30 days loaded");
    expect(linkedLine({ imported: 0, importError: null, days: 30 })).toBe("No messages from the last 30 days; new ones arrive automatically");
    expect(linkedLine({ imported: 0, importError: "timeout", days: 30 })).toBe("Could not load the last 30 days (timeout); new messages still arrive");
    expect(createLabel("Evgeniy")).toBe("Create client «Evgeniy» in Notion");
    expect(createIdentityLine({ channel: "telegram_user", username: "suenot", phone: null, chatId: "1" })).toBe("Telegram suenot is written to the card");
    expect(createIdentityLine({ channel: "telegram_user", username: null, phone: "79123456789", chatId: "1" })).toBe("Telegram +79123456789 is written to the card");
    expect(createIdentityLine({ channel: "whatsapp", username: null, phone: null, chatId: "+351911000111" })).toBe("WhatsApp +351911000111 is written to the card");
    expect(createIdentityLine({ channel: "telegram_user", username: null, phone: null, chatId: "1" })).toBeNull();
  });
});
