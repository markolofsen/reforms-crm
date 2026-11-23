import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { cpSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { parseProjectMd } from "@hub/projects";
import { DENIED_TOOLS } from "../src/deny";
import { adviceOf } from "../src/mcp/refusals";
import { FakeDraftWriter } from "../src/mail/fake";
import { parseInboundOutput, parseThreadDrafts, parseWriteOutput } from "../src/mail/protocol";
import { ACCOUNT_ADDRESSES_SCRIPT, FIND_INBOUND_SCRIPT, MESSAGE_ID_SCRIPT, READ_CONTENT_SCRIPT, READ_HEADERS_SCRIPT, THREAD_DRAFTS_SCRIPT } from "../src/mail/scripts/read";
import { WRITE_NEW_SCRIPT } from "../src/mail/scripts/write-new";
import { WRITE_REPLY_SCRIPT } from "../src/mail/scripts/write-reply";
import { DraftWriteError, isNotAllowed, MAIL_SLOW_TEXT, mailAppDraftWriter, OsaTimeout, probeOf, reviseDraft, versionHash, WRITE_WAIT_SECONDS, writeRecorded, type OsaRun, type WriteLog } from "../src/mail";
import { appleScriptCompileError, canCompileAppleScript, deleteOfLoopItem } from "../../../test-support/osacompile";
import { excerptOf } from "../src/drafts/after-write";
import type { HubMcpEnv } from "../src/mcp/ports";
import { createHubMcpServer } from "../src/mcp/server";
import { beforeContextBlock, FIXTURE_PROJECTS } from "./records-fixture";

// The hub's draft writer (P52): the script's contract, its parser and the `draft_write` tool, on a fake Mail. No test touches Mail.

const FS = "\x1f";
const LS = "\x1d";
const RS = "\x1e";
const PS = "\x1c";
/** An ok answer of WRITE_REPLY_SCRIPT: id, subject, thread, from, replaced, left, new Message-ID, its account, cleared, shell, text. */
const okOut = (o: { id?: string; subject?: string; thread?: string; from?: string; replaced?: string; left?: string; mid?: string; acc?: string; cleared?: string; shell?: string; text?: string } = {}) =>
  ["ok", o.id ?? "5", o.subject ?? "Re: X", o.thread ?? "a@b", o.from ?? "d@x", o.replaced ?? "", o.left ?? "", o.mid ?? "n5@x", o.acc ?? "desk", o.cleared ?? "", o.shell ?? "", o.text ?? "Hi"].join(FS);

describe("the Mail scripts compile (osacompile, no Mail call)", () => {
  // v0.12.12 shipped `set before to …` (`before` is an AppleScript keyword): every draft_write, Save, Restore and
  // `hub drafts unmark --apply` failed with -2741 before reaching Mail, and the string-match tests below passed.
  it.skipIf(!canCompileAppleScript).each([
    ["WRITE_REPLY_SCRIPT", WRITE_REPLY_SCRIPT],
    ["FIND_INBOUND_SCRIPT", FIND_INBOUND_SCRIPT],
    ["MESSAGE_ID_SCRIPT", MESSAGE_ID_SCRIPT],
    ["READ_HEADERS_SCRIPT", READ_HEADERS_SCRIPT],
    ["THREAD_DRAFTS_SCRIPT", THREAD_DRAFTS_SCRIPT],
    ["READ_CONTENT_SCRIPT", READ_CONTENT_SCRIPT],
    ["ACCOUNT_ADDRESSES_SCRIPT", ACCOUNT_ADDRESSES_SCRIPT],
    ["WRITE_NEW_SCRIPT", WRITE_NEW_SCRIPT],
  ])("%s", (_name, script) => {
    expect(appleScriptCompileError(script)).toBeNull();
    expect(deleteOfLoopItem(script)).toBeNull();
    expect(script).not.toMatch(/repeat with \w+ in \(id of /);
    // P58 live check 2026-11-20: items of `email addresses of acc` looped in place cannot be made text (-1700).
    expect(script).not.toMatch(/repeat with \w+ in \(email addresses of /);
  });

  it("passes the reply's text to the compiled script as argv items, verbatim: apostrophes, quotes, lines, non-ASCII", async () => {
    const body = "Hi Dan,\n\nIt's \"Punta Cana\" — the owner's note: 50 % off.\nС уважением,\nÉquipe Carapis 🚗";
    const seen: Array<{ script: string; args: string[] }> = [];
    const osa: OsaRun = async (script, args) => (seen.push({ script, args }), okOut({ subject: "Re: Dentons' Caribbean follow up", acc: "dan@danmerriam.com", text: body }));
    const r = await mailAppDraftWriter(osa).writeReply({ account: "dan@danmerriam.com", mailboxPath: ["INBOX"], messageId: 7, body, sender: "Dan O'Brien <dan@danmerriam.com>", quote: "keep", replace: [{ account: "dan@danmerriam.com", messageId: "AB3127DC@danmerriam.com" }] });
    expect(seen[0]!.script).toBe(WRITE_REPLY_SCRIPT);
    expect(seen[0]!.args).toEqual(["dan@danmerriam.com", "INBOX", "7", body, "Dan O'Brien <dan@danmerriam.com>", "keep", probeOf(body), `dan@danmerriam.com${PS}AB3127DC@danmerriam.com`, "dan@danmerriam.com", String(WRITE_WAIT_SECONDS)]);
    expect(r).toMatchObject({ subject: "Re: Dentons' Caribbean follow up", text: body });
    // No value is ever spliced into the source, so no input can make it fail to compile.
    expect(WRITE_REPLY_SCRIPT).not.toContain("${");
  });
});

describe("P94: the writer hands Mail the text with no blank lines above it", () => {
  // A person's Save re-writes the card's text, which Mail read back with its reply's empty top line as a leading break.
  const body = "\n \n\u00a0\nHi Mark,\n\n  indented stays\n\n";
  const want = "Hi Mark,\n\n  indented stays";

  it("a reply (agent's or a person's Save) and a new thread", async () => {
    const seen: string[][] = [];
    const osa: OsaRun = async (_script, args) => (seen.push(args), okOut({ text: want }));
    const w = mailAppDraftWriter(osa);
    await w.writeReply({ account: "desk", mailboxPath: ["INBOX"], messageId: 7, body, sender: null, quote: "keep" });
    await w.writeNew!({ account: "desk", sender: null, to: "c@x.example", subject: "Hello", body });
    expect(seen[0]![3]).toBe(want);
    expect(seen[0]![6]).toBe(probeOf(want));
    expect(seen[1]![4]).toBe(want);
  });

  it("the write record starts from the same text, and the fake writer saves it", async () => {
    const started: string[] = [];
    const log: WriteLog = { start: async (t) => (started.push(t), 1), settle: async () => undefined, shell: async () => undefined };
    const fake = new FakeDraftWriter();
    const r = await writeRecorded(fake, { account: "desk", mailboxPath: ["INBOX"], messageId: 7, body, sender: null }, log);
    expect(started).toEqual([want]);
    expect(r.text).toBe(want);
    expect(fake.drafts[0]!.text).toBe(want);
  });
});

describe("the Mail script", () => {
  it("never sends, opens no window, activates nothing, pastes nothing, and writes no hub line (decision 0031)", () => {
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/\bsend\b/);
    // P85b: the new-thread writer only saves too.
    expect(WRITE_NEW_SCRIPT).not.toMatch(/\bsend\b|activate|keystroke|System Events|clipboard/i);
    expect(WRITE_NEW_SCRIPT).toMatch(/make new outgoing message with properties \{subject:subj, visible:false\}/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/reply src opening window false/);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/activate|keystroke|System Events|clipboard/i);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/hub-draft|marker/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/set content of r to \(theBody & tail\)/);
  });

  it("finds its draft as a new draft of the thread in any account Mail may save it in, holding the text's start (P65 S5)", () => {
    // Every id before the reply: a shell Mail autosaves after it is this write's, never a prior draft.
    expect(WRITE_REPLY_SCRIPT.indexOf("set priorIds to id of every message of drafts mailbox")).toBeLessThan(WRITE_REPLY_SCRIPT.indexOf("set r to reply src opening window false"));
    expect(WRITE_REPLY_SCRIPT).toMatch(/first header of m whose name is "In-Reply-To"/);
    // Mail saves a draft in its From's account (realty 2026-11-19: dan@ inbound, info@ From): every landing account counts.
    expect(WRITE_REPLY_SCRIPT).toMatch(/if accNames contains acc and irt contains thread then/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/my threadDrafts\(subj, landIn, thread, priorIds\)/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/if t contains probe then/);
    // No count decides any more: two saves of the same text are one write, not an "ambiguous" handed to the owner.
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/ambiguous|Keep one in Drafts|write again/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/set deadline to \(current date\) \+ waitSecs/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/if \(count of mine\) is 0 then return "pending" & FS & shellText/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/does not contain probe then/);
  });

  it("deletes only after the new draft is found: the named versions (re-checked by their own account and Message-ID) and this run's extras", () => {
    const save = WRITE_REPLY_SCRIPT.indexOf("save r");
    const found = WRITE_REPLY_SCRIPT.indexOf('if (count of mine) is 0 then return "pending"');
    // After the save, nothing is deleted before the new draft is found (the refusal path's clean-up runs before any save, P83).
    const del = WRITE_REPLY_SCRIPT.indexOf("            delete m", save);
    expect(save).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(save);
    expect(del).toBeGreaterThan(found);
    expect(WRITE_REPLY_SCRIPT).toMatch(/messages of drafts mailbox whose message id is tid/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/\(name of account of mailbox of m\) is tAcc and \(message id of m\) is tid then/);
    // Extras are only drafts that appeared during this run (not in priorIds) and hold its text's start or Mail's own shell.
    expect(WRITE_REPLY_SCRIPT).toMatch(/repeat with x in \(mine & shells\)/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/else if my isShell\(t, origText\) then/);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/whose subject is subj\)\s*\n\s*delete/);
  });

  it("P83: never reads the reply's content before setting it (on Mail 16 that read makes Mail ignore every set: content_refused)", () => {
    const made = WRITE_REPLY_SCRIPT.indexOf("set r to reply src opening window false");
    const set = WRITE_REPLY_SCRIPT.indexOf("set content of r to (theBody & tail)");
    expect(made).toBeGreaterThan(0);
    expect(set).toBeGreaterThan(made);
    expect(WRITE_REPLY_SCRIPT.slice(made, set)).not.toMatch(/content of r/);
  });

  it("P85: a reply to our own message goes to its recipients minus ours, set before the text as the door does; none left is no_recipient before any reply exists", () => {
    const made = WRITE_REPLY_SCRIPT.indexOf("set r to reply src opening window false");
    const set = WRITE_REPLY_SCRIPT.indexOf("set content of r to (theBody & tail)");
    const none = WRITE_REPLY_SCRIPT.indexOf('"no_recipient"');
    expect(none).toBeGreaterThan(0);
    expect(none).toBeLessThan(made);
    const between = WRITE_REPLY_SCRIPT.slice(made, set);
    expect(between).toMatch(/if ownMsg then\s+delete every to recipient of r\s+delete every cc recipient of r/);
    expect(between).toMatch(/make new to recipient at end of to recipients with properties \{address:\(contents of x\)\}/);
    expect(WRITE_REPLY_SCRIPT.slice(0, made)).toMatch(/set toList to my othersOf\(srcTo, accAddrs\)/);
    expect(adviceOf("no_recipient")).toMatchObject({ retry: "no" });
  });

  it("P83: a refused reply Mail keeps is this run's own (new since priorIds, in the thread, Mail's shell by form) and goes to Trash", () => {
    const refused = WRITE_REPLY_SCRIPT.indexOf('"content_refused"');
    const block = WRITE_REPLY_SCRIPT.slice(WRITE_REPLY_SCRIPT.indexOf("does not contain probe then"), refused);
    expect(block).toMatch(/delete r/);
    expect(block).toMatch(/my threadDrafts\(subj, landIn, thread, priorIds\)/);
    expect(block).toMatch(/my isShell\(\(content of m\) as text, origText\) then/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/on isShell\(t, orig\)/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/hd does not end with ":" then return false/);
    // The message says what it is not, and never sends the owner to System Settings.
    expect(WRITE_REPLY_SCRIPT).toMatch(/not a macOS permission/);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/System Settings|Automation/);
    let err: DraftWriteError | null = null;
    try {
      parseWriteOutput(["error", "content_refused", "Mail did not take the text.", `140019${LS}`].join(FS));
    } catch (e) {
      err = e as DraftWriteError;
    }
    expect(err?.code).toBe("content_refused");
    expect(err?.message).toMatch(/moved it to Trash \(Mail id 140019\)/);
    expect(adviceOf("content_refused")).toMatchObject({ retry: "no" });
    expect(adviceOf("content_refused").next).toMatch(/not a macOS permission/);
    expect(adviceOf("mail_not_running")).toMatchObject({ retry: "after_owner" });
    expect(adviceOf("mail_not_running").next).toMatch(/does not open Mail itself/);
    // Only a measured refusal of Apple events is a permission.
    for (const [code, a] of Object.entries({ ...Object.fromEntries(["content_refused", "mail_slow", "mail_error", "already_sent", "mail_not_running"].map((c) => [c, adviceOf(c)])) })) expect(a.next, code).not.toMatch(/System Settings|Automation/);
    expect(adviceOf("mail_not_allowed").next).toMatch(/Privacy & Security ▸ Automation/);
    expect(isNotAllowed("execution error: Not authorized to send Apple events to Mail. (-1743)")).toBe(true);
    expect(isNotAllowed("execution error: Mail got an error: Can’t get account. (-1728)")).toBe(false);
  });

  it("a -1743 refusal of osascript is mail_not_allowed; any other failure stays mail_error", async () => {
    const no: OsaRun = async () => Promise.reject(new Error("execution error: Not authorized to send Apple events to Mail. (-1743)"));
    await expect(mailAppDraftWriter(no).findInbound(["a"], "x@y")).rejects.toMatchObject({ code: "mail_not_allowed" });
    const other: OsaRun = async () => Promise.reject(new Error("boom"));
    await expect(mailAppDraftWriter(other).findInbound(["a"], "x@y")).rejects.toMatchObject({ code: "mail_error" });
  });

  it("parses ok and error answers: the new Message-ID and the text read back; the replaced ids are unique", () => {
    expect(parseWriteOutput(okOut({ id: "139679", subject: "Re: Hello", thread: "<abc@x>", from: "Desk <d@x.com>", replaced: `A1@x${LS}A1@x${LS}`, mid: "<NEW@x>", acc: "info@x", shell: "On Mon wrote", text: "Hi Ann" }) + "\n")).toEqual({ draftId: 139679, messageId: "NEW@x", text: "Hi Ann", subject: "Re: Hello", thread: "abc@x", from: "Desk <d@x.com>", replaced: ["A1@x"], left: [], savedIn: "info@x", shell: "On Mon wrote" });
    expect(parseWriteOutput(okOut({ left: `B8@x${LS}` })).left).toEqual(["B8@x"]);
    expect(() => parseWriteOutput(okOut({ mid: "" }))).toThrow(/no Message-ID/);
    expect(() => parseWriteOutput(["error", "content_refused", "nothing was replaced"].join(FS))).toThrow(/nothing was replaced/);
    expect(() => parseWriteOutput("garbage")).toThrow(/Mail answered/);
    // Not seen in time: `mail_slow` with Mail's shell, and a text that neither says "write again" nor asks for a deletion.
    const slow = (() => {
      try {
        parseWriteOutput(["pending", "On Mon, Ann wrote:\nq"].join(FS));
      } catch (e) {
        return e as DraftWriteError;
      }
      return null;
    })();
    expect(slow).toMatchObject({ code: "mail_slow", shell: "On Mon, Ann wrote:\nq" });
    expect(MAIL_SLOW_TEXT).toMatch(/Do not call draft_write again/);
    expect(MAIL_SLOW_TEXT).not.toMatch(/delete|keep one/i);
  });

  it("finds the answered message by Message-ID, read-only: INBOX of each account first, Sent too (P85), never Drafts or Trash", async () => {
    expect(FIND_INBOUND_SCRIPT).not.toMatch(/\b(send|delete|save|reply|activate)\b/);
    expect(FIND_INBOUND_SCRIPT.indexOf('mailbox "INBOX" of acc')).toBeLessThan(FIND_INBOUND_SCRIPT.indexOf("mailboxes of acc"));
    expect(FIND_INBOUND_SCRIPT).toMatch(/skipNames to \{"Drafts", "Trash", "Deleted Messages", "Bin", "Spam", "Junk"\}/);
    expect(FIND_INBOUND_SCRIPT).not.toMatch(/"Sent/);
    // A nested Gmail mailbox ([Gmail]/All Mail, [Gmail]/Sent Mail) is reached only by its full name (read-only check, 2026-11-20).
    expect(FIND_INBOUND_SCRIPT).toMatch(/if \(class of c as text\) is "container" then set fullBn to \(name of c\) & "\/" & bn/);
    expect(MESSAGE_ID_SCRIPT).not.toMatch(/\b(send|delete|save|reply|activate)\b/);
    expect(parseInboundOutput(["ok", "hello@x", "INBOX", "138994"].join(FS) + "\n")).toEqual({ account: "hello@x", mailboxPath: ["INBOX"], messageId: 138994 });
    expect(parseInboundOutput("none\n")).toBeNull();
    // P58: the receiving account's own addresses ride along (what it can send as).
    expect(parseInboundOutput(["ok", "hello@x", "INBOX", "7", ["hello@x", "info@brand.example", ""].join(LS)].join(FS) + "\n")).toEqual({ account: "hello@x", mailboxPath: ["INBOX"], messageId: 7, accountAddresses: ["hello@x", "info@brand.example"] });
    expect(() => parseInboundOutput(["error", "mail_not_running", "Mail is not running"].join(FS))).toThrow(/not running/);
    const seen: string[][] = [];
    const osa: OsaRun = async (_s, a) => (seen.push(a), "none");
    expect(await mailAppDraftWriter(osa).findInbound(["a", "b"], "<Abc@x>")).toBeNull();
    expect(seen[0]).toEqual(["Abc@x", "a", "b"]);
  });

  it("writes the body without its trailing blank lines, passes the probe and the versions to replace, and refuses an empty body", async () => {
    const seen: string[][] = [];
    const osa: OsaRun = async (_s, args) => {
      seen.push(args);
      return okOut();
    };
    await mailAppDraftWriter(osa).writeReply({ account: "desk", mailboxPath: ["INBOX", "Clients"], messageId: 7, body: "Hi\n\n", sender: null, replace: [{ account: "desk", messageId: "<Old1@x>" }, { account: "info", messageId: "old2@x" }], landIn: ["desk", "info"], waitSeconds: 60 });
    expect(seen[0]).toEqual(["desk", `INBOX${LS}Clients`, "7", "Hi", "", "add", "Hi", `desk${PS}Old1@x${LS}info${PS}old2@x`, `desk${LS}info`, "60"]);
    await expect(mailAppDraftWriter(osa).writeReply({ account: "desk", mailboxPath: ["INBOX"], messageId: 7, body: " \n  ", sender: null })).rejects.toThrow(/no text/);
  });
});

