import { describe, expect, it } from "vitest";
import { bareId, FakeMailer, FIND_SCRIPT, LIST_DRAFTS_SCRIPT, mailAppMailer, parseDraftHeads, parseFindOutput, parseTrashOutput, SEND_SCRIPT, TRASH_SCRIPT } from "../src/mailer";
import { appleScriptCompileError, canCompileAppleScript, deleteOfLoopItem } from "../../../test-support/osacompile";

// osascript is injected: nothing here starts Mail.

const FS = "\x1f", RS = "\x1e", LS = "\x1d";
const rec = (f: string[]) => f.join(FS) + RS;

describe("the Mail scripts compile (osacompile, no Mail call)", () => {
  // A keyword as a variable name (`before`, `since`) fails every call with -2741 before Mail is reached; string-match
  // tests do not see it. Values (subject, ids, text) are argv items, never in the source.
  it.skipIf(!canCompileAppleScript).each([
    ["FIND_SCRIPT", FIND_SCRIPT],
    ["LIST_DRAFTS_SCRIPT", LIST_DRAFTS_SCRIPT],
    ["TRASH_SCRIPT", TRASH_SCRIPT],
    ["SEND_SCRIPT", SEND_SCRIPT],
  ])("%s", (_name, script) => {
    expect(appleScriptCompileError(script)).toBeNull();
    expect(deleteOfLoopItem(script)).toBeNull();
  });

  it("the loop-item check catches v0.12.15's trash loop and passes a delete of Mail's own reference", () => {
    expect(deleteOfLoopItem("repeat with m in (messages of drafts mailbox whose message id is mid)\n  if x then\n    delete m\n  end if\nend repeat")).toMatch(/repeat with m in/);
    expect(deleteOfLoopItem("repeat with fid in ids\n  set m to (first message of drafts mailbox whose id is (contents of fid))\n  delete m\nend repeat")).toBeNull();
  });
});

