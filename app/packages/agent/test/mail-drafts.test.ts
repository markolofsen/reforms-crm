import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { parseProjectMd } from "@hub/projects";
import { DENIED_TOOLS } from "../src/deny";
import { FakeDraftWriter, FIND_INBOUND_SCRIPT, mailAppDraftWriter, MESSAGE_ID_SCRIPT, parseInboundOutput, parseWriteOutput, probeOf, reviseDraft, stripMarker, versionHash, WRITE_REPLY_SCRIPT, type OsaRun } from "../src/mail-drafts";
import { createHubMcpServer, type HubMcpEnv } from "../src/mcp";

// The hub's draft writer (P52): the script's contract, its parser and the `draft_write` tool, on a fake Mail. No test touches Mail.

const FS = "\x1f";
const LS = "\x1d";

describe("the Mail script", () => {
  it("never sends, opens no window, activates nothing, pastes nothing, and writes no hub line (decision 0031)", () => {
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/\bsend\b/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/reply src opening window false/);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/activate|keystroke|System Events|clipboard/i);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/hub-draft|marker/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/set content of r to \(theBody & tail\)/);
  });

  it("finds its draft as the one new draft of the account whose In-Reply-To is the thread; two new: nothing replaced", () => {
    expect(WRITE_REPLY_SCRIPT).toMatch(/set before to my threadDrafts\(subj, accName, thread, \{\}\)/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/first header of m whose name is "In-Reply-To"/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/if acc is accName and irt contains thread then/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/if \(count of fresh\) > 1 then return "error" & FS & "ambiguous"/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/does not contain probe then/);
  });

  it("deletes only after the new draft is found, and only the named versions, re-checked by account and Message-ID", () => {
    const save = WRITE_REPLY_SCRIPT.indexOf("save r");
    const found = WRITE_REPLY_SCRIPT.indexOf('if (count of fresh) is 0 then return "error"');
    const del = WRITE_REPLY_SCRIPT.indexOf("            delete m");
    expect(save).toBeGreaterThan(0);
    expect(found).toBeGreaterThan(save);
    expect(del).toBeGreaterThan(found);
    expect(WRITE_REPLY_SCRIPT).toMatch(/messages of drafts mailbox whose message id is tid/);
    expect(WRITE_REPLY_SCRIPT).toMatch(/\(name of account of mailbox of m\) is accName and \(message id of m\) is tid then/);
    expect(WRITE_REPLY_SCRIPT).not.toMatch(/whose subject is subj\)\s*\n\s*delete/);
  });

  it("parses ok and error answers: the new Message-ID and the text read back; the replaced ids are unique", () => {
    expect(parseWriteOutput(["ok", "139679", "Re: Hello", "<abc@x>", "Desk <d@x.com>", `A1@x${LS}A1@x${LS}`, "", "<NEW@x>", "Hi Ann"].join(FS) + "\n")).toEqual({ draftId: 139679, messageId: "NEW@x", text: "Hi Ann", subject: "Re: Hello", thread: "abc@x", from: "Desk <d@x.com>", replaced: ["A1@x"], left: [] });
    expect(parseWriteOutput(["ok", "9", "Re: X", "a@b", "d", "", `B8@x${LS}`, "n@x", "t"].join(FS)).left).toEqual(["B8@x"]);
    expect(() => parseWriteOutput(["ok", "9", "Re: X", "a@b", "d", "", "", "", "t"].join(FS))).toThrow(/no Message-ID/);
    expect(() => parseWriteOutput(["error", "ambiguous", "nothing was replaced"].join(FS))).toThrow(/nothing was replaced/);
    expect(() => parseWriteOutput("garbage")).toThrow(/Mail answered/);
  });

  it("finds the answered message by Message-ID, read-only: INBOX of each account first, never Drafts, Sent or Trash", async () => {
    expect(FIND_INBOUND_SCRIPT).not.toMatch(/\b(send|delete|save|reply|activate)\b/);
    expect(FIND_INBOUND_SCRIPT.indexOf('mailbox "INBOX" of acc')).toBeLessThan(FIND_INBOUND_SCRIPT.indexOf("mailboxes of acc"));
    expect(FIND_INBOUND_SCRIPT).toMatch(/"Drafts", "Sent"/);
    expect(MESSAGE_ID_SCRIPT).not.toMatch(/\b(send|delete|save|reply|activate)\b/);
    expect(parseInboundOutput(["ok", "hello@x", "INBOX", "138994"].join(FS) + "\n")).toEqual({ account: "hello@x", mailboxPath: ["INBOX"], messageId: 138994 });
    expect(parseInboundOutput("none\n")).toBeNull();
    expect(() => parseInboundOutput(["error", "mail_not_running", "Mail is not running"].join(FS))).toThrow(/not running/);
    const seen: string[][] = [];
    const osa: OsaRun = async (_s, a) => (seen.push(a), "none");
    expect(await mailAppDraftWriter(osa).findInbound(["a", "b"], "<Abc@x>")).toBeNull();
    expect(seen[0]).toEqual(["Abc@x", "a", "b"]);
  });

  it("drops a marker line an agent wrote itself, passes the probe and the versions to replace, and refuses an empty body", async () => {
    expect(stripMarker("[hub-draft thread=a@b]\nHi Ann,\n\nThanks.\n")).toBe("Hi Ann,\n\nThanks.");
    const seen: string[][] = [];
    const osa: OsaRun = async (_s, args) => {
      seen.push(args);
      return ["ok", "5", "Re: X", "a@b", "d@x", "", "", "n5@x", "Hi"].join(FS);
    };
    await mailAppDraftWriter(osa).writeReply({ account: "desk", mailboxPath: ["INBOX", "Clients"], messageId: 7, body: "[hub-draft thread=a@b]\nHi", sender: null, replace: ["Old1@x", "old2@x"] });
    expect(seen[0]).toEqual(["desk", `INBOX${LS}Clients`, "7", "Hi", "", "add", "Hi", `Old1@x${LS}old2@x`]);
    await expect(mailAppDraftWriter(osa).writeReply({ account: "desk", mailboxPath: ["INBOX"], messageId: 7, body: "[hub-draft thread=a@b]\n  ", sender: null })).rejects.toThrow(/no text/);
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
  const projectMail = () => ({ accounts: one.mail.accounts, sender: one.mail.sender, identity: { addresses: one.mail.addresses, domains: one.mail.domains, signoff: one.signoff, brands: one.brands } });

  it("the forwarded mail (headers of the real one) is signed with that brand's lines; the agent's own closing is refused, never edited (P65 S2)", async () => {
    const mail = new FakeDraftWriter();
    mail.headers.set(42, readFileSync(path.join(fx, cases.forwarded.headersFile), "utf8"));
    const call = await connect(undefined, undefined, { drafts: mail, projectMail });
    const typed = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: `Hello,\n\nHere is the answer.\n\n${one.signoff}` });
    expect(typed).toMatchObject({ isError: true, json: { error: "own_signoff" } });
    expect(typed.json.message).toMatch(/"Best regards,"/);
    expect(mail.drafts).toHaveLength(0);
    const r = await call({ account, mailbox_path: ["INBOX"], message_id: 42, content: "Hello,\n\nHere is the answer." });
    expect(r).toMatchObject({ isError: false, json: { brand: cases.forwarded.brand, wroteTo: cases.forwarded.wroteTo, signature: "signed" } });
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

  it("signs in the reply's language; with no line for it, in English with the signature_language check (P60 finding 2)", async () => {
    const ru = { ...one, signoff: "en: Best regards, | ru: С уважением,", brands: one.brands.map((b) => (b.name === "Carapis" ? { ...b, signature: ["en: Carapis team | ru: Команда Carapis", "carapis.com"] } : b)) };
    const pm = (c: typeof one) => () => ({ accounts: c.mail.accounts, sender: c.mail.sender, identity: { addresses: c.mail.addresses, domains: c.mail.domains, signoff: c.signoff, brands: c.brands } });
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
    expect(JSON.parse((res.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ brand: cases.forwarded.brand, wroteTo: cases.forwarded.wroteTo, signature: "signed" });
    const viaTo = await client.callTool({ name: "mail_brand", arguments: { headers: `Delivered-To: ${account}`, to: [cases.forwarded.wroteTo] } });
    expect(JSON.parse((viaTo.content as Array<{ text: string }>)[0]!.text)).toMatchObject({ brand: cases.forwarded.brand });
  });
});