describe("the stored preview of a revision (P65 S5, saas draft 1: a poem cut mid-word into one paragraph)", () => {
  it("keeps line breaks, collapses spaces, and cuts a long text at a word with an ellipsis, never past 240", () => {
    expect(excerptOf("Привет,  мой друг!\r\nПисьмо прочёл я,\n\n\n\nКонец.")).toBe("Привет, мой друг!\nПисьмо прочёл я,\n\nКонец.");
    const poem = Array.from({ length: 12 }, (_, i) => `Строка номер ${i + 1}, и в ней слова`).join("\n");
    const e = excerptOf(poem);
    expect(e.length).toBeLessThanOrEqual(240);
    expect(e.endsWith("…")).toBe(true);
    expect(e).toContain("\n");
    expect(poem.startsWith(e.slice(0, -1))).toBe(true);
    // Cut at a word: the character after the kept text is a space or a line break, never the middle of a word.
    expect([" ", "\n"]).toContain(poem[e.length - 1]);
  });
});

describe("a slow Mail (P65 S5)", () => {
  it("a cut osascript is mail_slow, not a failure; the thread read is read-only and parses id, Message-ID, account, text", async () => {
    const cut: OsaRun = async () => {
      throw new OsaTimeout("Mail did not answer within 150 s");
    };
    await expect(mailAppDraftWriter(cut).writeReply({ account: "desk", mailboxPath: ["INBOX"], messageId: 7, body: "Hi", sender: null })).rejects.toMatchObject({ code: "mail_slow", message: MAIL_SLOW_TEXT });
    expect(THREAD_DRAFTS_SCRIPT).not.toMatch(/\b(send|delete|save|reply|activate)\b/);
    expect(parseThreadDrafts([["139858", "<0DD9@reforms.ai>", "hello@reforms.ai", `\nHi${FS}x`].join(FS), ["139868", "A76C@reforms.ai", "hello@reforms.ai", "Hi"].join(FS)].join(RS) + RS + "\n")).toEqual([
      { ref: "139858", messageId: "0DD9@reforms.ai", account: "hello@reforms.ai", body: `\nHi${FS}x` },
      { ref: "139868", messageId: "A76C@reforms.ai", account: "hello@reforms.ai", body: "Hi" },
    ]);
    const seen: string[][] = [];
    await mailAppDraftWriter(async (_s, a) => (seen.push(a), "")).threadDrafts(["a", "b"], "<T@x>", "Re: Hello");
    expect(seen[0]).toEqual(["T@x", "Re: Hello", "a", "b"]);
  });

  it("writeRecorded records the text before Mail is asked, settles a found save and keeps a slow one open with its shell", async () => {
    const calls: string[] = [];
    const log: WriteLog = { start: async (t) => (calls.push(`start ${t}`), 7), settle: async (id, s) => void calls.push(`settle ${id} ${s.messageId}`), shell: async (id, t) => void calls.push(`shell ${id} ${t}`) };
    const w = new FakeDraftWriter();
    const r = await writeRecorded(w, { account: "desk", mailboxPath: ["INBOX"], messageId: 7, body: "Hi Ann\n", sender: null }, log);
    expect(calls).toEqual(["start Hi Ann", `settle 7 ${r.messageId}`]);
    calls.length = 0;
    const slow: OsaRun = async () => ["pending", "On Mon, Ann wrote:"].join(FS);
    await expect(writeRecorded(mailAppDraftWriter(slow), { account: "desk", mailboxPath: ["INBOX"], messageId: 7, body: "Hi", sender: null }, log)).rejects.toMatchObject({ code: "mail_slow" });
    expect(calls).toEqual(["start Hi", "shell 7 On Mon, Ann wrote:"]);
    // A record that fails never stops the write.
    const broken: WriteLog = { start: async () => Promise.reject(new Error("SQLITE_BUSY")), settle: async () => undefined, shell: async () => undefined };
    expect((await writeRecorded(w, { account: "desk", mailboxPath: ["INBOX"], messageId: 7, body: "Hi", sender: null }, broken)).text).toBe("Hi");
  });

  it("reviseDraft replaces each recorded version in its own account and records where Mail saved the new one", async () => {
    const out: OsaRun = async (script, args) => (script === WRITE_REPLY_SCRIPT ? (seen.push(args), okOut({ acc: "info@x" })) : ["ok", "dan@x", "INBOX", "7"].join(FS));
    const seen: string[][] = [];
    const r = await reviseDraft(mailAppDraftWriter(out), { accounts: ["info@x", "dan@x"], sender: "info@x", mailRef: "in@x", body: "Hi", quote: "keep", versions: [{ account: "dan@x", messageId: "E04C@x" }] });
    expect(seen[0]?.[7]).toBe(`dan@x${PS}E04C@x`);
    expect(seen[0]?.[8]).toBe(`dan@x${LS}info@x`);
    expect(r.account).toBe("info@x");
  });
});

