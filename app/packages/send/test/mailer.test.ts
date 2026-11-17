import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bareId, FakeMailer, FIND_SCRIPT, mailAppMailer, parseFindOutput, SEND_SCRIPT } from "../src/mailer.js";

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
  });

  it("send hands the draft's exact fields to one script; a non-ok answer throws", async () => {
    const calls: Array<{ script: string; args: string[] }> = [];
    const d = { ref: "501", messageId: "d1@x", account: "a", sender: "Acme <o@acme.example>", to: ["a@x.example"], cc: ["c@x.example"], bcc: [], subject: "S", body: "B\n\"q\"", attachments: 0 };
    await mailAppMailer(async (script, args) => (calls.push({ script, args }), "ok")).send(d);
    expect(calls).toEqual([{ script: SEND_SCRIPT, args: ["Acme <o@acme.example>", "S", "B\n\"q\"", "a@x.example", "c@x.example", "", "501"] }]);
    await expect(mailAppMailer(async () => "nope").send(d)).rejects.toThrow(/Mail answered/);
    await expect(mailAppMailer(async () => { throw new Error("Mail got an error"); }).send(d)).rejects.toThrow(/Mail got an error/);
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
