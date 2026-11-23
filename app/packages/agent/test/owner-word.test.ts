import { describe, expect, it } from "vitest";
import { isSendWord, ownerWordFor, ownerWordRef, ownerWordsFound, type OwnerWordInput } from "../src/messenger/owner-word";

// Decision 0046 (P132 B1-2): the owner's word that lets the agent send one messenger draft, read from the session log only.

const NOW = new Date("2026-11-23T12:00:00.000Z");
const at = (min: number) => new Date(NOW.getTime() - min * 60_000).toISOString();
const prompt = (session: string, min: number, text: string, turn?: string) => ({ ts: at(min), session, kind: "prompt" as const, data: { text }, ...(turn ? { turn } : {}) });
const focus = (session: string, min: number, line: string, turn?: string) => ({ ts: at(min), session, kind: "focus" as const, data: { line }, ...(turn ? { turn } : {}) });
const DRAFT = { id: 7, chat: 3, updatedAt: at(10) };
const base = (events: OwnerWordInput["events"], over: Partial<OwnerWordInput> = {}): OwnerWordInput => ({ events, draft: DRAFT, openDrafts: [DRAFT], used: new Set(), now: NOW, ...over });
const code = (i: OwnerWordInput) => {
  const v = ownerWordFor(i);
  return v.ok ? "ok" : v.refusal.code;
};

describe("isSendWord", () => {
  it("takes the imperatives in Russian and English", () => {
    for (const t of ["отправь", "Отправляй!", "ок, отправьте ему", "отошли это Анне", "send it", "Send this now", "ok send", "please send", "Send the draft", "да, отправь"]) expect(isSendWord(t), t).toBe(true);
  });
  it("refuses negations, questions, the infinitive and other words", () => {
    for (const t of ["не отправляй", "пока не отправляй это", "don't send it", "do not send this", "never send it", "отправить?", "отправь?", "send it?", "send it later?", "what did you send", "отправлено", "отправка завтра", "напиши ответ", "resend", "sender"]) expect(isSendWord(t), t).toBe(false);
  });
});

describe("ownerWordFor", () => {
  it("passes a send word after the draft, with the chat open in the admin, and names its log reference", () => {
    const v = ownerWordFor(base([prompt("s1", 5, "отправь", "t1"), focus("s1", 5, '[Hub focus, data] Messengers · open chat:3 "Anna" · 4 s ago', "t1")]));
    expect(v).toEqual({ ok: true, ref: ownerWordRef({ session: "s1", ts: at(5) }), text: "отправь", at: at(5) });
  });

  it("no word, or a word that is not a send word, is no_owner_word", () => {
    expect(code(base([]))).toBe("no_owner_word");
    expect(code(base([prompt("s1", 5, "напиши Анне про 28-е")]))).toBe("no_owner_word");
    expect(code(base([prompt("s1", 5, "не отправляй")]))).toBe("no_owner_word");
  });

  it("a word before the draft's last change is word_before_draft", () => {
    expect(code(base([prompt("s1", 20, "напиши и отправь")]))).toBe("word_before_draft");
  });

  it("a word followed by another prompt of the same session is word_superseded; another session's later prompt does not supersede it", () => {
    expect(code(base([prompt("s1", 5, "отправь chat:3"), prompt("s1", 2, "подожди, исправь дату")]))).toBe("word_superseded");
    expect(code(base([prompt("s1", 5, "отправь chat:3"), prompt("s2", 2, "что нового?")]))).toBe("ok");
  });

  it("a word older than 12 hours does not count", () => {
    expect(code(base([prompt("s1", 13 * 60, "send it chat:3")], { draft: { ...DRAFT, updatedAt: at(14 * 60) }, openDrafts: [] }))).toBe("no_owner_word");
  });

  it("a used word is word_used: one send per word", () => {
    expect(code(base([prompt("s1", 5, "отправь chat:3")], { used: new Set([ownerWordRef({ session: "s1", ts: at(5) })]) }))).toBe("word_used");
  });

  it("the chat: a word naming another chat or the admin showing another chat is other_chat; two chats named is chat_unclear", () => {
    expect(code(base([prompt("s1", 5, "отправь chat:4")]))).toBe("other_chat");
    expect(code(base([prompt("s1", 5, "отправь", "t1"), focus("s1", 5, '[Hub focus, data] Messengers · open chat:4 "Bo"', "t1")]))).toBe("other_chat");
    expect(code(base([prompt("s1", 5, "отправь chat:3 и chat:4")]))).toBe("chat_unclear");
  });

  it("with no chat named or shown, the only draft changed since his previous prompt is the one; two such drafts are chat_unclear", () => {
    const events = [prompt("s1", 30, "ответь Анне"), prompt("s1", 5, "send it")];
    expect(code(base(events))).toBe("ok");
    const other = { id: 8, chat: 4, updatedAt: at(8) };
    expect(code(base(events, { openDrafts: [DRAFT, other] }))).toBe("chat_unclear");
    // A draft changed before his previous prompt is not "just written".
    expect(code(base(events, { openDrafts: [DRAFT, { id: 8, chat: 4, updatedAt: at(40) }] }))).toBe("ok");
  });
});

describe("P129 verdict 7: ownerWordsFound, the owner's words as the basis of a draft", () => {
  const NOW = new Date("2026-11-23T12:00:00.000Z");
  const p = (ts: string, text: string) => ({ ts, session: "s1", kind: "prompt" as const, data: { text } });
  const events = [p("2026-11-23T11:00:00.000Z", "Подготовь какой-нибудь ответ в виде стишка"), p("2026-11-23T11:30:00.000Z", "переведи на русский"), p("2026-11-22T10:00:00.000Z", "old words from yesterday")];
  it("finds his words, folded for case, whitespace, quotes and end punctuation; a quote of part of the prompt counts", () => {
    expect(ownerWordsFound({ events, words: "«Переведи  на РУССКИЙ.»", now: NOW })).toMatchObject({ ok: true, ref: "s1@2026-11-23T11:30:00.000Z" });
    expect(ownerWordsFound({ events, words: "ответ в виде стишка", now: NOW })).toMatchObject({ ok: true });
  });
  it("refuses a summary, a translation, a too-short phrase and words older than 12 hours", () => {
    for (const words of ["write a poem", "translate to Russian", "на", "old words from yesterday"]) expect(ownerWordsFound({ events, words, now: NOW })).toMatchObject({ ok: false, code: "owner_words_not_found" });
  });
  it("a prompt the log cut matches words that start with what is left", () => {
    const long = [p("2026-11-23T11:50:00.000Z", "напиши всем клиентам про новые цены… [cut, 9000 chars]")];
    expect(ownerWordsFound({ events: long, words: "напиши всем клиентам про новые цены и скидки", now: NOW })).toMatchObject({ ok: true });
  });
});
