import { describe, expect, it } from "vitest";
import { bareId, FakeMailer, FIND_SCRIPT, LIST_HUB_SCRIPT, mailAppMailer, parseFindOutput, parseTrashOutput, SEND_SCRIPT, TRASH_SCRIPT } from "../src/mailer";

// osascript is injected: nothing here starts Mail.

const FS = "\x1f", RS = "\x1e", LS = "\x1d";
const rec = (f: string[]) => f.join(FS) + RS;

describe("Mail.app mailer", () => {
  it("parses the draft list: ids without brackets, address lists, attachment count", () => {
    const out = rec(["501", "<D1@Acme.example>", "owner@acme.example", "Acme <owner@acme.example>", `a@x.example${LS}b@x.example${LS}`, "", "", "Re: hi", "Line 1\nLine 2", "2"]) + "\n";
    expect(parseFindOutput(out)).toEqual([{ ref: "501", messageId: "d1@acme.example", account: "owner@acme.example", sender: "Acme <owner@acme.example>", to: ["a@x.example", "b@x.example"], cc: [], bcc: [], subject: "Re: hi", body: "Line 1\nLine 2", attachments: 2 }]);
    expect(parseFindOutput("")).toEqual([]);
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
    const d = { ref: "501", messageId: "d1@x", account: "a", sender: "Acme <o@acme.example>", to: ["a@x.example"], cc: ["c@x.example"], bcc: [], subject: "S", body: "B\n\"q\"", attachments: 0 };
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

  it("the trash script deletes only by id after re-reading the first line; the list script only reads", async () => {
    expect(TRASH_SCRIPT).toMatch(/if firstLine starts with wanted then\s+delete m/);
    expect(TRASH_SCRIPT).not.toMatch(/\bsend\b|expunge|empty trash|whose subject/i);
    expect(LIST_HUB_SCRIPT).not.toMatch(/\bdelete\b|\bsend\b/);
    const calls: Array<{ script: string; args: string[] }> = [];
    const r = await mailAppMailer(async (script, args) => (calls.push({ script, args }), `1${LS}2${LS}\x1f3${LS}\n`)).trashDrafts([{ ref: "1", line: "[hub-draft thread=a]" }, { ref: "2", line: "[hub-draft thread=a]" }, { ref: "3", line: "[Reforms draft, run 0a1b2c" }]);
    expect(calls[0]?.args).toEqual(["1", "[hub-draft thread=a]", "2", "[hub-draft thread=a]", "3", "[Reforms draft, run 0a1b2c"]);
    expect(r).toEqual({ moved: ["1", "2"], refused: ["3"] });
    expect(parseTrashOutput("\x1f")).toEqual({ moved: [], refused: [] });
    expect(await mailAppMailer(async () => { throw new Error("never called"); }).trashDrafts([])).toEqual({ moved: [], refused: [] });
  });

  it("bareId normalises angle brackets and case", () => {
    expect(bareId(" <AbC@x> ")).toBe("abc@x");
    expect(bareId(null)).toBe("");
  });
});

describe("FakeMailer", () => {
  it("records sends and drops the draft", async () => {
    const f = new FakeMailer([{ ref: "1", messageId: null, account: null, sender: null, to: ["a@x"], cc: [], bcc: [], subject: "S", body: "B", attachments: 0 }]);
    expect(await f.findDrafts({ mailRef: null, subject: "S" })).toHaveLength(1);
    await f.send(f.drafts[0]!);
    expect(f.sent).toHaveLength(1);
    expect(f.drafts).toEqual([]);
  });
});
