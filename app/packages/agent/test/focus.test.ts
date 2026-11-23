import { existsSync, mkdtempSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { FOCUS_LINE_MAX, REF_KINDS, type FocusItem } from "@hub/contract/focus";
import { createRepos, openDb, openDbReadOnly, type DbHandle, type Repos } from "@hub/db";
import { SEND_LIKE_TOOL } from "../src/deny";
import { focusLine, livePointer, readFocus, RESOLVERS, thisOf } from "../src/focus";
import { createHubMcpServer, HUB_MCP_TOOLS } from "../src/mcp/server";
import type { NotionScope } from "../src/notion-scope";

// The shared focus reader, its resolvers per ref kind, the pointer and the hub MCP server (P51 F1, F2; P72), on a throwaway
// database: no CLI, no Mail.

let dir: string;
let file: string;
let pointerFile: string;
let rw: DbHandle;
let ro: DbHandle;
let repos: Repos;
const NOW = new Date("2026-11-18T10:00:30Z");
const ids = { mark: 0, ann: 0, other: 0, markClient: 0, run: 0, otherRun: 0, chat: 0, otherChat: 0, mdraft: 0, otherMdraft: 0, inbound: 0, annInbound: 0, otherInbound: 0 };
const CSV = "knowledge/files/csv-export-1a2b.md";
const CSV_TITLE = "Can I download everything in a single request or as a CSV file?";

const doc = (p: string, title: string) => ({ path: p, title, use: "STATE" as const, approved: true, audiences: ["client"], body: "Yes: /export.csv", phrasings: "", frontMatter: {}, contentHash: p });

beforeEach(async () => {
  dir = mkdtempSync(path.join(tmpdir(), "hub-focus-reader-"));
  file = path.join(dir, "focus.json");
  pointerFile = path.join(dir, "pointer.json");
  rw = openDb(path.join(dir, "app.db"));
  const w = createRepos(rw.db);
  await w.projects.replaceRegistry({ projects: [{ slug: "acme", name: "Acme Travel", status: "active", settingsJson: "{}", hash: "a" }, { slug: "beta", name: "Beta Secret", status: "active", settingsJson: "{}", hash: "b" }], addresses: [] });
  await w.knowledge.upsert("acme", doc(CSV, CSV_TITLE));
  await w.knowledge.upsert("beta", doc("knowledge/files/beta-only.md", "Beta only entry"));
  // P98: a client's message in Mail ▸ Inbox (`inbound:`), one in each project; stored before the drafts so every row is open to read its id; Ann's draft (below) answers hers.
  await w.inboundMail.store([
    { project: "acme", account: "hello@acme.example", mailbox: "INBOX", messageId: "<in1@example.com>", email: "mark@example.com", name: "Mark Effect", subject: "Re: Wow", receivedAt: "2099-01-01T00:00:00.000Z", read: false, why: "thread", preview: "Are you there?" },
    { project: "acme", account: "hello@acme.example", mailbox: "INBOX", messageId: "<M2@example.com>", email: "ann@example.com", name: "Ann", subject: "Price", receivedAt: "2020-01-01T00:00:00.000Z", read: true, why: "client", preview: "How much?" },
    { project: "beta", account: "hello@beta.example", mailbox: "INBOX", messageId: "<in3@example.com>", email: "zed@example.com", name: "Zed Secret", subject: "Beta only", receivedAt: "2099-01-01T00:00:00.000Z", read: false, why: "client", preview: "secret" },
  ]);
  const inRows = (await w.inboundMail.open("acme")).concat(await w.inboundMail.open("beta"));
  ids.inbound = inRows.find((r) => r.email === "mark@example.com")?.id ?? 0;
  ids.annInbound = inRows.find((r) => r.email === "ann@example.com")?.id ?? 0;
  ids.otherInbound = inRows.find((r) => r.email === "zed@example.com")?.id ?? 0;
  const m = await w.drafts.record({ project: "acme", email: "mark@example.com", name: "Mark Effect", subject: `Re: Hello ${"x".repeat(200)}`, mailRef: "<m1@example.com>", excerpt: "I'm well" });
  ids.mark = m.draftId;
  ids.markClient = (await w.drafts.get(m.draftId))?.clientId ?? 0;
  ids.ann = (await w.drafts.record({ project: "acme", email: "ann@example.com", name: "Ann", subject: "Re: Price", mailRef: "<m2@example.com>" })).draftId;
  ids.other = (await w.drafts.record({ project: "beta", email: "zed@example.com", name: "Zed Secret", subject: "Re: Beta only", mailRef: "<m3@example.com>" })).draftId;
  ids.run = await w.runs.start({ project: "acme", startedAt: "2026-11-18T09:00:00Z", trigger: "owner", skill: "triage-mail" });
  ids.otherRun = await w.runs.start({ project: "beta", startedAt: "2026-11-18T09:00:00Z", trigger: "owner", skill: "triage-mail" });
  // P71 M3: a linked chat and its draft in each project (the `chat:` and `mdraft:` refs).
  await w.messengers.allowChat("acme", "telegram_user", "4242", "Mark");
  await w.messengers.addIdentifier("acme", ids.markClient, "telegram", "4242");
  ids.chat = (await w.messengers.chat("acme", "telegram_user", "4242"))?.id ?? 0;
  ids.mdraft = (await w.messengers.createDraft({ project: "acme", channel: "telegram_user", chatId: "4242", text: "See you Tuesday", createdBy: "agent", clientId: ids.markClient })).id;
  await w.messengers.allowChat("beta", "telegram_user", "777", "Zed");
  ids.otherChat = (await w.messengers.chat("beta", "telegram_user", "777"))?.id ?? 0;
  ids.otherMdraft = (await w.messengers.createDraft({ project: "beta", channel: "telegram_user", chatId: "777", text: "Beta secret", createdBy: "agent" })).id;
  ro = openDbReadOnly(path.join(dir, "app.db"));
  repos = createRepos(ro.db);
});
afterEach(() => {
  ro.close();
  rw.close();
  rmSync(dir, { recursive: true, force: true });
});

const put = (focus: Record<string, unknown>, at = "2026-11-18T10:00:00.000Z", schema = 2) =>
  writeFileSync(file, JSON.stringify({ schema, at, focus: { tab: "t1", project: "acme", route: "knowledge.page", title: "Knowledge", selected: [], visible: true, ...focus } }));
const read = (slug = "acme", now = NOW, depth: "line" | "full" = "full") => readFocus({ file, slug, repos, now, depth });

describe("readFocus", () => {
  it("Knowledge with a pointed row: its title, its status and the tool that reads it; the line names it", async () => {
    put({ pointed: `knowledge:${CSV}`, window: { refs: [`knowledge:${CSV}`], total: 57 }, view: { q: "csv" } });
    const f = await read();
    expect(f).toMatchObject({ state: "fresh", ageSeconds: 30, route: "knowledge.page", title: "Knowledge", subject: null, view: { q: "csv" } });
    expect(f.pointed).toEqual({ ref: `knowledge:${CSV}`, kind: "knowledge", title: CSV_TITLE, status: "approved", read: { server: "knowledge-mcp", tool: "knowledge_get", args: { project: "acme", path: CSV } } });
    expect(f.window).toMatchObject({ total: 57, more: 0, items: [{ title: CSV_TITLE }] });
    const line = focusLine(await read("acme", NOW, "line")) ?? "";
    expect(line).toMatch(/^\[Hub focus, data\] this knowledge:knowledge\/files\/csv-export-1a2b\.md · Knowledge · on knowledge:knowledge\/files\/csv-export-1a2b\.md "Can I download everything in a single request or as a CSV file\?" approved \(knowledge_get\) · 1 of 57 on screen · search "csv" · 30 s ago \(call the hub focus tool for detail\)$/);
  });

  it("a draft subject names its client and subject, cut to 120; the hook resolves the subject and counts the selection", async () => {
    put({ route: "drafts.item", title: `Draft ${ids.mark}`, subject: `draft:${ids.mark}`, selected: [`draft:${ids.mark}`, `draft:${ids.ann}`] });
    const f = await read();
    expect(f.subject).toMatchObject({ ref: `draft:${ids.mark}`, status: "ready", read: { server: "hub", tool: "draft_show", args: { draft: ids.mark } } });
    expect(f.subject?.title).toMatch(/^Mark Effect <mark@example.com> · Re: Hello x+…$/);
    expect(f.subject?.title.length).toBeLessThanOrEqual(120);
    expect(f.selected.map((s) => s.ref)).toEqual([`draft:${ids.mark}`, `draft:${ids.ann}`]);
    const hook = await read("acme", NOW, "line");
    expect(hook).toMatchObject({ selected: [], selectedMore: 2 });
    expect(focusLine(hook)).toMatch(new RegExp(`^\\[Hub focus, data\\] this draft:${ids.mark} · Draft ${ids.mark} · open draft:${ids.mark} "Mark Effect <mark@example.com> · Re: Hello x+…" ready \\(draft_show\\) · 2 selected · 30 s ago`));
  });

  it("every kind resolves inside the bound project and drops another project's id", async () => {
    const own = { draft: String(ids.mark), client: String(ids.markClient), run: String(ids.run), knowledge: CSV, project: "acme", chat: String(ids.chat), mdraft: String(ids.mdraft), inbound: String(ids.inbound) };
    const foreign = { draft: String(ids.other), client: "999", run: String(ids.otherRun), knowledge: "knowledge/files/beta-only.md", project: "beta", chat: String(ids.otherChat), mdraft: String(ids.otherMdraft), inbound: String(ids.otherInbound) };
    const ctx = { repos, slug: "acme", today: "2026-11-18" };
    for (const kind of REF_KINDS) {
      expect(await RESOLVERS[kind](ctx, own[kind]), kind).not.toBeNull();
      expect(await RESOLVERS[kind](ctx, foreign[kind]), kind).toBeNull();
    }
    put({ route: "log.list", title: "Activity", subject: `run:${ids.run}` });
    expect((await read()).subject).toMatchObject({ ref: `run:${ids.run}`, kind: "run", status: "ok", title: expect.stringMatching(new RegExp(`^run ${ids.run} · triage-mail`)) });
  });

  it("a chat and a messenger draft name the client and the channel, and read with messenger_history (P71 M3)", async () => {
    const ctx = { repos, slug: "acme", today: "2026-11-18" };
    expect(await RESOLVERS.chat(ctx, String(ids.chat))).toEqual({ title: "Mark Effect · Telegram", status: "Draft replies", read: { server: "hub", tool: "messenger_history", args: { channel: "telegram_user", chat_id: "4242" } } });
    expect(await RESOLVERS.mdraft(ctx, String(ids.mdraft))).toMatchObject({ title: "Mark Effect · Telegram draft · See you Tuesday", status: "draft" });
  });

  it("P98: a client's message names who, what and when, waits or names its draft, and reads with inbound_show", async () => {
    const ctx = { repos, slug: "acme", today: "2026-11-18" };
    expect(await RESOLVERS.inbound(ctx, String(ids.inbound))).toEqual({ title: "Mark Effect <mark@example.com> · Re: Wow · received 2099-01-01T00:00:00.000Z", status: "waiting for a reply", read: { server: "hub", tool: "inbound_show", args: { inbound: ids.inbound } } });
    // Ann's draft names this message as its mailRef (in Mail's own case): the message is answered by it.
    expect(await RESOLVERS.inbound(ctx, String(ids.annInbound))).toMatchObject({ status: `answered by draft ${ids.ann} (ready)` });
    put({ route: "mail.inbound", title: "Mail", subject: `inbound:${ids.inbound}` });
    expect((await read()).subject).toMatchObject({ ref: `inbound:${ids.inbound}`, kind: "inbound", title: expect.stringContaining("Re: Wow") });
  });

  it("P129 verdict 8: \"this\" is the subject, else the pointed row, else the one selected, else the one on screen", () => {
    const it_ = (ref: string): FocusItem => ({ ref, kind: "draft", title: ref, status: null, read: null });
    const [a, b, c] = [it_("draft:1"), it_("draft:2"), it_("draft:3")];
    const win = (items: FocusItem[], total = items.length, more = 0) => ({ items, total, more });
    const none = { subject: null, pointed: null, selected: [], selectedMore: 0, window: null };
    const table: Array<[string, Parameters<typeof thisOf>[0], string | null, string | null]> = [
      ["subject wins over all", { subject: a, pointed: b, selected: [c], selectedMore: 0, window: win([c]) }, "draft:1", "subject"],
      ["pointed when no subject", { ...none, pointed: b, selected: [c], window: win([a, c]) }, "draft:2", "pointed"],
      ["the one selected row", { ...none, selected: [c], window: win([a, b, c]) }, "draft:3", "selected"],
      ["two selected: none", { ...none, selected: [a, b], window: win([a, b]) }, null, null],
      ["one selected listed, more not resolved: none", { ...none, selected: [a], selectedMore: 1 }, null, null],
      ["the one row on screen", { ...none, window: win([a]) }, "draft:1", "window"],
      ["one listed of several on screen: none", { ...none, window: win([a], 3) }, null, null],
      ["nothing", none, null, null],
    ];
    for (const [name, parts, ref, from] of table) {
      const t = thisOf(parts);
      expect(t.this?.ref ?? null, name).toBe(ref);
      expect(t.thisFrom, name).toBe(from);
    }
  });

  it("readFocus returns this and thisFrom; the hook line starts with it", async () => {
    put({ pointed: `knowledge:${CSV}`, window: { refs: [`knowledge:${CSV}`], total: 57 } });
    expect(await read()).toMatchObject({ this: { ref: `knowledge:${CSV}` }, thisFrom: "pointed" });
    put({ window: { refs: [`knowledge:${CSV}`, `draft:${ids.mark}`], total: 2 } });
    const f = await read();
    expect(f).toMatchObject({ this: null, thisFrom: null });
    expect(focusLine(f)).toMatch(/^\[Hub focus, data\] this: none · /);
  });

  it("a resolver exists for every ref kind (a kind added without one fails here)", () => {
    expect(Object.keys(RESOLVERS).sort()).toEqual([...REF_KINDS].sort());
  });

  it("refs of another project, or deleted, drop out of the subject, the selection and the window", async () => {
    put({ subject: `draft:${ids.other}`, selected: [`draft:${ids.ann}`, `draft:${ids.other}`, "draft:9999"], window: { refs: ["knowledge:knowledge/files/beta-only.md", `knowledge:${CSV}`], total: 2 } });
    const f = await read();
    expect(f.subject).toBeNull();
    expect(f.selected.map((s) => s.ref)).toEqual([`draft:${ids.ann}`]);
    expect(f.selectedMore).toBe(2);
    expect(f.window).toMatchObject({ items: [{ ref: `knowledge:${CSV}` }], more: 1 });
    expect(JSON.stringify(f)).not.toMatch(/Zed|Beta only/);
  });

  it("stale by age (over 10 minutes) and by a hidden tab: no line", async () => {
    put({ pointed: `knowledge:${CSV}` });
    const old = await read("acme", new Date("2026-11-18T10:11:00Z"));
    expect(old.state).toBe("stale");
    expect(focusLine(old)).toBeNull();
    put({ visible: false });
    expect((await read()).state).toBe("stale");
  });

  it("elsewhere names nothing of the other project", async () => {
    put({ project: "beta", subject: `draft:${ids.other}` });
    const f = await read();
    expect(f).toMatchObject({ state: "elsewhere", subject: null, pointed: null, selected: [] });
    expect(JSON.stringify(f)).not.toMatch(/Zed|Beta only|beta/);
    expect(focusLine(f)).toMatch(/another project/);
  });

  it("none: no file, a broken file, a schema 1 file (no reader for it), no bound project", async () => {
    expect((await read()).state).toBe("none");
    writeFileSync(file, "{not json");
    expect((await read()).state).toBe("none");
    writeFileSync(file, JSON.stringify({ schema: 1, at: "2026-11-18T10:00:00.000Z", focus: { tab: "t1", project: "acme", screen: "draft", draftId: ids.mark, selected: [], visible: true } }));
    expect((await read()).state).toBe("none");
    put({});
    expect((await readFocus({ file, slug: undefined, repos, now: NOW })).state).toBe("none");
  });

  it("the line is at most 400 characters", async () => {
    put({ pointed: `knowledge:${CSV}`, subject: `draft:${ids.mark}`, view: { q: "q".repeat(200), filter: "attention" }, selected: Array.from({ length: 200 }, (_, i) => `draft:${i + 1}`) });
    const line = focusLine(await read("acme", NOW, "line")) ?? "";
    expect(line.length).toBeLessThanOrEqual(FOCUS_LINE_MAX);
    expect(line).toMatch(/\(call the hub focus tool for detail\)$/);
  });
});

async function connect(hubProject: string | undefined, o: { pointer?: boolean; bumps?: string[]; notion?: NotionScope; links?: Array<{ group: string; label: string; target: string; under: string | null; answered: string; by: "owner" | "default" | "agent" }> } = {}) {
  const notion = o.notion;
  const links = o.links;
  const server = createHubMcpServer(repos, { hubProject, focusFile: file, now: () => NOW, ...(notion ? { projectNotion: () => notion } : {}), ...(links ? { projectLinks: () => links } : {}), ...(o.pointer === false ? {} : { pointerFile, pointerWritten: (s: string) => void o.bumps?.push(s) }) });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown> = {}) => {
    const res = await client.callTool({ name, arguments: args });
    const text = (res.content as Array<{ text: string }>)[0]?.text ?? "";
    // A refusal by the input schema (more than 5 refs) is the SDK's plain text, not the tools' JSON.
    const json = (() => {
      try {
        return JSON.parse(text) as Record<string, any>;
      } catch {
        return { error: "invalid_input", message: text };
      }
    })();
    return { isError: res.isError === true, json };
  };
  return { client, call };
}

