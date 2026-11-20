import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { parseProjectMd } from "@hub/projects";
import { DENIED_TOOLS } from "../src/deny";
import { ACCOUNT_ADDRESSES_SCRIPT, DraftWriteError, FakeDraftWriter, READ_CONTENT_SCRIPT, FIND_INBOUND_SCRIPT, MAIL_SLOW_TEXT, mailAppDraftWriter, MESSAGE_ID_SCRIPT, OsaTimeout, parseInboundOutput, parseThreadDrafts, parseWriteOutput, probeOf, READ_HEADERS_SCRIPT, reviseDraft, THREAD_DRAFTS_SCRIPT, versionHash, WRITE_REPLY_SCRIPT, WRITE_WAIT_SECONDS, writeRecorded, type OsaRun, type WriteLog } from "../src/mail-drafts";
import { appleScriptCompileError, canCompileAppleScript, deleteOfLoopItem } from "../../../test-support/osacompile";
import { createHubMcpServer, excerptOf, type HubMcpEnv } from "../src/mcp";

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

describe("the Mail script", () => {
  it("never sends, opens no window, activates nothing, pastes nothing, and writes no hub line (decision 0031)", () => {
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/\bsend\b/);
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
    const del = WRITE_REPLY_SCRIPT.indexOf("            delete m");
    expect(save).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(save);
    expect(del).toBeGreaterThan(found);
    expect(WRITE_REPLY_SCRIPT).toMatch(/messages of drafts mailbox whose message id is tid/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/\(name of account of mailbox of m\) is tAcc and \(message id of m\) is tid then/);
    // Extras are only drafts that appeared during this run (not in priorIds) and hold its text's start or Mail's own shell.
    expect(WRITE_REPLY_SCRIPT).toMatch(/repeat with x in \(mine & shells\)/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/else if shellText is not "" and t is shellText then/);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/whose subject is subj\)\s*\n\s*delete/);
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

  it("finds the answered message by Message-ID, read-only: INBOX of each account first, never Drafts, Sent or Trash", async () => {
    expect(FIND_INBOUND_SCRIPT).not.toMatch(/\b(send|delete|save|reply|activate)\b/);
    expect(FIND_INBOUND_SCRIPT.indexOf('mailbox "INBOX" of acc')).toBeLessThan(FIND_INBOUND_SCRIPT.indexOf("mailboxes of acc"));
    expect(FIND_INBOUND_SCRIPT).toMatch(/"Drafts", "Sent"/);
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

describe("draft_write (hub mcp)", () => {
  const args = (content: string, account = "desk@acme.example") => ({ account, mailbox_path: ["INBOX"], message_id: 42, content });

  it("writes the reply text only and records the version; a rerun is refused by the record, not by Drafts (P65 verdict 4)", async () => {
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    const call = await connect(mail);
    const first = await call(args("Hi Ann, first."));
    expect(first).toMatchObject({ isError: false, json: { thread: "m42@example.com", replaced: [], sent: false } });
    expect(first.json.text).toBeUndefined();
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, first."]);
    const [v] = await repos.mailVersions.ofThread("acme", "<M42@example.com>");
    expect(v).toMatchObject({ draftId: null, account: "desk@acme.example", messageId: first.json.messageId, mailId: first.json.draftId, source: "agent", trashedAt: null });
    expect(v?.hash).toMatch(/^[0-9a-f]{64}$/);
    expect(first.json.next).toMatch(/"mailRef":"m42@example.com".*\| \.\/run\.sh record-draft --project acme` \(JSON on stdin/);
    // Written, not yet recorded: a rerun is refused and says to record it.
    expect(await call(args("Hi Ann, again."))).toMatchObject({ isError: true, json: { error: "already_drafted" } });
    // Recorded: the version becomes the draft's, and a rerun names the draft to revise.
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: message 42", mailRef: first.json.thread, reason: "asked", skill: "triage-mail" });
    expect((await repos.mailVersions.ofDraft(rec.draftId)).map((x) => x.id)).toEqual([v?.id]);
    const again = await call(args("Hi Ann, again."));
    expect(again).toMatchObject({ isError: true, json: { error: "already_drafted" } });
    expect(again.json.message).toMatch(new RegExp(`revise it with draft=${rec.draftId}`));
    await repos.drafts.setStatus(rec.draftId, "done");
    expect((await call(args("Hi Ann, again."))).json.message).toMatch(/\(done\) already answered this message: a rerun does not bring it back/);
    expect(mail.drafts).toHaveLength(1);
  });

  it("refuses an account outside the project, and refuses without a writer", async () => {
    expect(await (await connect(new FakeDraftWriter()))(args("Hi", "private@gmail.com"))).toMatchObject({ isError: true, json: { error: "not_this_project" } });
    expect(await (await connect(undefined))(args("Hi"))).toMatchObject({ isError: true, json: { error: "unavailable" } });
  });

  it("a revision names only the hub draft, replaces only the recorded version, and never a draft the owner wrote in the thread", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const other = await repos.drafts.record({ project: "beta", email: "bob@x.example", name: "Bob", subject: "Re: Hi", mailRef: "<m43@example.com>", reason: "asked", skill: "triage-mail" });
    const noRef = await repos.drafts.record({ project: "acme", email: "cy@x.example", name: "Cy", subject: "Hello", reason: "new", skill: "bulk-drafts" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    const bumped: string[] = [];
    const call = await connect(mail, (slug) => bumped.push(slug));
    const r = await call({ draft: rec.draftId, content: "Hi Ann, warmer." });
    expect(r).toMatchObject({ isError: false, json: { thread: "m42@example.com", draft: rec.draftId, sent: false, live: true, replaced: [] } });
    // The owner writes his own draft in the same thread: no record names it.
    mail.drafts.push({ id: 1, messageId: "owner-own@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "my own", quote: "keep" });
    const r2 = await call({ draft: rec.draftId, content: "Hi Ann, warmest." });
    expect(r2.json.replaced).toEqual([r.json.messageId]);
    expect(mail.drafts.map((d) => d.text).sort()).toEqual(["Hi Ann, warmest.", "my own"]);
    const versions = await repos.mailVersions.ofDraft(rec.draftId);
    expect(versions.map((v) => [v.messageId, v.trashedAt === null])).toEqual([[r2.json.messageId, true], [r.json.messageId, false]]);
    expect(bumped).toEqual(["acme", "acme"]);
    expect(await call({ draft: other.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "not_found" } });
    expect(await call({ draft: noRef.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "no_thread" } });
    expect(await call({ draft: rec.draftId, account: "desk@acme.example", content: "x" })).toMatchObject({ isError: true, json: { error: "invalid" } });
    expect(await call({ content: "x" })).toMatchObject({ isError: true, json: { error: "invalid" } });
    mail.inbound.clear();
    expect(await call({ draft: rec.draftId, content: "x" })).toMatchObject({ isError: true, json: { error: "no_message" } });
    expect(bumped).toEqual(["acme", "acme"]);
  });

  it("a failed live bump or version record never fails the write", async () => {
    const mail = new FakeDraftWriter();
    const r = await (await connect(mail, () => {
      throw new Error("SQLITE_BUSY");
    }, { recordVersion: async () => {
      throw new Error("SQLITE_BUSY");
    } }))(args("Hi Ann."));
    expect(r).toMatchObject({ isError: false, json: { live: false, sent: false } });
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
    const slow = await call({ draft: rec.draftId, content: "Hi Ann, slow." });
    expect(slow).toMatchObject({ isError: true, json: { error: "mail_slow" } });
    expect(slow.json.message).toMatch(/Do not call draft_write again/);
    expect(slow.json.message).not.toMatch(/delete|keep one/i);
    const [open] = await repos.mailWrites.ofThread("acme", "m42@example.com", rec.draftId);
    expect(open).toMatchObject({ draftId: rec.draftId, settledAt: null });
    // Mail saved it after all; the owner also keeps a draft of his own in the thread.
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, slow."]);
    mail.drafts.push({ id: 1, messageId: "owner-own@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "my own words", quote: "keep" });
    const next = await call({ draft: rec.draftId, content: "Hi Ann, again." });
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
    const first = await call({ draft: rec.draftId, content: "Hi Ann, the poem." });
    mail.drafts.push({ id: 2, messageId: "dup@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "Hi Ann, the poem.", quote: "add" });
    const second = await call({ draft: rec.draftId, content: "Hi Ann, sarcasm." });
    expect(new Set(second.json.replaced)).toEqual(new Set([first.json.messageId, "dup@x"]));
    expect(mail.drafts.map((d) => d.text)).toEqual(["Hi Ann, sarcasm."]);
    // A new reply whose write is still landing: the late save is adopted and the agent is told to record it, not to write again.
    mail.slowNext = true;
    const nr = { account: "desk@acme.example", mailbox_path: ["INBOX"], message_id: 43, content: "Hi Bob." };
    expect(await call(nr)).toMatchObject({ isError: true, json: { error: "mail_slow" } });
    const again = await call(nr);
    expect(again).toMatchObject({ isError: true, json: { error: "already_drafted" } });
    expect(again.json.message).toMatch(/record it with hub record-draft/);
    expect(mail.drafts.filter((d) => d.text === "Hi Bob.")).toHaveLength(1);
  });

  it("Mail's empty reply in the thread (saas 139835: the original under one attribution line) is adopted and replaced; read-only otherwise", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail" });
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account: "desk@acme.example", mailboxPath: ["INBOX"], messageId: 42 });
    mail.contents.set(42, "How are you? Its new request\n\n-- \nRegards!\n\n\n");
    const call = await connect(mail, undefined, { withRepos: (fn) => fn(repos) });
    await call({ draft: rec.draftId, content: "Hi Ann." });
    mail.drafts.push({ id: 3, messageId: "shell@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "\n\nOn 14 Nov 2026, at 14:26, Ann <ann@x.example> wrote:\nHow are you? Its new request\n\n-- \nRegards!\n\n\n\n", quote: "add" });
    mail.drafts.push({ id: 4, messageId: "own@x", account: "desk@acme.example", thread: "m42@example.com", subject: "Re: message 42", text: "On Monday I will call.\nHow are you? Its new request", quote: "add" });
    const r = await call({ draft: rec.draftId, content: "Hi Ann, again." });
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
    const typed = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: `Hello,\n\nHere is the answer.\n\n${one.signoff}` });
    expect(typed).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    expect(typed.json.message).toMatch(/"Best regards,"/);
    expect(mail.drafts).toHaveLength(0);
    const r = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Hello,\n\nHere is the answer." });
    expect(r).toMatchObject({ isError: false, json: { brand: cases.forwarded.brand, clientWroteTo: cases.forwarded.wroteTo, signature: "signed" } });
    expect(mail.drafts[0]?.text).toBe(`Hello,\n\nHere is the answer.\n\n${cases.forwarded.signature.join("\n")}`);
  });

  it("refuses the ending of Sent 139821 (a Russian closing and the team's name), and a closing in any of the last four lines", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Здравствуйте, Марк!\n\nСпасибо за письмо, ответим подробно завтра.\n\nС теплом,\nкоманда Carapis" });
    expect(r).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    expect(r.json.message).toMatch(/"С теплом,"/);
    expect((await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Hi,\n\nAnswer.\n\nKind regards, Mark\nCarapis" })).json.error).toBe("own_signoff");
    expect((await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Hi,\n\nAnswer below.\n\nCarapis team" })).json.error).toBe("own_signoff");
    // A sentence that starts like a closing is the reply, not a sign-off.
    expect((await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Hi,\n\nThank you for your patience, we will answer tomorrow." })).isError).toBe(false);
  });

  it("refuses the ending of the first Hub send (send_log 1): a closing no list names, over the team's name in Russian (P65 live send check)", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Здравствуйте, Марк!\n\nВот стихотворение, как вы просили.\n\nС теплом и дружеским поклоном,\nКоманда Carapis" });
    expect(r).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    expect(r.json.message).toMatch(/"С теплом и дружеским поклоном,"/);
    expect((await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Здравствуйте!\n\nОтвет ниже.\n\nКоманда Carapis" })).json.error).toBe("own_signoff");
    expect((await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Hallo,\n\nDie Antwort.\n\nViele Grüße\nIhr Carapis Team" })).json.error).toBe("own_signoff");
    expect(mail.drafts).toHaveLength(0);
  });

  it("signs in the reply's language; with no line for it, in English with the signature_language check (P60 finding 2)", async () => {
    const ru = { ...one, signoff: "en: Best regards, | ru: С уважением,", brands: one.brands.map((b) => (b.name === "Carapis" ? { ...b, signature: ["en: Carapis team | ru: Команда Carapis", "carapis.com"] } : b)) };
    const pm = (c: typeof one) => () => ({ accounts: c.mail.accounts, sender: c.mail.sender, identity: { addresses: c.mail.addresses, domains: c.mail.domains, signoff: c.signoff, brands: c.brands, languages: c.languages } });
    const repos = createRepos(db.db);
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    mail.headers.set(43, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail: pm(ru) });
    const r = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Здравствуйте!\n\nДа, API отдаёт цены по всем рынкам." });
    expect(r).toMatchObject({ isError: false, json: { signature: "signed" } });
    expect(r.json.signatureFallback).toBeUndefined();
    expect(mail.drafts[0]?.text.split("\n").slice(-3)).toEqual(["С уважением,", "Команда Carapis", "carapis.com"]);
    const en = await call({ account, mailbox_path: ["INBOX"], message_id: 43, content: "Hello,\n\nYes, the API returns prices for every market." });
    expect(mail.drafts[1]?.text.split("\n").slice(-3)).toEqual(["Best regards,", "Carapis team", "carapis.com"]);
    expect(en.json.signatureFallback).toBeUndefined();
    // The fixture as it is: English lines only. A Russian reply falls back to English and says so.
    const plain = await (await connect(undefined, undefined, { drafts: mail, projectMail: pm({ ...one, signoff: "en: Best regards," }) }))({ account, mailbox_path: ["INBOX"], message_id: 44, content: "Здравствуйте!\n\nОтветим завтра." });
    expect(plain.json).toMatchObject({ signatureFallback: "ru" });
    expect(plain.json.next).toMatch(/signature_language/);
    const [v] = await repos.mailVersions.ofThread("acme", "m44@example.com");
    expect(v?.signatureFallback).toBe("ru");
    // The first Hub send's shape (P65 live send check): untagged English lines, `languages: en`, a Russian reply.
    const saas = { ...one, signoff: "Best regards,", languages: ["en"] };
    const untagged = await (await connect(undefined, undefined, { drafts: mail, projectMail: pm(saas) }))({ account, mailbox_path: ["INBOX"], message_id: 45, content: "Здравствуйте!\n\nОтветим завтра." });
    expect(untagged.json).toMatchObject({ signatureFallback: "ru" });
    expect(untagged.json.next).toMatch(/signature_language/);
    // Russian among `languages`: the owner's untagged lines are for it, no check.
    const both = await (await connect(undefined, undefined, { drafts: mail, projectMail: pm({ ...saas, languages: ["en", "ru"] }) }))({ account, mailbox_path: ["INBOX"], message_id: 46, content: "Здравствуйте!\n\nОтветим завтра." });
    expect(both.json.signatureFallback).toBeUndefined();
  });

  it("headers that name no brand, or cannot be read: the placeholder, and the result says so", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, "To: someone@example.org");
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const r = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Answer." });
    expect(r.json).toMatchObject({ brand: null, signature: "placeholder" });
    expect(r.json.next).toMatch(/\[Owner: signature for/);
    expect(mail.drafts[0]?.text.split("\n").at(-1)).toBe("[Owner: signature for unknown brand]");
    mail.drafts = [];
    const unread = await call({ account, mailbox_path: ["INBOX"], message_id: 7, content: "Answer." });
    expect(unread.json).toMatchObject({ signature: "placeholder", brandReason: "the message's headers could not be read" });
  });

  it("a revision is signed once and recorded in place: same draft id, brand stored, no record-draft step", async () => {
    const repos = createRepos(db.db);
    const rec = await repos.drafts.record({ project: "acme", email: "ann@x.example", name: "Ann", subject: "Re: Hello", mailRef: "<m42@example.com>", reason: "asked", skill: "triage-mail", excerpt: "old" });
    await repos.drafts.setChecked(rec.draftId, true).catch(() => undefined);
    const mail = new FakeDraftWriter();
    mail.inbound.set("m42@example.com", { account, mailboxPath: ["INBOX"], messageId: 42 });
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const recordRevision = (slug: string, id: number, r: { excerpt: string; wroteTo: string | null; brand: string | null }) => repos.drafts.revised(slug, id, r);
    const call = await connect(undefined, undefined, { drafts: mail, projectMail, recordRevision });
    const first = await call({ draft: rec.draftId, content: "Warmer answer." });
    expect(first.json).toMatchObject({ recorded: true, draft: rec.draftId, brand: cases.forwarded.brand });
    expect(first.json.next).toMatch(/Do not run record-draft/);
    expect(await call({ draft: rec.draftId, content: `Warmer answer.\n\n${cases.forwarded.signature.join("\n")}` })).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    const second = await call({ draft: rec.draftId, content: "Warmer answer." });
    expect(second.json.recorded).toBe(true);
    expect(mail.drafts).toHaveLength(1);
    expect(mail.drafts[0]?.text.match(new RegExp(cases.forwarded.signature.at(-1)!.replace(/\./g, "\\."), "g"))).toHaveLength(1);
    const row = await repos.drafts.get(rec.draftId);
    expect(row).toMatchObject({ id: rec.draftId, body: "Warmer answer.", brand: cases.forwarded.brand, wroteTo: cases.forwarded.wroteTo, checked: false, status: "ready" });
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
    const r = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Hello,\n\nHere is the answer." });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ fromSeenByClient: account, clientWroteTo: "info@carapis.com", fromReason: null });
    expect(r.json).not.toHaveProperty("from");
    expect(r.json).not.toHaveProperty("wroteTo");
    expect(r.json.next).not.toMatch(/The client sees From/);
    expect(mail.drafts[0]?.from).toBe(account);
    mail.addresses.set(account, [account, "info@carapis.com"]);
    const s = await call({ account, mailbox_path: ["INBOX"], message_id: 43, content: "Hello,\n\nHere is the answer." });
    expect(s.json).toMatchObject({ fromSeenByClient: "info@carapis.com", clientWroteTo: "info@carapis.com", fromReason: null });
    expect(mail.drafts[1]?.from).toBe("info@carapis.com");
  });

  it("realty: a revision of mail received in dan@ is written from dan@ and saved there, though mail.sender is info@ (realty drafts 1 and 2)", async () => {
    const mail = new FakeDraftWriter();
    mail.inbound.set("ref-dan@x", { account: "dan@danmerriam.com", mailboxPath: ["INBOX"], messageId: 9 });
    const r = await reviseDraft(mail, { accounts: ["info@caribbeanrealestatemls.com", "dan@danmerriam.com"], sender: "info@caribbeanrealestatemls.com", clientWroteTo: "dan@danmerriam.com", mailRef: "ref-dan@x", body: "Hi,\n\nYes.", quote: "keep", versions: [{ account: "info@caribbeanrealestatemls.com", messageId: "old@x" }] });
    expect(mail.drafts[0]).toMatchObject({ from: "dan@danmerriam.com", account: "dan@danmerriam.com" });
    expect(r).toMatchObject({ from: "dan@danmerriam.com", account: "dan@danmerriam.com", fromReason: null, clientWroteTo: "dan@danmerriam.com" });
  });
});
