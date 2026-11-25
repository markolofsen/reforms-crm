import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths, type HubPaths } from "@hub/config/paths";
import { readProject } from "@hub/projects/parse";
import { connectorRows } from "../src/connector-checks";
import { connectorViolations, primaryCalendarOf, recordConnectorRead, type ConnectorScope } from "../src/connector-guard";
import { connectorDeniedTools, connectorKindOf, KINDS, readConnectorAccounts, resolveConnectors, sessionCapabilities, writeConnectorAccount, type AttachedConnector } from "../src/connectors";

// P62: the connector registry, the resolver, the deny list, the guard's rules, the capabilities line and the rows.

const CAL = KINDS.calendar.url;
const DRIVE = KINDS.drive.url;

function instance(servers: Record<string, unknown>, projects: Record<string, string> = {}): HubPaths {
  const home = mkdtempSync(path.join(tmpdir(), "hub-conn-"));
  for (const d of ["projects", "data", "state", "config"]) mkdirSync(path.join(home, d));
  writeFileSync(path.join(home, ".mcp.json"), JSON.stringify({ mcpServers: { "mail-mcp": { type: "http", url: "http://localhost:8787" }, ...servers } }));
  for (const [slug, rows] of Object.entries(projects)) {
    mkdirSync(path.join(home, "projects", slug));
    writeFileSync(path.join(home, "projects", slug, "project.md"), md(slug, rows));
  }
  return hubPaths({ home, env: {} });
}

const md = (slug: string, rows: string, kind = "generic") =>
  `# ${slug}\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 1 | 2026-11-20 | agent |\n| kind | ${kind} | 2026-11-20 | owner |\n| mail.accounts | a@${slug}.example | 2026-11-20 | owner |\n${rows}`;
const row = (f: string, v: string) => `| ${f} | ${v} | 2026-11-20 | owner |\n`;
const cfgOf = (slug: string, rows: string, kind = "generic") => readProject(md(slug, rows, kind), slug).config;

const spec = (url: string) => ({ type: "http", url, oauth: { clientId: "1-x.apps.googleusercontent.com" } });

describe("names and kinds", () => {
  it("a hub name says its kind; anything else is no connector", () => {
    expect(connectorKindOf("gcal-hello")).toBe("calendar");
    expect(connectorKindOf("gdrive-bt")).toBe("drive");
    for (const n of ["notion", "gcal", "gcal-", "gmail-x", "GCAL-x", "claude_ai_Google_Calendar"]) expect(connectorKindOf(n)).toBeNull();
  });
  it("every tool is either allowed or denied, and the denied ones are the writes of section 2", () => {
    const denied = connectorDeniedTools([{ name: "gcal-a", kind: "calendar" }, { name: "gdrive-b", kind: "drive" }]).map((t) => t.split("__").pop());
    expect(denied.sort()).toEqual(["copy_file", "create_file", "create_shared_drive", "delete_event", "respond_to_event", "share_file", "trash_file", "update_file", "update_shared_drive"].sort());
    for (const k of Object.values(KINDS)) for (const t of k.allowed) expect(k.tools).toContain(t);
  });
});