describe("a person's text, verbatim (P56)", () => {
  it("keep writes the text only; add appends the quote of the original", () => {
    expect(WRITE_REPLY_SCRIPT).toMatch(/set addQuote to \(item 6 of argv\) is not "keep"/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/if addQuote then set tail to/);
  });

  it("reviseDraft writes through the one writer and replaces only the recorded versions of the answered message's account", async () => {
    const w = new FakeDraftWriter(() => "in@x");
    w.inbound.set("in@x", { account: "desk", mailboxPath: ["INBOX"], messageId: 7 });
    const r = await reviseDraft(w, { accounts: ["desk"], sender: null, mailRef: "<IN@x>".toLowerCase(), body: "Hi Ann,\n\n> kept quote", quote: "keep", versions: [] });
    expect(r).toMatchObject({ replyTo: 7, thread: "in@x", account: "desk", replaced: [] });
    expect(w.drafts[0]).toMatchObject({ text: "Hi Ann,\n\n> kept quote", quote: "keep" });
    // The owner's own draft in the same thread is in no record: it is never replaced.
    w.drafts.push({ id: 1, messageId: "owner@x", account: "desk", thread: "in@x", subject: "Re: message 7", text: "mine", quote: "keep" });
    const r2 = await reviseDraft(w, { accounts: ["desk"], sender: null, mailRef: "in@x", body: "v2", quote: "add", versions: [{ account: "desk", messageId: r.messageId }, { account: "other", messageId: "x@y" }] });
    expect(r2.replaced).toEqual([r.messageId]);
    expect(w.drafts.map((d) => d.text).sort()).toEqual(["mine", "v2"]);
    await expect(reviseDraft(w, { accounts: ["other"], sender: null, mailRef: "in@x", body: "x", quote: "keep", versions: [] })).rejects.toMatchObject({ code: "no_message" });
  });

  it("the version hash is of the text Mail returned, trailing space ignored, and never the text itself", () => {
    expect(versionHash("Hi\n\n")).toBe(versionHash("Hi"));
    expect(versionHash("Hi")).toMatch(/^[0-9a-f]{64}$/);
    expect(probeOf("\n  Hello there, this is a long first line of a reply")).toBe("Hello there, this is a long first line o");
  });
});

let dir: string;
let db: DbHandle;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-draft-write-"));
  db = openDb(path.join(dir, "app.db"));
});
afterEach(() => {
  db.close();
  rmSync(dir, { recursive: true, force: true });
});

