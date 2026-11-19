import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { DENIED_TOOLS } from "../src/deny";
import { FakeDraftWriter, FIND_INBOUND_SCRIPT, mailAppDraftWriter, parseInboundOutput, parseWriteOutput, reviseDraft, stripMarker, WRITE_REPLY_SCRIPT, type OsaRun } from "../src/mail-drafts";
import { createHubMcpServer } from "../src/mcp";

// The hub's draft writer (P52): the script's contract, its parser and the `draft_write` tool, on a fake Mail. No test touches Mail.

const FS = "\x1f";
const LS = "\x1d";

describe("the Mail script", () => {
  it("never sends, opens no window, activates nothing, pastes nothing", () => {
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/\bsend\b/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/reply src opening window false/);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/activate|keystroke|System Events|clipboard/i);
  });

  it("deletes only after the new draft is found, and only drafts of the same subject, account and marker", () => {
    const save = WRITE_REPLY_SCRIPT.indexOf("save r");
    const found = WRITE_REPLY_SCRIPT.indexOf('if newId is 0 then return "error"');
    const del = WRITE_REPLY_SCRIPT.indexOf("delete (first message of drafts mailbox");
    expect(save).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(save);
    expect(del).toBeGreaterThan(found);
    expect(WRITE_REPLY_SCRIPT).toMatch(/acc is accName and \(\(content of m\) as text\) contains marker/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/messages of drafts mailbox whose subject is subj/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/\(deleted status of m\) is false/);
  });

  it("parses ok and error answers; the replaced ids are unique", () => {
    expect(parseWriteOutput(["ok", "139679", "Re: Hello", "<abc@x>", "Desk <d@x.com>", `139677${LS}139677${LS}`, ""].join(FS) + "\n")).toEqual({ draftId: 139679, subject: "Re: Hello", thread: "abc@x", from: "Desk <d@x.com>", replaced: [139677], left: [] });
    expect(parseWriteOutput(["ok", "9", "Re: X", "a@b", "d", "", `8${LS}`].join(FS)).left).toEqual([8]);
    expect(() => parseWriteOutput(["error", "not_saved", "nothing was replaced"].join(FS))).toThrow(/nothing was replaced/);
    expect(() => parseWriteOutput("garbage")).toThrow(/Mail answered/);
  });

  it("finds the answered message by Message-ID, read-only: INBOX of each account first, never Drafts, Sent or Trash", async () => {
    expect(FIND_INBOUND_SCRIPT).not.toMatch(/\b(send|delete|save|reply|activate)\b/);
    expect(FIND_INBOUND_SCRIPT.indexOf('mailbox "INBOX" of acc')).toBeLessThan(FIND_INBOUND_SCRIPT.indexOf("mailboxes of acc"));
    expect(FIND_INBOUND_SCRIPT).toMatch(/"Drafts", "Sent"/);
    expect(parseInboundOutput(["ok", "hello@x", "INBOX", "138994"].join(FS) + "\n")).toEqual({ account: "hello@x", mailboxPath: ["INBOX"], messageId: 138994 });
    expect(parseInboundOutput("none\n")).toBeNull();
    expect(() => parseInboundOutput(["error", "mail_not_running", "Mail is not running"].join(FS))).toThrow(/not running/);
    const seen: string[][] = [];
    const osa: OsaRun = async (_s, a) => (seen.push(a), "none");
    expect(await mailAppDraftWriter(osa).findInbound(["a", "b"], "<Abc@x>")).toBeNull();
    expect(seen[0]).toEqual(["Abc@x", "a", "b"]);
  });

  it("drops a marker line the agent wrote itself and refuses an empty body", async () => {
    expect(stripMarker("[hub-draft thread=a@b]\nHi Ann,\n\nThanks.\n")).toBe("Hi Ann,\n\nThanks.");
    const seen: string[][] = [];
    const osa: OsaRun = async (_s, args) => {
      seen.push(args);
      return ["ok", "5", "Re: X", "a@b", "d@x", ""].join(FS);
    };
    await mailAppDraftWriter(osa).writeReply({ account: "desk", mailboxPath: ["INBOX", "Clients"], messageId: 7, body: "[hub-draft thread=a@b]\nHi", sender: null });
    expect(seen[0]).toEqual(["desk", `INBOX${LS}Clients`, "7", "Hi", "", "add"]);
    await expect(mailAppDraftWriter(osa).writeReply({ account: "desk", mailboxPath: ["INBOX"], messageId: 7, body: "[hub-draft thread=a@b]\n  ", sender: null })).rejects.toThrow(/no text/);
  });
});

