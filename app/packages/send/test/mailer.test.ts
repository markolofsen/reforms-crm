import { describe, expect, it } from "vitest";
import { execFileSync } from "node:child_process";
import { mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { bareId, FakeMailer, FIND_SCRIPT, mailAppMailer, parseFindOutput, parseThreadOutput, SEND_SCRIPT, THREAD_SCRIPT, threadSubject } from "../src/mailer.js";

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

describe("Mail.app thread read (P27 M2.3)", () => {
  const row = (f: string[]) => f.join(FS) + RS;
  const long = "word ".repeat(100);

  it("parses a fixture: newest first, limited, excerpt folded to 200 characters, a broken record dropped", () => {
    const out = [
      row(["in", "2026-11-05T09:00:00", "Marta <marta@example.net>", "Re: Terms", "Hello,\n\nCan we meet?"]),
      row(["out", "2026-11-06T10:30:00", "Acme <owner@acme.example>", "Re: Terms", long]),
      row(["in", "2026-11-04T08:00:00", "Marta <marta@example.net>", "Terms", "First"]),
      row(["sideways", "2026-11-07T08:00:00", "x", "x", "x"]),
      row(["in", "not a date", "x", "x", "x"]),
      "half a record",
    ].join("\n");
    const rows = parseThreadOutput(out, 2);
    expect(rows.map((r) => [r.at, r.direction])).toEqual([["2026-11-06T10:30:00", "out"], ["2026-11-05T09:00:00", "in"]]);
    expect(rows[1]?.excerpt).toBe("Hello, Can we meet?");
    expect(rows[0]?.excerpt.length).toBeLessThanOrEqual(200);
    expect(parseThreadOutput("", 5)).toEqual([]);
  });

  it("thread passes the subject without Re:, the address and the cap as arguments, never inside the script", async () => {
    const calls: Array<{ script: string; args: string[] }> = [];
    const m = mailAppMailer(async (script, args) => (calls.push({ script, args }), ""));
    expect(await m.thread({ mailRef: "<d1@x>", subject: 'RE: Fwd: He said "hi"', address: " Marta@Example.net " }, 5)).toEqual([]);
    expect(calls).toEqual([{ script: THREAD_SCRIPT, args: ['He said "hi"', "marta@example.net", "60"] }]);
  });

  it("the script only reads: it never makes, deletes, moves or sends", () => {
    expect(THREAD_SCRIPT).not.toMatch(/\b(send|delete|move|make new|set (read|flagged|junk)|reply|forward)\b/i);
  });

  it("threadSubject strips every Re:/Fwd: prefix and nothing else", () => {
    expect(threadSubject("Re: RE: Fwd: AW: Terms re: the deal")).toBe("Terms re: the deal");
    expect(threadSubject("  Terms ")).toBe("Terms");
  });

  it.skipIf(process.platform !== "darwin")("the script compiles with osacompile (nothing runs, Mail is not read)", () => {
    const dir = mkdtempSync(join(tmpdir(), "hub-osa-"));
    writeFileSync(join(dir, "thread.applescript"), THREAD_SCRIPT);
    execFileSync("osacompile", ["-o", join(dir, "thread.scpt"), join(dir, "thread.applescript")], { timeout: 30_000 });
  });

  it("FakeMailer answers the same call from its messages, and can fail once", async () => {
    const f = new FakeMailer();
    f.messages = [
      { address: "a@x", at: "2026-11-01T09:00:00", who: "A", direction: "in", subject: "Terms", excerpt: "one" },
      { address: "a@x", at: "2026-11-02T09:00:00", who: "Us", direction: "out", subject: "Re: Terms", excerpt: "two" },
      { address: "b@x", at: "2026-11-03T09:00:00", who: "B", direction: "in", subject: "Terms", excerpt: "three" },
    ];
    expect((await f.thread({ mailRef: null, subject: "Re: Terms", address: "A@x" }, 5)).map((m) => m.excerpt)).toEqual(["two", "one"]);
    f.failThread = "Mail is closed";
    await expect(f.thread({ mailRef: null, subject: "Terms", address: "a@x" }, 5)).rejects.toThrow(/closed/);
    expect(await f.thread({ mailRef: null, subject: "Terms", address: "a@x" }, 1)).toHaveLength(1);
  });
});