describe("hub mcp", () => {
  it("project_notion returns the bound project's databases by id, the same parse as the capabilities line (P82)", async () => {
    const notion: NotionScope = { slug: "acme", databases: [{ role: "clients", dataSourceId: "00000000-0000-4000-8000-000000000001" }], teamspace: "Acme", teamspaceId: null, parentPage: null };
    const { call } = await connect("acme", { notion });
    const r = await call("project_notion");
    expect(r.json).toMatchObject({ project: "acme", teamspace: null, databases: [{ role: "clients", url: "collection://00000000-0000-4000-8000-000000000001" }] });
    expect((await (await connect("acme")).call("project_notion")).json).toMatchObject({ error: "unavailable" });
  });
  it("P101: project_links returns declared destinations without granting a write or open capability", async () => {
    const { call } = await connect("acme", { links: [{ group: "CRM", label: "Clients", target: "notion:clients", under: null, answered: "2026-11-22", by: "owner" }] });
    expect(await call("project_links")).toMatchObject({ isError: false, json: { project: "acme", links: [{ group: "CRM", label: "Clients", target: "notion:clients", under: null, by: "owner" }] } });
    expect((await (await connect("acme")).call("project_links")).json.error).toBe("unavailable");
  });
  it("P98: inbound_show gives from, subject, when, the Message-ID and the reply call; another project's message is refused", async () => {
    const { call } = await connect("acme");
    const r = await call("inbound_show", { inbound: ids.inbound });
    expect(r.isError).toBe(false);
    expect(r.json).toMatchObject({ id: ids.inbound, from: { name: "Mark Effect", email: "mark@example.com" }, subject: "Re: Wow", receivedAt: "2099-01-01T00:00:00.000Z", messageIdHeader: "in1@example.com", open: true, answer: null });
    const ann = await call("inbound_show", { inbound: ids.annInbound });
    expect(ann.json).toMatchObject({ answer: { id: ids.ann, status: "ready" }, reply: { note: expect.stringContaining(`draft_write { kind: "revise", draft: ${ids.ann} }`) } });
    expect(await call("inbound_show", { inbound: ids.otherInbound })).toMatchObject({ isError: true, json: { error: "not_found" } });
  });

  it("lists exactly the thirteen tools: nine read-only (including project_links), highlight the pointer, draft_write the one Mail write, client_record the record of a client without a draft, messenger_draft_write the one messenger write; none send-like", async () => {
    const { client } = await connect("acme");
    const tools = (await client.listTools()).tools;
    expect(tools.map((t) => t.name).sort()).toEqual([...HUB_MCP_TOOLS].sort());
    expect(HUB_MCP_TOOLS).toHaveLength(13);
    expect(tools.filter((t) => t.annotations?.readOnlyHint !== true).map((t) => t.name).sort()).toEqual(["client_record", "draft_write", "highlight", "messenger_draft_write"]);
    expect(tools.filter((t) => SEND_LIKE_TOOL.test(t.name))).toEqual([]);
  });

  it("focus and draft_show: the draft without a body field; another project's draft is refused", async () => {
    put({ route: "drafts.item", title: "Draft", subject: `draft:${ids.mark}` });
    const { call } = await connect("acme");
    expect((await call("focus")).json).toMatchObject({ state: "fresh", subject: { ref: `draft:${ids.mark}` } });
    const d = await call("draft_show", { draft: ids.mark });
    expect(d.isError).toBe(false);
    expect(d.json).toMatchObject({ id: ids.mark, mailRef: "<m1@example.com>", to: "mark@example.com", excerpt: "I'm well", client: { email: "mark@example.com" } });
    expect(d.json.body).toMatch(/^In Mail, not here/);
    expect(d.json.activity.length).toBeGreaterThan(0);
    const other = await call("draft_show", { draft: ids.other });
    expect(other).toMatchObject({ isError: true, json: { error: "not_found" } });
  });

  it("client_show by id and by email, drafts_list for a view; unbound refuses", async () => {
    const { call } = await connect("acme");
    const byEmail = await call("client_show", { email: "ann@example.com" });
    expect(byEmail.json).toMatchObject({ name: "Ann", drafts: [{ id: ids.ann, status: "ready" }] });
    const byId = await call("client_show", { id: byEmail.json.id });
    expect(byId.json.email).toBe("ann@example.com");
    expect((await call("client_show", { email: "zed@example.com" })).isError).toBe(true);
    const list = await call("drafts_list", { view: "ready" });
    expect(list.json.drafts.map((r: { id: number }) => r.id).sort()).toEqual([ids.mark, ids.ann].sort());
    const unbound = await connect(undefined);
    expect((await unbound.call("focus")).json.error).toBe("unbound");
  });

  it("highlight writes refs only (mode 600), bumps the live topic, and a new one replaces the old; [] clears", async () => {
    put({ pointed: `knowledge:${CSV}` });
    const bumps: string[] = [];
    const { call } = await connect("acme", { bumps });
    const r = await call("highlight", { refs: [`knowledge:${CSV}`], note: "this one" });
    expect(r).toMatchObject({ isError: false, json: { refs: [`knowledge:${CSV}`], expiresInSeconds: 30, live: true } });
    expect(bumps).toEqual(["acme"]);
    expect(statSync(pointerFile).mode & 0o777).toBe(0o600);
    expect(readFileSync(pointerFile, "utf8")).not.toMatch(/Can I download/);
    expect(livePointer(pointerFile, NOW)).toMatchObject({ project: "acme", refs: [`knowledge:${CSV}`], note: "this one" });
    expect(livePointer(pointerFile, new Date(NOW.getTime() + 31_000))).toBeNull();
    await call("highlight", { refs: [] });
    expect(livePointer(pointerFile, NOW)).toBeNull();
  });

  it("highlight refuses more than 5 refs, another project's ref, a stale focus, and without a pointer file", async () => {
    put({});
    const { call } = await connect("acme");
    expect((await call("highlight", { refs: Array.from({ length: 6 }, () => `knowledge:${CSV}`) })).isError).toBe(true);
    expect((await call("highlight", { refs: ["knowledge:knowledge/files/beta-only.md"] })).json.error).toBe("unknown_ref");
    expect((await call("highlight", { refs: [`draft:${ids.other}`] })).json.error).toBe("unknown_ref");
    put({}, "2026-11-18T09:00:00.000Z");
    expect((await call("highlight", { refs: [`knowledge:${CSV}`] })).json.error).toBe("not_looking");
    expect(existsSync(pointerFile)).toBe(false);
    put({});
    expect((await (await connect("acme", { pointer: false })).call("highlight", { refs: [`knowledge:${CSV}`] })).json.error).toBe("unavailable");
  });

  it("the database handle is read-only: a write throws", async () => {
    await expect(repos.drafts.setStatus(ids.mark, "hold")).rejects.toThrow(/readonly/i);
  });
});
