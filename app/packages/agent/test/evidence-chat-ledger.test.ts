import { describe, expect, it } from "vitest";
import { auditToolCalls } from "@hub/projects/audit";
import { chatDraftViolations, HUB_MESSENGER_DRAFT_WRITE, HUB_MESSENGER_HISTORY } from "../src/evidence/chat-ledger";
import { entryFor, isDraftWrite, preDraftCheck, type LedgerEntry } from "../src/evidence/ledger";

// P71 M2: the guard's messenger rule. A messenger draft is judged by its own chat's history read, never by the mail chain.

const reply = (value: Record<string, unknown>) => ({ content: [{ type: "text", text: JSON.stringify(value) }], structuredContent: value });
const history = (chats: Array<{ channel: string; chat_id: string; id?: number }>) => ({ name: HUB_MESSENGER_HISTORY, input: { client: 3 }, result: reply({ project: "acme", chats: chats.map((c) => ({ ...c, messages: [{ text: "secret client text" }] })) }) });
const write = (chat_id: string) => ({ name: HUB_MESSENGER_DRAFT_WRITE, input: { channel: "telegram_user", chat_id, text: "Добрый день" } });

describe("messenger ledger", () => {
  it("a history read is one line naming its chats, never a message text", () => {
    const e = entryFor([], history([{ channel: "telegram_user", chat_id: "42" }]));
    expect(e).toEqual({ tool: "messenger_history", kind: "chat", chats: ["telegram_user:42"] });
    expect(JSON.stringify(e)).not.toMatch(/secret/);
    expect(entryFor([], { name: HUB_MESSENGER_HISTORY, input: { channel: "telegram_user", chat_id: "9" }, result: reply({ error: "not_linked" }) })).toBeNull();
  });

  it("a draft in a chat this session read passes; another chat, or a read by another subagent, is a violation", () => {
    const entries: LedgerEntry[] = [{ ...entryFor([], history([{ channel: "telegram_user", chat_id: "42" }]))!, aid: "sub1" }];
    expect(chatDraftViolations(entries, write("42"), "sub1")).toEqual([]);
    expect(chatDraftViolations(entries, write("43"), "sub1")[0]).toMatch(/read this chat first: no messenger_history of telegram_user:43/);
    expect(chatDraftViolations(entries, write("42"))).toHaveLength(1);
  });

  it("binds a focused chat ref to the history read that returned it", () => {
    const entries: LedgerEntry[] = [{ ...entryFor([], history([{ channel: "telegram_user", chat_id: "42", id: 3 }]))!, aid: "sub1" }];
    expect(chatDraftViolations(entries, { name: HUB_MESSENGER_DRAFT_WRITE, input: { chat: 3, text: "Добрый день" } }, "sub1")).toEqual([]);
    expect(chatDraftViolations(entries, { name: HUB_MESSENGER_DRAFT_WRITE, input: { chat: 4, text: "Добрый день" } }, "sub1")[0]).toMatch(/no messenger_history of chat:4/);
  });

  it("is not a mail draft: the mail chain is never asked of it, and the isolation audit does not call it send-capable", () => {
    expect(isDraftWrite(HUB_MESSENGER_DRAFT_WRITE)).toBe(false);
    expect(preDraftCheck([], write("42")).violations).toEqual([]);
    expect(auditToolCalls([write("42"), history([])], "acme", [], undefined, { projects: ["projects"], db: ["data/app.db"] })).toEqual([]);
  });
});