/** The hub's own short write of a version (P65), here on the test's database. */
const recordVersionIn = (repos: ReturnType<typeof createRepos>): NonNullable<HubMcpEnv["recordVersion"]> => async (slug, v) => {
  await repos.mailVersions.add({ project: slug, mailRef: v.mailRef, draftId: v.draftId, account: v.account, mailId: v.mailId, messageId: v.messageId, hash: v.hash, source: "agent", signatureFallback: v.signatureFallback });
  await repos.mailVersions.markTrashed(v.trashed);
};

async function connect(writer: FakeDraftWriter | undefined, mailWritten?: (slug: string) => void, extra: Partial<HubMcpEnv> = {}) {
  const repos = createRepos(db.db);
  const server = createHubMcpServer(repos, {
    hubProject: "acme",
    focusFile: path.join(dir, "focus.json"),
    ...(writer ? { drafts: writer, projectMail: () => ({ accounts: ["desk@acme.example"], sender: null }) } : {}),
    ...(mailWritten ? { mailWritten } : {}),
    recordVersion: recordVersionIn(repos),
    // P129 A3: a reply or a new thread is recorded by draft_write itself, on its own short write connection to this database.
    records: { dbPath: path.join(dir, "app.db"), now: beforeContextBlock },
    ...extra,
  });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  return async (args: Record<string, unknown>) => {
    const res = await client.callTool({ name: "draft_write", arguments: args });
    return { isError: res.isError === true, json: JSON.parse((res.content as Array<{ text: string }>)[0]!.text) as Record<string, any> };
  };
}

/** The answered message's headers in the fake Mail: a reply's client is read from them (P129 A3), its From or (ours) its To. */
const heard = (mail: FakeDraftWriter, id: number, from = "Ann <ann@x.example>", to = "desk@acme.example") => mail.headers.set(id, `From: ${from}\nTo: ${to}\nSubject: Hello\n`);
/** What a triage reply records beside the write (P129 verdict 4): the skill, and the client's Notion page always stated. */
const REC = { skill: "triage-mail", notion: { kind: "none" } };