describe("Mail.app mailer", () => {
  it("parses the draft list: ids without brackets (case kept for Mail), In-Reply-To bare, address lists, attachment count", () => {
    const out = rec(["501", "<D1@Acme.example>", "owner@acme.example", "Acme <owner@acme.example>", `a@x.example${LS}b@x.example${LS}`, "", "", "Re: hi", "Line 1\nLine 2", "2", "<In@Reply.example>"]) + "\n";
    expect(parseFindOutput(out)).toEqual([{ ref: "501", messageId: "D1@Acme.example", account: "owner@acme.example", inReplyTo: "in@reply.example", sender: "Acme <owner@acme.example>", to: ["a@x.example", "b@x.example"], cc: [], bcc: [], subject: "Re: hi", body: "Line 1\nLine 2", attachments: 2 }]);
    expect(parseFindOutput("")).toEqual([]);
    expect(FIND_SCRIPT).toMatch(/first header of m whose name is "In-Reply-To"/);
  });

  it("lists every draft by its headers only, never its text (P65)", () => {
    expect(LIST_DRAFTS_SCRIPT).not.toMatch(/content of m\b(?! of)|\bdelete\b|\bsend\b|whose content/);
    expect(parseDraftHeads(rec(["7", "<AB@x>", "desk", "Re: hi", "<T@y>"]) + rec(["8", "", "", "Notes", ""]))).toEqual([
      { ref: "7", messageId: "AB@x", account: "desk", subject: "Re: hi", inReplyTo: "t@y" },
      { ref: "8", messageId: null, account: null, subject: "Notes", inReplyTo: null },
    ]);
  });

  it("findDrafts passes the subject as an argument, never inside the script", async () => {
    const calls: Array<{ script: string; args: string[] }> = [];
    const m = mailAppMailer(async (script, args) => (calls.push({ script, args }), ""));
    await m.findDrafts({ mailRef: null, subject: 'He said "hi"\\ & more' });
    expect(calls).toEqual([{ script: FIND_SCRIPT, args: ['He said "hi"\\ & more'] }]);
    expect(FIND_SCRIPT).not.toMatch(/\bsend\b/); // reading is read-only
    expect(FIND_SCRIPT).toMatch(/\(deleted status of m\) is false/); // a revision's older version on its way out is not a draft (P52)
  });

  it("send hands the draft's exact fields to one script; a non-ok answer throws", async () => {
    const calls: Array<{ script: string; args: string[] }> = [];
    const d = { ref: "501", messageId: "d1@x", account: "a", inReplyTo: null, sender: "Acme <o@acme.example>", to: ["a@x.example"], cc: ["c@x.example"], bcc: [], subject: "S", body: "B\n\"q\"", attachments: 0 };
    await mailAppMailer(async (script, args) => (calls.push({ script, args }), "ok")).send(d, "<In@Reply.example>");
    expect(calls).toEqual([{ script: SEND_SCRIPT, args: ["Acme <o@acme.example>", "S", "B\n\"q\"", "a@x.example", "c@x.example", "", "501", "in@reply.example", "a"] }]);
    await expect(mailAppMailer(async () => "nope").send(d)).rejects.toThrow(/Mail answered/);
    await expect(mailAppMailer(async () => { throw new Error("Mail got an error"); }).send(d)).rejects.toThrow(/Mail got an error/);
  });

  it("send answers the message it replies to (P56: In-Reply-To kept), with exactly the draft's recipients, and never activates Mail", () => {
    expect(SEND_SCRIPT).toMatch(/set msg to reply src opening window false/);
    expect(SEND_SCRIPT).toMatch(/delete every to recipient of msg[\s\S]*delete every cc recipient of msg[\s\S]*delete every bcc recipient of msg/);
    expect(SEND_SCRIPT).toMatch(/if msg is missing value then set msg to make new outgoing message/);
    expect(SEND_SCRIPT).not.toMatch(/\bactivate\b|System Events|clipboard/);
  });

  it("the trash script deletes only a draft of that account with that Message-ID, re-read just before the delete (P65)", async () => {
    expect(TRASH_SCRIPT).toMatch(/\(name of account of mailbox of m\) is accName and \(message id of m\) is mid then\s+delete m/);
    // v0.12.15: the draft is Mail's own reference (by id) when it is deleted, never a `repeat with m in (…)` item.
    expect(TRASH_SCRIPT).toMatch(/set m to \(first message of drafts mailbox whose id is \(contents of fid\)\)/);
    expect(parseTrashOutput(["", "A@x\u001d", "A@x: Mail got an error\u001d"].join("\u001f"))).toEqual({ moved: [], refused: ["A@x"], why: ["A@x: Mail got an error"] });
    expect(TRASH_SCRIPT).not.toMatch(/\bsend\b|expunge|empty trash|whose subject|content of m/i);
    const calls: Array<{ script: string; args: string[] }> = [];
    const r = await mailAppMailer(async (script, args) => (calls.push({ script, args }), `A@x${LS}B@x${LS}\x1fC@x${LS}\n`)).trashDrafts([{ account: "desk", messageId: "<A@x>" }, { account: "desk", messageId: "B@x" }, { account: "other", messageId: "C@x" }]);
    expect(calls[0]?.args).toEqual(["desk", "A@x", "desk", "B@x", "other", "C@x"]);
    expect(r).toEqual({ moved: ["A@x", "B@x"], refused: ["C@x"], why: [] });
    expect(parseTrashOutput("\x1f")).toEqual({ moved: [], refused: [], why: [] });
    expect(await mailAppMailer(async () => { throw new Error("never called"); }).trashDrafts([])).toEqual({ moved: [], refused: [] });
  });

  it("bareId normalises angle brackets and case", () => {
    expect(bareId(" <AbC@x> ")).toBe("abc@x");
    expect(bareId(null)).toBe("");
  });
});

describe("FakeMailer", () => {
  it("records sends and drops the draft", async () => {
    const f = new FakeMailer([{ ref: "1", messageId: null, account: null, inReplyTo: null, sender: null, to: ["a@x"], cc: [], bcc: [], subject: "S", body: "B", attachments: 0 }]);
    expect(await f.findDrafts({ mailRef: null, subject: "S" })).toHaveLength(1);
    await f.send(f.drafts[0]!);
    expect(f.sent).toHaveLength(1);
    expect(f.drafts).toEqual([]);
  });
});