describe("resolveConnectors: a project gets only what its project.md lists", () => {
  const paths = instance({ "gcal-hello": spec(CAL), "gdrive-bt": spec(DRIVE), "gcal-other": spec(CAL), "gcal-fake": spec("https://evil.example/mcp") });
  it("attaches the listed connectors, never an unlisted one", () => {
    const r = resolveConnectors(paths, cfgOf("realty", row("calendar.connector", "gcal-hello") + row("drive.connector", "gdrive-bt")));
    expect(r.attached.map((c) => c.name)).toEqual(["gcal-hello", "gdrive-bt"]);
    expect(r.problems).toEqual([]);
  });
  it("says why a listed connector is not used: missing, wrong endpoint, no calendar module", () => {
    const r = resolveConnectors(paths, cfgOf("x", row("calendar.connector", "gcal-missing, gcal-fake")));
    expect(r.attached).toEqual([]);
    expect(r.problems.map((p) => p.why)).toEqual(["not in the instance's MCP config", expect.stringMatching(/not Google's Calendar endpoint/)]);
    const support = resolveConnectors(paths, cfgOf("s", row("calendar.connector", "gcal-hello") + row("drive.connector", "gdrive-bt"), "software-support"));
    expect(support.attached.map((c) => c.name)).toEqual(["gdrive-bt"]);
    expect(support.problems[0]?.why).toMatch(/no calendar module/);
  });
  it("a calendar connector on a kind without calendar is a parse warning", () => {
    const p = readProject(md("s", row("calendar.connector", "gcal-hello"), "software-support"), "s");
    expect(p.issues.some((i) => i.field === "calendar.connector" && i.severity === "warning")).toBe(true);
  });
  it("a name of the wrong kind in a field is refused by the parser", () => {
    expect(() => readProject(md("x", row("calendar.connector", "gdrive-bt")), "x")).toThrow(/gcal-<label>/);
  });
});

const att = (name: string, kind: "calendar" | "drive", account: string | null = null): AttachedConnector => ({ name, kind, spec: {}, account: account ? { account, how: "session", at: "2026-11-20T00:00:00Z" } : null });
const scope = (o: Partial<ConnectorScope> = {}): ConnectorScope => ({ attached: [att("gcal-hello", "calendar", "hello@reforms.ai"), att("gdrive-bt", "drive")], calendarId: null, driveFolders: [], ...o });

describe("the guard's connector rules", () => {
  it.each(["delete_event", "respond_to_event", "made_up_tool"])("calendar %s is refused", (t) => {
    expect(connectorViolations(`mcp__gcal-hello__${t}`, {}, scope())).toHaveLength(1);
  });
  it.each(["copy_file", "create_file", "share_file", "trash_file", "update_file", "create_shared_drive"])("drive %s is refused", (t) => {
    expect(connectorViolations(`mcp__gdrive-bt__${t}`, {}, scope())[0]).toMatch(/not on the Drive allowlist/);
  });
  it("reads pass; a connector the project does not attach is refused", () => {
    expect(connectorViolations("mcp__gcal-hello__list_events", { calendarId: "primary" }, scope())).toEqual([]);
    expect(connectorViolations("mcp__gdrive-bt__get_file_metadata", { fileId: "x" }, scope())).toEqual([]);
    expect(connectorViolations("mcp__gcal-other__list_events", {}, scope())[0]).toMatch(/not a connector of this project/);
    expect(connectorViolations("mcp__notion__notion-search", {}, scope())).toEqual([]);
  });
  it("a hold with no guests passes; a guest, a Meet link or a notification is refused", () => {
    const hold = { summary: "Follow-up: Dan [hub-event project=realty]", startTime: "2026-11-24T10:00:00Z", endTime: "2026-11-24T10:30:00Z" };
    expect(connectorViolations("mcp__gcal-hello__create_event", hold, scope())).toEqual([]);
    expect(connectorViolations("mcp__gcal-hello__create_event", { ...hold, notificationLevel: "NONE", attendees: [] }, scope())).toEqual([]);
    expect(connectorViolations("mcp__gcal-hello__create_event", { ...hold, attendees: [{ email: "dan@client.example" }] }, scope())[0]).toMatch(/no guests/);
    expect(connectorViolations("mcp__gcal-hello__update_event", { eventId: "e1", attendeeEmails: ["dan@client.example"] }, scope())).toHaveLength(1);
    expect(connectorViolations("mcp__gcal-hello__create_event", { ...hold, addGoogleMeetUrl: true }, scope())).toHaveLength(1);
    expect(connectorViolations("mcp__gcal-hello__create_event", { ...hold, notificationLevel: "ALL" }, scope())[0]).toMatch(/sends no mail/);
  });
  it("holds go to calendar.id, else the primary calendar", () => {
    const hold = { summary: "x", startTime: "a", endTime: "b" };
    expect(connectorViolations("mcp__gcal-hello__create_event", { ...hold, calendarId: "hello@reforms.ai" }, scope())).toEqual([]);
    expect(connectorViolations("mcp__gcal-hello__create_event", { ...hold, calendarId: "family@group.calendar.google.com" }, scope())[0]).toMatch(/holds go to/);
    const team = scope({ calendarId: "team@group.calendar.google.com" });
    expect(connectorViolations("mcp__gcal-hello__create_event", { ...hold, calendarId: "team@group.calendar.google.com" }, team)).toEqual([]);
    expect(connectorViolations("mcp__gcal-hello__create_event", hold, team)[0]).toMatch(/team@group/);
  });
  it("drive.folder: a search must name one of the folders", () => {
    const s = scope({ driveFolders: ["1AbCdEfGhIjKlMn"] });
    expect(connectorViolations("mcp__gdrive-bt__search_files", { query: "'1AbCdEfGhIjKlMn' in parents and name contains 'Dan'" }, s)).toEqual([]);
    expect(connectorViolations("mcp__gdrive-bt__search_files", { query: "name contains 'Dan'" }, s)[0]).toMatch(/drive.folder/);
  });
});

describe("the account a session reads", () => {
  it("finds the primary calendar in a text block or an object", () => {
    expect(primaryCalendarOf([{ type: "text", text: JSON.stringify({ calendars: [{ id: "x@group.calendar.google.com" }, { id: "hello@reforms.ai", primary: true }] }) }])).toBe("hello@reforms.ai");
    expect(primaryCalendarOf({ items: [{ id: "a@b.c", primary: true }] })).toBe("a@b.c");
    expect(primaryCalendarOf("no json")).toBeNull();
  });
  it("records it for an attached calendar connector only", () => {
    const paths = instance({});
    const resp = { content: [{ type: "text", text: JSON.stringify({ items: [{ id: "Hello@reforms.ai", primary: true }] }) }] };
    expect(recordConnectorRead(paths, [att("gcal-hello", "calendar")], "mcp__gcal-hello__list_calendars", resp)).toBe("Hello@reforms.ai");
    expect(readConnectorAccounts(paths)["gcal-hello"]).toMatchObject({ account: "hello@reforms.ai", how: "session" });
    recordConnectorRead(paths, [], "mcp__gcal-other__list_calendars", resp);
    expect(readConnectorAccounts(paths)["gcal-other"]).toBeUndefined();
  });
});

describe("the capabilities line", () => {
  it("names exactly the attached connectors, per CLI", () => {
    const l = sessionCapabilities("realty", [att("gcal-hello", "calendar", "hello@reforms.ai"), att("gdrive-bt", "drive")], "claude");
    expect(l).toContain("calendar: gcal-hello (hello@reforms.ai)");
    expect(l).toContain("drive: gdrive-bt (account not confirmed yet)");
    expect(l).toContain("@docs/core/26-capabilities.md");
    expect(sessionCapabilities("realty", [], "claude")).toContain("calendar: none attached");
    expect(sessionCapabilities("realty", [att("gcal-hello", "calendar")], "codex")).toMatch(/not in Codex sessions/);
  });
  it("P159: tells both CLIs that ssh, scp and rsync work, and Claude how to call them so they leave the sandbox", () => {
    const c = sessionCapabilities("realty", [], "claude");
    expect(c).toContain("ssh: `ssh`, `scp` and `rsync` over ssh reach any host with the owner's own ~/.ssh");
    expect(c).toContain("start the Bash call with the command itself");
    const x = sessionCapabilities("realty", [], "codex");
    expect(x).toContain("ssh: `ssh`, `scp` and `rsync` over ssh reach any host");
    expect(x).not.toContain("Bash call");
    for (const l of [c, x]) expect(l).toContain("Never print or copy a key");
  });
  it("names the owner's own browser, to use by default, and the send door, for both CLIs (decision 0040 as amended; owner 2026-11-26)", () => {
    for (const cli of ["claude", "codex"] as const) {
      const l = sessionCapabilities("realty", [], cli);
      expect(l).toContain("browser: the owner's own browser, as he set it up");
      expect(l).toContain("use it by default to study any site");
      expect(l).toContain("fall back to fetch");
      expect(l).toContain("Never submit a lead form");
      expect(l).toContain("mail and messenger messages go only through the hub's drafts and its send door");
      expect(l).not.toMatch(/playwright|read only, no|no purchases/i);
    }
    // Claude Code names its extension's tools (`--chrome`); Codex's are not named (never read from a Codex session).
    expect(sessionCapabilities("realty", [], "claude")).toContain("`mcp__claude-in-chrome__*`; if they are deferred, load them in one ToolSearch call");
    expect(sessionCapabilities("realty", [], "codex")).not.toContain("mcp__");
  });
});

describe("the Agent tools rows", () => {
  it("an attached connector: present, answers (Google's 401 is an answer), account to read, writes off; an unattached one is info", async () => {
    const paths = instance({ "gcal-hello": spec(CAL), "gdrive-spare": spec(DRIVE) }, { realty: row("calendar.connector", "gcal-hello") });
    const deny = connectorDeniedTools([{ name: "gcal-hello", kind: "calendar" }]);
    const claudeJson = path.join(paths.home, "claude.json");
    writeFileSync(claudeJson, JSON.stringify({ claudeAiMcpEverConnected: ["claude.ai Google Calendar", "claude.ai Semrush"] }));
    const rows = await connectorRows({ paths, slug: "realty", cli: "claude", mcpServers: { "gcal-hello": spec(CAL) }, deny, answer: async () => ({ ok: false, tools: [], detail: "HTTP 401" }), claudeJson });
    const by = Object.fromEntries(rows.map((r) => [r.id, r]));
    expect(by["connector.present.gcal-hello"]?.state).toBe("pass");
    expect(by["connector.answers.gcal-hello"]?.state).toBe("pass");
    expect(by["connector.account.gcal-hello"]).toMatchObject({ state: "warn", fix: "/mcp" });
    expect(by["connector.tools-off.gcal-hello"]?.state).toBe("pass");
    expect(by["connector.unattached.gdrive-spare"]?.state).toBe("skip");
    expect(by["connector.claude-ai"]?.detail).toMatch(/^Google Calendar:/);
    writeConnectorAccount(paths, "gcal-hello", "hello@reforms.ai", "stated");
    const again = await connectorRows({ paths, slug: "realty", cli: "claude", mcpServers: {}, deny: [], answer: async () => ({ ok: true, tools: ["list_events", "delete_event"], detail: "" }), claudeJson });
    const b2 = Object.fromEntries(again.map((r) => [r.id, r]));
    expect(b2["connector.present.gcal-hello"]?.state).toBe("fail");
    expect(b2["connector.account.gcal-hello"]?.detail).toMatch(/hello@reforms.ai, stated by you/);
    expect(b2["connector.tools-off.gcal-hello"]?.detail).toMatch(/delete_event/);
  });
  it("Codex: the connector is named and skipped", async () => {
    const paths = instance({ "gcal-hello": spec(CAL) }, { realty: row("calendar.connector", "gcal-hello") });
    const rows = await connectorRows({ paths, slug: "realty", cli: "codex", mcpServers: {}, deny: [], answer: async () => ({ ok: true, tools: [], detail: "" }) });
    expect(rows.map((r) => [r.id, r.state])).toEqual([["connector.codex.gcal-hello", "skip"]]);
    expect(readFileSync(path.join(paths.home, ".mcp.json"), "utf8")).toContain("gcal-hello");
  });
});