describe("draft_write (hub mcp)", () => {
  const args = (content: string, account = "desk@acme.example", id = 42) => ({ kind: "reply", message: { account, mailbox_path: ["INBOX"], message_id: id }, content, record: REC });
  const revise = (draft: number, content: string, more: Record<string, unknown> = {}) => ({ kind: "revise", draft, content, ...more });

  it("writes the reply text only and records the version and the draft in one call; a rerun names the draft to revise (P65 verdict 4, P129 verdict 4)", async () => {
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    heard(mail, 42);
    const call = await connect(mail);
    const first = await call(args("Hi Ann, first."));
    expect(first).toMatchObject({ isError: false, json: { thread: "m42@example.com", replaced: [], sent: false, recorded: true, record: { action: "created", evidence: "missing" } } });
    expect(first.json.text).toBeUndefined();
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, first."]);
    const draftId = first.json.record.draftId as number;
    expect(first.json.next).toMatch(new RegExp(`^Recorded: draft ${draftId} \\(created`));
    expect(first.json.next).not.toMatch(/run\.sh|JSON on stdin/);
    // The record: the client from the answered message's From, the reply's subject and the thread; the version is the draft's.
    const ann = await repos.clients.idByEmail("acme", "ann@x.example");
    expect((await repos.drafts.ofClient("acme", ann!)).map((d) => [d.id, d.subject, d.status])).toEqual([[draftId, "Re: message 42", "ready"]]);
    const [v] = await repos.mailVersions.ofThread("acme", "<M42@example.com>");
    expect(v).toMatchObject({ draftId, account: "desk@acme.example", messageId: first.json.messageId, mailId: first.json.draftId, source: "agent", trashedAt: null });
    expect(v?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect((await repos.mailVersions.ofDraft(draftId)).map((x) => x.id)).toEqual([v?.id]);
    // Recorded: a rerun is refused by the record, not by Drafts, and names the draft to revise.
    const again = await call(args("Hi Ann, again."));
    expect(again).toMatchObject({ isError: true, json: { error: "already_drafted" } });
    expect(again.json.message).toMatch(new RegExp(`revise it with draft=${draftId}`));
    await repos.drafts.setStatus(draftId, "done");
    expect((await call(args("Hi Ann, again."))).json.message).toMatch(/\(done\) already answered this message: a rerun does not bring it back/);
    expect(mail.drafts).toHaveLength(1);
  });

  it("P129 verdict 4: a record refused after Mail saved leaves the version pending; the same call with the record fixed adopts it, never a second write", async () => {
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    heard(mail, 42);
    const call = await connect(mail);
    // The writer's own rule (a follow-up step only with the sequence skill) refuses after the Mail write.
    const bad = await call({ ...args("Hi Ann, first."), record: { skill: "triage-mail", sequence: { enrollment_id: 1, step: 1 } } });
    expect(bad).toMatchObject({ isError: true, json: { error: "record_invalid", retry: "now" } });
    expect(bad.json.message).toMatch(/saved in Mail but not recorded: .*sequence-drafts.*once more/);
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, first."]);
    const [v] = await repos.mailVersions.ofThread("acme", "m42@example.com");
    expect(v).toMatchObject({ draftId: null, trashedAt: null });
    // Again with the record fixed: the saved version is recorded; the repeat's text is not written.
    const fixed = await call(args("Hi Ann, second wording."));
    expect(fixed).toMatchObject({ isError: false, json: { adopted: true, recorded: true, sent: false, thread: "m42@example.com", record: { action: "created" } } });
    expect(fixed.json.next).toMatch(/^Recorded: draft \d+ .*nothing new was written/);
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, first."]);
    expect((await repos.mailVersions.ofDraft(fixed.json.record.draftId)).map((x) => x.id)).toEqual([v?.id]);
    expect(await call(args("Hi Ann, third."))).toMatchObject({ isError: true, json: { error: "already_drafted" } });
  });

  it("P129 A3: the record's recipients are checked against draft.recipients before Mail is asked", async () => {
    const projects = path.join(dir, "projects");
    cpSync(path.join(FIXTURE_PROJECTS, "acme-travel"), path.join(projects, "acme"), { recursive: true });
    const configFile = path.join(dir, "config.json");
    writeFileSync(configFile, JSON.stringify({ allow_list: ["me@mine.example"] }));
    const mail = new FakeDraftWriter();
    heard(mail, 42);
    heard(mail, 43, "Me <me@mine.example>");
    // No send policy: the safe default, the owner's test list (`allow_list`).
    const call = await connect(mail, undefined, { records: { dbPath: path.join(dir, "app.db"), projectsDir: projects, configFile, now: beforeContextBlock } });
    expect(await call(args("Hi Ann."))).toMatchObject({ isError: true, json: { error: "recipient_not_allowed", blocked: ["ann@x.example"] } });
    expect(await call({ ...args("Hi me.", "desk@acme.example", 43), record: { ...REC, cc: "boss@x.example" } })).toMatchObject({ isError: true, json: { error: "recipient_not_allowed", blocked: ["boss@x.example"] } });
    expect(mail.drafts).toHaveLength(0);
    expect(await call(args("Hi me.", "desk@acme.example", 43))).toMatchObject({ isError: false, json: { recorded: true } });
    expect(mail.drafts).toHaveLength(1);
  });

  it("P129 verdict 7: owner_request not in the owner's prompts is refused before Mail; found, the record does not ask for the chain", async () => {
    const mail = new FakeDraftWriter();
    heard(mail, 42);
    heard(mail, 43, "Bob <bob@x.example>");
    const said = "ответь Анне стихами";
    const call = await connect(mail, undefined, { ownerWords: (_slug, words) => words === said });
    expect(await call({ ...args("Стихи."), owner_request: "answer Ann with a poem" })).toMatchObject({ isError: true, json: { error: "owner_words_not_found" } });
    expect(mail.drafts).toHaveLength(0);
    expect(await call({ ...args("Стихи."), owner_request: said })).toMatchObject({ isError: false, json: { ownerRequest: said, recorded: true, record: { evidence: "ok" } } });
    // Without his words the same record (no context block) is evidence missing.
    expect(await call(args("Hi Bob.", "desk@acme.example", 43))).toMatchObject({ isError: false, json: { recorded: true, record: { evidence: "missing" } } });
  });

  it("P85: the owner's words open a new draft on a message whose drafts are all finished; an open one still refuses", async () => {
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    heard(mail, 42);
    const call = await connect(mail);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: message 42", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    await repos.drafts.markSent(rec.draftId, { at: "2026-11-19T14:15:38Z", via: "test", messageId: "s1@x" });
    expect(await call(args("Hi Ann, more."))).toMatchObject({ isError: true, json: { error: "already_drafted" } });
    const words = "write to Ann again about the new prices";
    const owner = { skill: "bulk-drafts", notion: { kind: "none" } };
    const w = await call({ ...args("Hi Ann, the new prices."), owner_request: words, record: owner });
    expect(w).toMatchObject({ isError: false, json: { thread: "m42@example.com", ownerRequest: words, sent: false, recorded: true, record: { action: "created" } } });
    expect(w.json.next).toMatch(/^Recorded: draft /);
    // Recorded with the words: a new draft beside the sent one, and the client's follow-ups are not finished as a reply.
    const again = w.json.record.draftId as number;
    expect(again).not.toBe(rec.draftId);
    expect(JSON.parse((await repos.drafts.get(again))!.context ?? "{}")).toMatchObject({ ownerRequest: words });
    // A rerun with the same words is the open draft it made: refused, it names that draft.
    expect((await call({ ...args("Hi Ann, again."), owner_request: words, record: owner })).json.message).toMatch(new RegExp(`revise it with draft=${again}`));
    expect(await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: message 42", mailRef: w.json.thread, skill: "bulk-drafts", ownerRequest: words })).toMatchObject({ action: "updated", draftId: again });
    expect(mail.drafts).toHaveLength(1);
  });

  it("P85b: a new thread to a client with no thread, on the owner's words only: written as a new message, recorded without mailRef, revised in place", async () => {
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    const call = await connect(mail, undefined, { projectMail: () => ({ accounts: ["desk@acme.example"], sender: "hello@acme.example", identity: { addresses: ["desk@acme.example", "hello@acme.example"], domains: ["acme.example"], signoff: "", brands: [], languages: ["en"] } }), clientInNotion: async () => ({ state: "client" }) });
    const fresh = { kind: "new", to: "Bob@Client.example", subject: "New prices", content: "Hi Bob, our new prices.", record: { name: "Bob", skill: "bulk-drafts", notion: { kind: "none" } } };
    // P129 A3: kind new carries the owner's words in its shape: without them the call is invalid before anything runs.
    const none = await call(fresh);
    expect(none).toMatchObject({ isError: true, json: { error: "invalid" } });
    expect(none.json.message).toMatch(/owner_request/);
    expect(await call({ ...fresh, to: "hello@acme.example", owner_request: "write to Bob" })).toMatchObject({ isError: true, json: { error: "not_this_project" } });
    const words = "write to Bob about the new prices";
    const w = await call({ ...fresh, owner_request: words });
    expect(w).toMatchObject({ isError: false, json: { newThread: true, sent: false, subject: "New prices", recorded: true, record: { action: "created" } } });
    expect(mail.newTo).toEqual(["bob@client.example"]);
    expect(mail.drafts[0]).toMatchObject({ subject: "New prices", from: "hello@acme.example", thread: "" });
    expect(w.json.next).toMatch(/^Recorded: draft /);
    const draftId = w.json.record.draftId as number;
    const row = await repos.drafts.get(draftId);
    expect(row?.mailRef).toBeNull();
    expect(JSON.parse(row?.context ?? "{}")).toMatchObject({ ownerRequest: words, newThread: true });
    expect(await repos.clients.idByEmail("acme", "bob@client.example")).toBeDefined();
    const [v] = await repos.mailVersions.ofThread("acme", "new:bob@client.example");
    expect(v).toMatchObject({ draftId, messageId: w.json.messageId });
    // Recorded: a rerun is refused and names the draft, never a second message.
    const rerun = await call({ ...fresh, owner_request: words });
    expect(rerun).toMatchObject({ isError: true, json: { error: "already_drafted" } });
    expect(rerun.json.message).toMatch(new RegExp(`revise it with draft=${draftId}`));
    expect(mail.drafts).toHaveLength(1);
    // The revision is a new message again, replacing the recorded version.
    const r = await call(revise(draftId, "Hi Bob, our new prices, corrected."));
    expect(r).toMatchObject({ isError: false });
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Bob, our new prices, corrected."]);
    // A client the hub already wrote to has a thread: reply to its newest message instead.
    await repos.drafts.setStatus(draftId, "done");
    expect(await call({ ...fresh, owner_request: words })).toMatchObject({ isError: true, json: { error: "has_thread" } });
  });

  it("P85b: a new thread is refused for a client marked do not contact", async () => {
    const repos = createRepos(db.db);
    const id = await repos.clients.create({ project: "acme", email: "dnc@client.example", name: "Dee" });
    await repos.clients.setMarks(id, ["do_not_contact"]);
    const call = await connect(new FakeDraftWriter());
    expect(await call({ kind: "new", to: "dnc@client.example", subject: "Hello", content: "Hi", owner_request: "write to Dee", record: REC })).toMatchObject({ isError: true, json: { error: "do_not_contact" } });
  });

  it("P87: a new thread goes only to a client: an address in neither the records nor Notion Clients is refused, an unreadable Notion too", async () => {
    const fresh = { kind: "new", to: "stranger@else.example", subject: "Hello", content: "Hi", owner_request: "write to the stranger", record: REC };
    const seen: string[] = [];
    const no = await connect(new FakeDraftWriter(), undefined, { clientInNotion: async (_slug, email) => (seen.push(email), { state: "not_client" }) });
    expect(await no(fresh)).toMatchObject({ isError: true, json: { error: "not_a_client" } });
    expect(seen).toEqual(["stranger@else.example"]);
    expect(await (await connect(new FakeDraftWriter()))(fresh)).toMatchObject({ isError: true, json: { error: "notion_unavailable" } });
    expect(await (await connect(new FakeDraftWriter(), undefined, { clientInNotion: async () => ({ state: "unavailable", reason: "the instance has no Notion token" }) }))(fresh)).toMatchObject({ isError: true, json: { error: "notion_unavailable" } });
    expect(await (await connect(new FakeDraftWriter(), undefined, { clientInNotion: async () => ({ state: "do_not_contact" }) }))(fresh)).toMatchObject({ isError: true, json: { error: "do_not_contact" } });
  });

  it("P92: in test mode the owner's test addresses pass the new-thread client check; outside it not_a_client stays; a thread is then answered by reply", async () => {
    const repos = createRepos(db.db);
    const words = "подготовь письмо со стихом Лермонтова на markolofsen@gmail.com";
    const fresh = { kind: "new", to: "Markolofsen@Gmail.com", subject: "Парус", content: "Белеет парус одинокий.", owner_request: words, record: { name: "Марк", skill: "bulk-drafts", notion: { kind: "none" } } };
    const seen: string[] = [];
    const notClient = async (_slug: string, email: string) => (seen.push(email), { state: "not_client" as const });
    // recipients any or a list: the allow-list means nothing, the Notion check refuses as before.
    expect(await (await connect(new FakeDraftWriter(), undefined, { clientInNotion: notClient, testRecipients: () => [] }))(fresh)).toMatchObject({ isError: true, json: { error: "not_a_client" } });
    expect(seen).toEqual(["markolofsen@gmail.com"]);
    // Test mode: an allow-list address is written without the Notion read; another address is still checked.
    const mail = new FakeDraftWriter();
    const call = await connect(mail, undefined, { clientInNotion: notClient, testRecipients: () => ["markolofsen@gmail.com", "igor.lesin@gmail.com"] });
    expect(await call({ ...fresh, to: "stranger@else.example" })).toMatchObject({ isError: true, json: { error: "not_a_client" } });
    seen.length = 0;
    const w = await call(fresh);
    expect(w).toMatchObject({ isError: false, json: { newThread: true, sent: false, subject: "Парус", recorded: true } });
    expect(seen).toEqual([]);
    expect(mail.newTo).toEqual(["markolofsen@gmail.com"]);
    // Recorded, then finished: the hub has a thread with him, so a second new thread is has_thread, and the reply path answers it.
    await repos.drafts.setStatus(w.json.record.draftId, "done");
    expect(await call(fresh)).toMatchObject({ isError: true, json: { error: "has_thread" } });
    // Our own sent message answered: its From is ours, so the client is its To (P129 A3, read from the headers).
    heard(mail, 77, "desk@acme.example", "Марк <markolofsen@gmail.com>");
    const reply = await call({ kind: "reply", message: { account: "desk@acme.example", mailbox_path: ["Sent Mail"], message_id: 77 }, content: "Ещё одна строфа.", owner_request: "напиши ему ещё раз", record: { skill: "bulk-drafts", notion: { kind: "none" } } });
    expect(reply).toMatchObject({ isError: false, json: { thread: "m77@example.com", sent: false, recorded: true, record: { action: "created" } } });
    const mark = await repos.clients.idByEmail("acme", "markolofsen@gmail.com");
    expect((await repos.drafts.ofClient("acme", mark!)).map((d) => d.id)).toContain(reply.json.record.draftId);
  });

  it("P87: a hub draft id passed as message_id is named, with the field to use", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<a1@x>", skill: "triage-mail" });
    class Gone extends FakeDraftWriter {
      override async messageIdOf(): Promise<string> {
        throw new DraftWriteError("no_message", "No message in that mailbox.");
      }
    }
    // No such message in Mail: its headers cannot be read either (the fake holds none), as with the real writer.
    const r = await (await connect(new Gone()))({ kind: "reply", message: { account: "desk@acme.example", mailbox_path: ["INBOX"], message_id: rec.draftId }, content: "Hi", owner_request: "write to Ann", record: REC });
    expect(r).toMatchObject({ isError: true, json: { error: "wrong_message_id" } });
    expect(r.json.message).toMatch(new RegExp(`pass draft=${rec.draftId} and content only`));
    expect(r.json.message).toMatch(/never a hub draft id/);
  });

  it("refuses an account outside the project, and refuses without a writer", async () => {
    const mail = new FakeDraftWriter();
    heard(mail, 42);
    expect(await (await connect(mail))(args("Hi", "private@gmail.com"))).toMatchObject({ isError: true, json: { error: "not_this_project" } });
    expect(mail.drafts).toHaveLength(0);
    expect(await (await connect(undefined))(args("Hi"))).toMatchObject({ isError: true, json: { error: "unavailable" } });
  });

  it("a revision names only the hub draft, replaces only the recorded version, and never a draft the owner wrote in the thread", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const other = await repos.drafts.record({ project: "beta", email: "bob@x.example", name: "Bob", subject: "Re: Hi", mailRef: "<m43@example.com>", reason: "asked", skill: "triage-mail" });
    const noRef = await repos.drafts.record({ project: "acme", email: "cy@x.example", name: "Cy", subject: "Hello", reason: "new", skill: "triage-mail" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    const bumped: string[] = [];
    const call = await connect(mail, (slug) => bumped.push(slug));
    const r = await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann, warmer." });
    expect(r).toMatchObject({ isError: false, json: { thread: "m42@example.com", draft: rec.draftId, sent: false, live: true, replaced: [] } });
    // The owner writes his own draft in the same thread: no record names it.
    mail.drafts.push({ id: 1, messageId: "owner-own@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "my own", quote: "keep" });
    const r2 = await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann, warmest." });
    expect(r2.json.replaced).toEqual([r.json.messageId]);
    expect(mail.drafts.map((d) => d.text).sort()).toEqual(["Hi Ann, warmest.", "my own"]);
    const versions = await repos.mailVersions.ofDraft(rec.draftId);
    expect(versions.map((v) => [v.messageId, v.trashedAt === null])).toEqual([[r2.json.messageId, true], [r.json.messageId, false]]);
    expect(bumped).toEqual(["acme", "acme"]);
    expect(await call({ kind: "revise", draft: other.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "not_found" } });
    expect(await call({ kind: "revise", draft: noRef.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "no_thread" } });
    expect(await call({ kind: "revise", draft: rec.draftId, account: "desk@acme.example", content: "x" })).toMatchObject({ isError: true, json: { error: "invalid" } });
    expect(await call({ kind: "revise", content: "x" })).toMatchObject({ isError: true, json: { error: "invalid" } });
    mail.inbound.clear();
    expect(await call({ kind: "revise", draft: rec.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "no_message" } });
    expect(bumped).toEqual(["acme", "acme"]);
  });

  it("P83: a sent draft is refused with already_sent before Mail is asked; every refusal says whether a retry helps", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    await repos.drafts.markSent(rec.draftId, { at: "2026-11-19T14:15:38Z", via: "test", messageId: "s1@x" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    const call = await connect(mail);
    const r = await call({ kind: "revise", draft: rec.draftId, content: "A new poem." });
    // P85: "now" means another call, as a new reply with the owner's words, not the same revision again.
    expect(r).toMatchObject({ isError: true, json: { error: "already_sent", retry: "now" } });
    expect(r.json.message).toMatch(/was sent \(2026-11-19 14:15\): a sent mail is not revised/);
    expect(r.json.message).toMatch(/newest message of the thread .*owner_request/);
    expect(mail.drafts).toHaveLength(0);
    // A refusal of the arguments says "now": another call helps once they are fixed.
    expect(await call({ kind: "revise", content: "x" })).toMatchObject({ isError: true, json: { error: "invalid", retry: "now" } });
  });

  it("P99 S0 (a): a done or skipped draft is refused with draft_finished before any Mail call; the advice names a new reply on the owner's words", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Wow", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    let mailCalls = 0;
    const counted = new Proxy(mail, { get: (t, k, r) => { const v = Reflect.get(t, k, r); return typeof v === "function" ? (...a: unknown[]) => { mailCalls += 1; return (v as (...x: unknown[]) => unknown).apply(t, a); } : v; } });
    const call = await connect(counted, undefined, { recordRevision: (slug, id, r) => repos.drafts.revised(slug, id, r) });
    for (const status of ["done", "skipped"] as const) {
      await repos.drafts.setStatus(rec.draftId, "ready").catch(() => undefined);
      await repos.drafts.setStatus(rec.draftId, status);
      const r = await call({ kind: "revise", draft: rec.draftId, content: "A poem." });
      expect(r).toMatchObject({ isError: true, json: { error: "draft_finished", retry: "now" } });
      expect(r.json.message).toMatch(new RegExp(`Draft ${rec.draftId} is ${status}: a finished draft is not revised.*owner_request.*Nothing was written`));
      expect(r.json.next).toMatch(/new reply to the newest message.*owner_request/);
      expect(r.json.next).not.toMatch(/same mailRef/);
    }
    expect(mailCalls).toBe(0);
    expect(mail.drafts).toHaveLength(0);
    expect(await repos.mailVersions.ofThread("acme", "<m42@example.com>")).toHaveLength(0);
    // reason belongs to a revision only.
    expect(await call({ kind: "reply", message: { account: "desk@acme.example", mailbox_path: ["INBOX"], message_id: 42 }, content: "x", reason: "why", record: REC })).toMatchObject({ isError: true, json: { error: "invalid" } });
    expect(mail.drafts).toHaveLength(0);
  });

  it("a failed live bump or version record never fails the write", async () => {
    const mail = new FakeDraftWriter();
    heard(mail, 42);
    const r = await (await connect(mail, () => {
      throw new Error("SQLITE_BUSY");
    }, { recordVersion: async () => {
      throw new Error("SQLITE_BUSY");
    } }))(args("Hi Ann."));
    expect(r).toMatchObject({ isError: false, json: { live: false, sent: false, recorded: true } });
    expect(r.json.next).toMatch(/could not record this Mail version/);
    expect(mail.drafts).toHaveLength(1);
  });

  // P65 S5 (2026-11-19, saas draft 1): a write Mail saved after the writer stopped waiting, then a second write, left the
  // thread with drafts the Hub wrote but had not recorded, and the agent asked the owner to delete them.
  it("a write Mail saves late is adopted at the next write and replaced by it: one version stays, nothing for the owner", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    const call = await connect(mail, undefined, { withRepos: (fn) => fn(repos) });
    mail.slowNext = true;
    const slow = await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann, slow." });
    expect(slow).toMatchObject({ isError: true, json: { error: "mail_slow" } });
    expect(slow.json.message).toMatch(/Do not call draft_write again/);
    expect(slow.json.message).not.toMatch(/delete|keep one/i);
    const [open] = await repos.mailWrites.ofThread("acme", "m42@example.com", rec.draftId);
    expect(open).toMatchObject({ draftId: rec.draftId, settledAt: null });
    // Mail saved it after all; the owner also keeps a draft of his own in the thread.
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, slow."]);
    mail.drafts.push({ id: 1, messageId: "owner-own@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "my own words", quote: "keep" });
    const next = await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann, again." });
    expect(next).toMatchObject({ isError: false });
    expect(mail.drafts.map((d) => d.text).sort()).toEqual(["Hi Ann, again.", "my own words"]);
    const versions = await repos.mailVersions.ofDraft(rec.draftId);
    expect(versions.map((v) => [v.source, v.trashedAt === null])).toEqual([["agent", true], ["adopted", false]]);
    expect((await repos.mailWrites.ofThread("acme", "m42@example.com", rec.draftId)).every((w) => w.settledAt !== null)).toBe(true);
  });

  it("a second save of a text the Hub recorded is the Hub's (139858 = 139868); a new reply waits for a write still landing", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    mail.inbound.set("m43@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 43 });
    const call = await connect(mail, undefined, { withRepos: (fn) => fn(repos) });
    const first = await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann, the poem." });
    mail.drafts.push({ id: 2, messageId: "dup@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "Hi Ann, the poem.", quote: "add" });
    const second = await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann, sarcasm." });
    expect(new Set(second.json.replaced)).toEqual(new Set([first.json.messageId, "dup@x"]));
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, sarcasm."]);
    // A new reply whose write is still landing: the same call again adopts the late save and records it (P129 verdict 4), never writes again.
    heard(mail, 43, "Bob <bob@x.example>");
    mail.slowNext = true;
    const nr = args("Hi Bob.", "desk@acme.example", 43);
    expect(await call(nr)).toMatchObject({ isError: true, json: { error: "mail_slow" } });
    const again = await call(nr);
    expect(again).toMatchObject({ isError: false, json: { adopted: true, recorded: true, sent: false, thread: "m43@example.com", record: { action: "created" } } });
    expect(again.json.next).toMatch(/nothing new was written/);
    expect(mail.drafts.filter((d) => d.text === "Hi Bob.")).toHaveLength(1);
    const bob = await repos.clients.idByEmail("acme", "bob@x.example");
    expect((await repos.drafts.ofClient("acme", bob!)).map((d) => d.id)).toEqual([again.json.record.draftId]);
    expect((await repos.mailVersions.ofDraft(again.json.record.draftId)).map((v) => v.source)).toEqual(["adopted"]);
  });

  it("Mail's empty reply in the thread (saas 139835: the original under one attribution line) is adopted and replaced; read-only otherwise", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    mail.contents.set(42, "How are you? Its new request\n\n-- \nRegards!\n\n\n");
    const call = await connect(mail, undefined, { withRepos: (fn) => fn(repos) });
    await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann." });
    mail.drafts.push({ id: 3, messageId: "shell@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "\n\nOn 14 Nov 2026, at 14:26, Ann <ann@x.example> wrote:\nHow are you? Its new request\n\n-- \nRegards!\n\n\n\n", quote: "add" });
    mail.drafts.push({ id: 4, messageId: "own@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "On Monday I will call.\nHow are you? Its new request", quote: "add" });
    const r = await call({ kind: "revise", draft: rec.draftId, content: "Hi Ann, again." });
    expect(r.json.replaced).toContain("shell@x");
    expect(mail.drafts.map((d) => d.messageId).sort()).toEqual(["own@x", r.json.messageId].sort());
  });

  it("mail-mcp's create_reply is denied: the hub writes every draft", () => {
    expect(DENIED_TOOLS).toContain("mcp__mail-mcp__create_reply");
  });
});

// P60 B2 and the coordinator's live finding (2026-11-19, session fa1cf288): the agent wrote "Reforms.ai team" under a mail to
// the Carapis address. The writer signs instead, from the answered message's headers, and records a revision itself.
describe("draft_write signs per brand and records a revision (P60)", () => {
  const fx = path.join(__dirname, "..", "..", "projects", "test", "fixtures", "brands");
  const one = parseProjectMd(readFileSync(path.join(fx, "one-mailbox.md"), "utf8"), "one-mailbox").config;
  const cases = JSON.parse(readFileSync(path.join(fx, "cases.json"), "utf8")) as { forwarded: { headersFile: string; brand: string; wroteTo: string; signature: string[] } };
  const account = one.mail.accounts[0] ?? "";
  const projectMail = () => ({ accounts: one.mail.accounts, sender: one.mail.sender, identity: { addresses: one.mail.addresses, domains: one.mail.domains, signoff: one.signoff, brands: one.brands, languages: one.languages } });

  it("the forwarded mail (headers of the real one) is signed with that brand's lines; the agent's own closing is refused, never edited (P65 S2)", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const typed = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: `Hello,\n\nHere is the answer.\n\n${one.signoff}` });
    expect(typed).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    expect(typed.json.message).toMatch(/"Best regards,"/);
    expect(mail.drafts).toHaveLength(0);
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Hello,\n\nHere is the answer." });
    expect(r).toMatchObject({ isError: false, json: { brand: cases.forwarded.brand, clientWroteTo: cases.forwarded.wroteTo, signature: "signed" } });
    expect(mail.drafts[0]?.text).toBe(`Hello,\n\nHere is the answer.\n\n${cases.forwarded.signature.join("\n")}`);
  });

  it("P87 (B6): a reply on the owner's words to our own sent mail keeps that mail's brand, not the account's", async () => {
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    mail.headers.set(42, `From: ${account}\nTo: mark@client.example\nSubject: Re: Hello\n`);
    const sent = await repos.drafts.record({ project: "acme", email: "mark@client.example", name: "Mark", subject: "Re: Hello", mailRef: "<c1@client.example>", skill: "triage-mail", brand: cases.forwarded.brand, wroteTo: cases.forwarded.wroteTo });
    await repos.drafts.markSent(sent.draftId, { at: "2026-11-19T10:00:00Z", via: "message-id", messageId: "m42@example.com" });
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Hello,\n\nOne more note.", owner_request: "write to Mark again" });
    expect(r).toMatchObject({ isError: false, json: { brand: cases.forwarded.brand, signature: "signed" } });
    expect(mail.drafts[0]?.text).toBe(`Hello,\n\nOne more note.\n\n${cases.forwarded.signature.join("\n")}`);
  });

  it("P97 S3: a Leads row passes the new-thread check, and brand signs the message as that brand whatever it goes from", async () => {
    const mail = new FakeDraftWriter();
    const call = await connect(undefined, undefined, { drafts: mail, projectMail, clientInNotion: async () => ({ state: "lead", pageId: "a".repeat(32) }) });
    const fresh = { kind: "new", to: "koboriubiratan@gmail.com", subject: "Your Carapis API request", content: "Hello,\n\nThank you for your request.", owner_request: "write a first mail to koboriubiratan@gmail.com of acme", record: { skill: "bulk-drafts", notion: { kind: "lead", page_id: "a".repeat(32) } } };
    expect(await call({ ...fresh, brand: "Nope" })).toMatchObject({ isError: true, json: { error: "invalid" } });
    const r = await call({ ...fresh, brand: "carapis" });
    expect(r).toMatchObject({ isError: false, json: { newThread: true, brand: "Carapis", signature: "signed", recorded: true } });
    expect(mail.newTo).toEqual(["koboriubiratan@gmail.com"]);
    expect(mail.drafts[0]?.text).toBe("Hello,\n\nThank you for your request.\n\nBest regards,\nCarapis team\ncarapis.com");
  });

  it("refuses the ending of Sent 139821 (a Russian closing and the team's name), and a closing in any of the last four lines", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Здравствуйте, Марк!\n\nСпасибо за письмо, ответим подробно завтра.\n\nС теплом,\nкоманда Carapis" });
    expect(r).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    expect(r.json.message).toMatch(/"С теплом,"/);
    expect((await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Hi,\n\nAnswer.\n\nKind regards, Mark\nCarapis" })).json.error).toBe("own_signoff");
    expect((await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Hi,\n\nAnswer below.\n\nCarapis team" })).json.error).toBe("own_signoff");
    // A sentence that starts like a closing is the reply, not a sign-off.
    expect((await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Hi,\n\nThank you for your patience, we will answer tomorrow." })).isError).toBe(false);
  });

  it("refuses the ending of the first Hub send (send_log 1): a closing no list names, over the team's name in Russian (P65 live send check)", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Здравствуйте, Марк!\n\nВот стихотворение, как вы просили.\n\nС теплом и дружеским поклоном,\nКоманда Carapis" });
    expect(r).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    expect(r.json.message).toMatch(/"С теплом и дружеским поклоном,"/);
    expect((await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Здравствуйте!\n\nОтвет ниже.\n\nКоманда Carapis" })).json.error).toBe("own_signoff");
    expect((await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Hallo,\n\nDie Antwort.\n\nViele Grüße\nIhr Carapis Team" })).json.error).toBe("own_signoff");
    expect(mail.drafts).toHaveLength(0);
  });

  it("signs in the reply's language; with no line for it, in English with the signature_language check (P60 finding 2)", async () => {
    const ru = { ...one, signoff: "en: Best regards, | ru: С уважением,", brands: one.brands.map((b) => (b.name === "Carapis" ? { ...b, signature: ["en: Carapis team | ru: Команда Carapis", "carapis.com"] } : b)) };
    const pm = (c: typeof one) => () => ({ accounts: c.mail.accounts, sender: c.mail.sender, identity: { addresses: c.mail.addresses, domains: c.mail.domains, signoff: c.signoff, brands: c.brands, languages: c.languages } });
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    // Every message answered here is the forwarded one: the reply's client and brand come from its headers (P129 A3).
    for (const id of [43, 44, 45, 46]) mail.headers.set(id, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail: pm(ru) });
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Здравствуйте!\n\nДа, API отдаёт цены по всем рынкам." });
    expect(r).toMatchObject({ isError: false, json: { signature: "signed" } });
    expect(r.json.signatureFallback).toBeUndefined();
    expect(mail.drafts[0]?.text.split("\n").slice(-3)).toEqual(["С уважением,", "Команда Carapis", "carapis.com"]);
    const en = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 43 }, content: "Hello,\n\nYes, the API returns prices for every market." });
    expect(mail.drafts[1]?.text.split("\n").slice(-3)).toEqual(["Best regards,", "Carapis team", "carapis.com"]);
    expect(en.json.signatureFallback).toBeUndefined();
    // The fixture as it is: English lines only. A Russian reply falls back to English and says so.
    const plain = await (await connect(undefined, undefined, { drafts: mail, projectMail: pm({ ...one, signoff: "en: Best regards," }) }))({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 44 }, content: "Здравствуйте!\n\nОтветим завтра." });
    expect(plain.json).toMatchObject({ signatureFallback: "ru" });
    expect(plain.json.next).toMatch(/signature_language/);
    const [v] = await repos.mailVersions.ofThread("acme", "m44@example.com");
    expect(v?.signatureFallback).toBe("ru");
    // The first Hub send's shape (P65 live send check): untagged English lines, `languages: en`, a Russian reply.
    const saas = { ...one, signoff: "Best regards,", languages: ["en"] };
    const untagged = await (await connect(undefined, undefined, { drafts: mail, projectMail: pm(saas) }))({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 45 }, content: "Здравствуйте!\n\nОтветим завтра." });
    expect(untagged.json).toMatchObject({ signatureFallback: "ru" });
    expect(untagged.json.next).toMatch(/signature_language/);
    // Russian among `languages`: the owner's untagged lines are for it, no check.
    const both = await (await connect(undefined, undefined, { drafts: mail, projectMail: pm({ ...saas, languages: ["en", "ru"] }) }))({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 46 }, content: "Здравствуйте!\n\nОтветим завтра." });
    expect(both.json.signatureFallback).toBeUndefined();
  });

  it("headers that name no brand: the placeholder, and the result says so; headers that cannot be read name no client: nothing is written", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, "To: someone@example.org");
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Answer." });
    expect(r.json).toMatchObject({ brand: null, signature: "placeholder" });
    expect(r.json.next).toMatch(/\[Owner: signature for/);
    expect(mail.drafts[0]?.text.split("\n").at(-1)).toBe("[Owner: signature for unknown brand]");
    mail.drafts = [];
    // P129 A3: the reply's client is read from the same headers before Mail is asked; unreadable, the call is refused (it was signed with the placeholder).
    const unread = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 7 }, content: "Answer." });
    expect(unread).toMatchObject({ isError: true, json: { error: "no_recipient" } });
    expect(mail.drafts).toHaveLength(0);
  });

  it("a revision is signed once and recorded in place: same draft id, brand stored, no record of its own", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail", excerpt: "old" });
    await repos.drafts.setChecked(rec.draftId, true).catch(() => undefined);
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account, mailboxPath: ["INBOX"], messageId: 42 });
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const recordRevision = (slug: string, id: number, r: { excerpt: string; wroteTo: string | null; brand: string | null; reason?: string }) => repos.drafts.revised(slug, id, r);
    const call = await connect(undefined, undefined, { drafts: mail, projectMail, recordRevision });
    const first = await call({ kind: "revise", draft: rec.draftId, content: "Warmer answer." });
    expect(first.json).toMatchObject({ recorded: true, draft: rec.draftId, brand: cases.forwarded.brand });
    expect(first.json.next).toMatch(new RegExp(`^Recorded: draft ${rec.draftId} updated in place`));
    expect(first.json.record).toBeUndefined();
    expect(await call({ kind: "revise", draft: rec.draftId, content: `Warmer answer.\n\n${cases.forwarded.signature.join("\n")}` })).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    const second = await call({ kind: "revise", draft: rec.draftId, content: "Warmer answer." });
    expect(second.json.recorded).toBe(true);
    expect(mail.drafts).toHaveLength(1);
    expect(mail.drafts[0]?.text.match(new RegExp(cases.forwarded.signature.at(-1)!.replace(/\./g, "\\."), "g"))).toHaveLength(1);
    const row = await repos.drafts.get(rec.draftId);
    expect(row).toMatchObject({ id: rec.draftId, body: "Warmer answer.", brand: cases.forwarded.brand, wroteTo: cases.forwarded.wroteTo, checked: false, status: "ready" });
    // P99 S0 (c): a revision may replace "Why this email"; without reason the recorded one stays.
    expect(row?.reason).toBe("asked");
    const third = await call({ kind: "revise", draft: rec.draftId, content: "Warmer answer, with the offer.", reason: "They asked for the commercial offer." });
    expect(third.json.recorded).toBe(true);
    expect((await repos.drafts.get(rec.draftId))?.reason).toBe("They asked for the commercial offer.");
    await repos.drafts.setStatus(rec.draftId, "done");
    await expect(repos.drafts.revised("acme", rec.draftId, { excerpt: "x", wroteTo: null, brand: null })).rejects.toThrow(/only a ready or held draft/);
  });

  it("mail_brand resolves pasted headers without a Mail read", async () => {
    const server = createHubMcpServer(createRepos(db.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), projectMail });
    const [a, b] = InMemoryTransport.createLinkedPair();
    await server.connect(b);
    const client = new Client({ name: "test", version: "0" });
    await client.connect(a);
    const res = await client.callTool({ name: "mail_brand", arguments: { headers: readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8") } });
    expect(JSON.parse((res.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ brand: cases.forwarded.brand, clientWroteTo: cases.forwarded.wroteTo, signature: "signed" });
    const viaTo = await client.callTool({ name: "mail_brand", arguments: { headers: `Delivered-To: ${account}`, to: [cases.forwarded.wroteTo] } });
    expect(JSON.parse((viaTo.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ brand: cases.forwarded.brand });
  });
});

// P58: a reply goes from the address the client wrote to when the receiving account can send as it, else from that
// account (never silently from mail.sender), and the agent is told who the client sees in unambiguous words.
describe("draft_write: the From the client sees (P58)", () => {
  const fx = path.join(__dirname, "..", "..", "projects", "test", "fixtures", "brands");
  const one = parseProjectMd(readFileSync(path.join(fx, "one-mailbox.md"), "utf8"), "one-mailbox").config;
  const headers = readFileSync(path.join(fx, "mail-138994-headers.txt"), "utf8");
  const account = one.mail.accounts[0] ?? "";
  const projectMail = () => ({ accounts: one.mail.accounts, sender: account, identity: { addresses: one.mail.addresses, domains: one.mail.domains, signoff: one.signoff, brands: one.brands, languages: one.languages } });

  it("saas: from the receiving account with no fault reason, from the brand address only if the account can send as it", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, headers);
    mail.headers.set(43, headers);
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 42 }, content: "Hello,\n\nHere is the answer." });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ fromSeenByClient: account, clientWroteTo: "info@carapis.com", fromReason: null });
    expect(r.json).not.toHaveProperty("from");
    expect(r.json).not.toHaveProperty("wroteTo");
    expect(r.json.next).not.toMatch(/The client sees From/);
    expect(mail.drafts[0]?.from).toBe(account);
    mail.addresses.set(account, [account, "info@carapis.com"]);
    const s = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 43 }, content: "Hello,\n\nHere is the answer." });
    expect(s.json).toMatchObject({ fromSeenByClient: "info@carapis.com", clientWroteTo: "info@carapis.com", fromReason: null });
    expect(mail.drafts[1]?.from).toBe("info@carapis.com");
  });

  it("writes the resolved brand display name while retaining the technical account address", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(47, headers);
    const named = () => ({ ...projectMail(), identity: { ...projectMail().identity, brands: one.brands.map((b) => b.name === "Carapis" ? { ...b, displayName: "Carapis" } : b) } });
    const call = await connect(undefined, undefined, { drafts: mail, projectMail: named });
    const r = await call({ kind: "reply", record: REC, message: { account, mailbox_path: ["INBOX"], message_id: 47 }, content: "Hello,\n\nHere is the answer." });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ fromSeenByClient: "Carapis <hello@reforms.ai>", clientWroteTo: "info@carapis.com" });
    expect(mail.drafts[0]?.from).toBe("Carapis <hello@reforms.ai>");
  });

  it("realty: a revision of mail received in dan@ is written from dan@ and saved there, though mail.sender is info@ (realty drafts 1 and 2)", async () => {
    const mail = new FakeDraftWriter();
    mail.inbound.set("ref-dan@x", { account: "dan@danmerriam.com", mailboxPath: ["INBOX"], messageId: 9 });
    const r = await reviseDraft(mail, { accounts: ["info@caribbeanrealestatemls.com", "dan@danmerriam.com"], sender: "info@caribbeanrealestatemls.com", clientWroteTo: "dan@danmerriam.com", mailRef: "ref-dan@x", body: "Hi,\n\nYes.", quote: "keep", versions: [{ account: "info@caribbeanrealestatemls.com", messageId: "old@x" }] });
    expect(mail.drafts[0]).toMatchObject({ from: "dan@danmerriam.com", account: "dan@danmerriam.com" });
    expect(r).toMatchObject({ from: "dan@danmerriam.com", account: "dan@danmerriam.com", fromReason: null, clientWroteTo: "dan@danmerriam.com" });
  });
});