describe("a person's text, verbatim (P56)", () => {
  it("keep writes the marker and the text only; add appends the quote of the original", () => {
    expect(WRITE_REPLY_SCRIPT).toMatch(/if \(count of argv\) > 5 then set addQuote to \(item 6 of argv\) is not "keep"/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/set wanted to marker & linefeed & theBody & tail/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/if addQuote then set tail to/);
  });

  it("reviseDraft finds the answered message in the project's accounts and writes through the one writer", async () => {
    const w = new FakeDraftWriter(() => "in@x");
    w.inbound.set("in@x", { account: "desk", mailboxPath: ["INBOX"], messageId: 7 });
    const r = await reviseDraft(w, { accounts: ["desk"], sender: null, mailRef: "<IN@x>".toLowerCase(), body: "Hi Ann,\n\n> kept quote", quote: "keep" });
    expect(r).toMatchObject({ replyTo: 7, thread: "in@x" });
    expect(w.drafts[0]).toMatchObject({ text: "[hub-draft thread=in@x]\nHi Ann,\n\n> kept quote", quote: "keep" });
    await reviseDraft(w, { accounts: ["desk"], sender: null, mailRef: "in@x", body: "v2", quote: "add" });
    expect(w.drafts).toHaveLength(1);
    expect(w.drafts[0]).toMatchObject({ text: "[hub-draft thread=in@x]\nv2", quote: "add" });
    await expect(reviseDraft(w, { accounts: ["other"], sender: null, mailRef: "in@x", body: "x", quote: "keep" })).rejects.toMatchObject({ code: "no_message" });
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

async function connect(writer: FakeDraftWriter | undefined, mailWritten?: (slug: string) => void) {
  const server = createHubMcpServer(createRepos(db.db), {
    hubProject: "acme",
    focusFile: path.join(dir, "focus.json"),
    ...(writer ? { drafts: writer, projectMail: () => ({ accounts: ["desk@acme.example"], sender: null }) } : {}),
    ...(mailWritten ? { mailWritten } : {}),
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

describe("draft_write (hub mcp)", () => {
  const args = (content: string, account = "desk@acme.example") => ({ account, mailbox_path: ["INBOX"], message_id: 42, content });

  it("writes, then a revision replaces the older hub draft: one version stays, nothing sent", async () => {
    const mail = new FakeDraftWriter();
    const call = await connect(mail);
    const first = await call(args("Hi Ann, first."));
    expect(first).toMatchObject({ isError: false, json: { thread: "m42@example.com", replaced: [], sent: false } });
    const second = await call(args("Hi Ann, revised."));
    expect(second.json.replaced).toEqual([first.json.draftId]);
    expect(mail.drafts.map((d) => d.text)).toEqual(["[hub-draft thread=m42@example.com]\nHi Ann, revised."]);
    expect(second.json.next).toMatch(/`hub record-draft --project acme` \(skill triage-mail step 5\) with "mailRef":"m42@example.com"/);
  });

  it("refuses an account outside the project, and refuses without a writer", async () => {
    expect(await (await connect(new FakeDraftWriter()))(args("Hi", "private@gmail.com"))).toMatchObject({ isError: true, json: { error: "not_this_project" } });
    expect(await (await connect(undefined))(args("Hi"))).toMatchObject({ isError: true, json: { error: "unavailable" } });
  });

  it("a revision names only the hub draft: the hub finds the answered message and tells the admin (P53)", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const other = await repos.drafts.record({ project: "beta", email: "bob@x.example", name: "Bob", subject: "Re: Hi", mailRef: "<m43@example.com>", reason: "asked", skill: "triage-mail" });
    const noRef = await repos.drafts.record({ project: "acme", email: "cy@x.example", name: "Cy", subject: "Hello", reason: "new", skill: "bulk-drafts" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    const bumped: string[] = [];
    const call = await connect(mail, (slug) => bumped.push(slug));
    const r = await call({ draft: rec.draftId, content: "Hi Ann, warmer." });
    expect(r).toMatchObject({ isError: false, json: { thread: "m42@example.com", draft: rec.draftId, sent: false, live: true } });
    expect(mail.drafts.map((d) => d.text)).toEqual(["[hub-draft thread=m42@example.com]\nHi Ann, warmer."]);
    expect(bumped).toEqual(["acme"]);
    expect(await call({ draft: other.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "not_found" } });
    expect(await call({ draft: noRef.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "no_thread" } });
    expect(await call({ draft: rec.draftId, account: "desk@acme.example", content: "x" })).toMatchObject({ isError: true, json: { error: "invalid" } });
    expect(await call({ content: "x" })).toMatchObject({ isError: true, json: { error: "invalid" } });
    mail.inbound.clear();
    expect(await call({ draft: rec.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "no_message" } });
    expect(bumped).toEqual(["acme"]);
  });

  it("a failed live bump never fails the write", async () => {
    const mail = new FakeDraftWriter();
    const r = await (await connect(mail, () => {
      throw new Error("SQLITE_BUSY");
    }))(args("Hi Ann."));
    expect(r).toMatchObject({ isError: false, json: { live: false, sent: false } });
    expect(mail.drafts).toHaveLength(1);
  });

  it("mail-mcp's create_reply is denied: the hub writes every draft", () => {
    expect(DENIED_TOOLS).toContain("mcp__mail-mcp__create_reply");
  });
});
