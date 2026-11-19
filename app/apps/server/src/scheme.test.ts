import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import type { AgentToolsDto } from "@hub/contract/agent-tools";
import type { ConnectionsDto } from "@hub/contract/connections";
import { API_VERSION, type HealthDto } from "@hub/contract/health";
import type { DoctorDto, ProjectOverviewDto } from "@hub/contract/responses";
import { schemeDto, worstFirst, type SchemeDto } from "@hub/contract/scheme";
import type { AgentToolsService } from "./agent-tools";
import { createApp } from "./app";
import { composeScheme, type SchemeSources } from "./scheme";

// P63 O1: the Overview's parts from local state, with fake readers (no Mail, no Notion, no CLI). Plan section 4a's mapping.
const HEALTH: HealthDto = { ok: true, apiVersion: API_VERSION, messengers: { state: "off", failures: 0, stored: 0 }, sent: { state: "running", projects: [], failures: 0, marked: 0 }, mailer: "mail-app" };
const DOCTOR: DoctorDto = {
  state: "ok",
  checks: [
    { name: "project.md parses", outcome: "pass", detail: "ok" },
    { name: "notion databases readable", outcome: "skipped", detail: "needs Notion" },
  ],
  facts: { status: "active", accounts: ["hello@example.test"], recipients: "list", listed: 1, autosend: { mode: "draft", classes: [], dailyCap: 5 } },
};
const FILES: ProjectOverviewDto = {
  project: null,
  question: null,
  knowledge: { state: "ok", indexed: 12, approved: 12, unapproved: 0, expired: 0, noAudiences: 0, noPhrasings: 0, problems: 0, consistent: true, examples: ["pricing.md"] },
  filters: { state: "ok", rules: 3, whitelist: 4, issues: [] },
};
const CONN: ConnectionsDto = {
  instance: "x",
  connections: [
    { id: "notion:notion-token", kind: "notion", label: "Notion", secret: { state: "stored" }, identity: "Hub bot", usedBy: ["alpha"], can: ["test"], check: { state: "fresh", asOf: "2026-11-19T10:00:00Z", value: { detail: "ok", identity: "Hub bot" } } },
    { id: "telegram:bot", kind: "telegram", label: "Telegram bot", secret: { state: "missing" }, identity: null, usedBy: [], can: ["set"], check: { state: "never" } },
  ],
  mail: [{ account: "hello@example.test", foundInMail: true, usedBy: ["alpha"] }],
  mailRead: { state: "answered", fix: null },
};
const TOOLS: AgentToolsDto = {
  project: "alpha",
  unattended: false,
  defaultCli: "claude",
  capabilities: [],
  checkedAt: "2026-11-19T10:00:00Z",
  rows: [
    { id: "mcp.present.mail-mcp", cli: "claude", title: "mail-mcp configured", state: "pass", detail: "stdio", fix: null },
    { id: "mcp.answers.mail-mcp", cli: "codex", title: "mail-mcp answers", state: "fail", detail: "connection refused", fix: "hub doctor --only MCP" },
    { id: "mcp.present.hub", cli: "claude", title: "hub configured", state: "pass", detail: "stdio", fix: null },
    { id: "guard.hook", cli: "claude", title: "Guard hook", state: "pass", detail: "PreToolUse runs hub guard", fix: null },
    { id: "guard.hook", cli: "codex", title: "Guard hook", state: "skip", detail: "Codex has no hook", fix: null },
    { id: "send-tools.off", cli: "claude", title: "Send tools off", state: "pass", detail: "8 denied", fix: null },
  ],
};

const sources = (over: Partial<SchemeSources> = {}): SchemeSources => ({
  projects: async () => ["alpha"],
  doctor: async () => DOCTOR,
  files: async () => FILES,
  agentTools: () => TOOLS,
  connections: async () => CONN,
  health: () => HEALTH,
  stopped: async () => false,
  clis: () => [
    { cli: "claude", state: "ready", version: "2.1.0", detail: "signed in", fix: null },
    { cli: "codex", state: "signed-out", version: "0.50.0", detail: "not signed in", fix: "codex login" },
  ],
  core: () => null,
  ...over,
});
const byId = (d: SchemeDto, id: string) => d.nodes.find((n) => n.id === id);

describe("composeScheme", () => {
  it("P63 O5: an attached connector is a part with its account, from its own rows (out of Agent sessions); no account is never ok; only Claude Code reaches it", async () => {
    const rows = [
      ...TOOLS.rows,
      { id: "connector.present.gcal-hello", cli: "claude" as const, title: "gcal-hello configured", state: "pass" as const, detail: "Calendar", fix: null },
      { id: "connector.answers.gcal-hello", cli: "claude" as const, title: "gcal-hello answers", state: "fail" as const, detail: "HTTP 500", fix: "hub doctor --only Agent" },
      { id: "connector.present.gdrive-hello", cli: "claude" as const, title: "gdrive-hello configured", state: "pass" as const, detail: "Drive", fix: null },
    ];
    const tools: AgentToolsDto = { ...TOOLS, rows, capabilities: [{ kind: "calendar", name: "gcal-hello", account: "hello@example.test" }, { kind: "drive", name: "gdrive-hello", account: null }] };
    const d = schemeDto.parse(await composeScheme(sources({ agentTools: () => tools })));
    expect(byId(d, "alpha:calendar:gcal-hello")).toMatchObject({ kind: "calendar", label: "Calendar · hello@example.test", state: "fail", detail: "Claude Code: HTTP 500", fix: "hub doctor --only Agent", place: "agent" });
    expect(byId(d, "alpha:drive:gdrive-hello")).toMatchObject({ kind: "drive", label: "Drive · gdrive-hello", state: "unknown", detail: "Its Google account is not known yet." });
    expect(byId(d, "alpha:session")?.detail ?? "").not.toContain("HTTP 500");
    expect(d.edges).toContainEqual({ from: "cli:claude", to: "alpha:calendar:gcal-hello", kind: "flow" });
    expect(d.edges.some((e) => e.from === "cli:codex" && e.to.includes(":calendar:"))).toBe(false);
    expect(schemeDto.parse(await composeScheme(sources({ agentTools: () => null }))).nodes.some((n) => n.kind === "calendar")).toBe(false);
  });

  it("maps each source to its part: pass ok, fail broken with the row's own fix, skipped not checked, signed out a look", async () => {
    const d = schemeDto.parse(await composeScheme(sources()));
    expect(byId(d, "alpha:mail-mcp")).toMatchObject({ state: "fail", detail: "Codex: connection refused", fix: "hub doctor --only MCP", place: "agent" });
    expect(byId(d, "alpha:hub-tools")).toMatchObject({ state: "ok", detail: "", fix: null });
    expect(byId(d, "alpha:guard")).toMatchObject({ state: "unknown" }); // Codex's guard row is a skip: never green for what nobody checked
    expect(byId(d, "alpha:notion-db")).toMatchObject({ state: "unknown", place: "overview" });
    expect(byId(d, "alpha:knowledge")).toMatchObject({ state: "ok", label: "Knowledge base (12 entries)", place: "knowledge" });
    expect(byId(d, "alpha:mail-filters")).toMatchObject({ state: "ok", label: "Mail filters (3 rules)" });
    expect(byId(d, "alpha:setup")).toMatchObject({ state: "ok", detail: "1 of 1 checks pass", fix: null });
    expect(byId(d, "alpha:mailbox:hello@example.test")).toMatchObject({ state: "ok", label: "hello@example.test", place: "mail" });
    expect(byId(d, "alpha:send-door")).toMatchObject({ state: "ok", place: "sending" });
    expect(byId(d, "cli:claude")).toMatchObject({ state: "ok", label: "Claude Code 2.1.0" });
    expect(byId(d, "cli:codex")).toMatchObject({ state: "warn", fix: "codex login" });
    expect(byId(d, "notion:notion:notion-token")).toMatchObject({ state: "ok", label: "Notion (Hub bot)" });
    // A Telegram bot that was never set is not a part of this Hub.
    expect(d.nodes.some((n) => n.kind === "telegram")).toBe(false);
  });

  it("no cached Agent tools rows: their parts are not checked here, with the place to run the check", async () => {
    const d = await composeScheme(sources({ agentTools: () => null, clis: () => null }));
    for (const id of ["alpha:mail-mcp", "alpha:hub-tools", "alpha:guard", "cli:claude", "cli:codex"]) expect(byId(d, id), id).toMatchObject({ state: "unknown", detail: expect.stringContaining("Run the check on Settings ▸ Agent") });
  });

  it("the send door: fake mailer and Stop sending are a look, a failing Sent loop is broken", async () => {
    expect(byId(await composeScheme(sources({ health: () => ({ ...HEALTH, mailer: "fake" }) })), "alpha:send-door")).toMatchObject({ state: "warn", detail: "Sends are fake (demo mode)." });
    expect(byId(await composeScheme(sources({ stopped: async () => true })), "alpha:send-door")).toMatchObject({ state: "warn", detail: "Sending is stopped." });
    expect(byId(await composeScheme(sources({ health: () => ({ ...HEALTH, sent: { ...HEALTH.sent, state: "error", lastError: "Mail refused" } }) })), "alpha:send-door")).toMatchObject({ state: "fail" });
  });

  it("Mail that did not answer leaves the mailbox not checked; a failing doctor check breaks Setup; expired knowledge is a look", async () => {
    const d = await composeScheme(
      sources({
        connections: async () => ({ ...CONN, mail: [{ account: "hello@example.test", foundInMail: null, usedBy: ["alpha"] }], mailRead: { state: "not-answering", fix: "quit Mail" } }),
        doctor: async () => ({ ...DOCTOR, checks: [...DOCTOR.checks, { name: "workflows parse", outcome: "fail", detail: "1 error" }] }),
        files: async () => ({ ...FILES, knowledge: { ...FILES.knowledge, state: "ok", expired: 2 } as ProjectOverviewDto["knowledge"] }),
      }),
    );
    expect(byId(d, "alpha:mailbox:hello@example.test")).toMatchObject({ state: "unknown", fix: "quit Mail" });
    expect(byId(d, "alpha:setup")).toMatchObject({ state: "fail", detail: "Failing: workflows parse. workflows parse: 1 error", fix: "Say “настрой проект” in a session (project-setup)", place: "overview" });
    expect(byId(d, "alpha:knowledge")).toMatchObject({ state: "warn", detail: "2 expired." });
  });

  it("P70: more than three failing checks are named three and counted; test mode is not a setup problem (Sending says it)", async () => {
    const fails = ["a", "b", "c", "d", "e"].map((n) => ({ name: n, outcome: "fail" as const, detail: `${n} broke` }));
    const d = await composeScheme(sources({ doctor: async () => ({ ...DOCTOR, checks: fails }) }));
    expect(byId(d, "alpha:setup")?.detail).toBe("Failing: a, b, c and 2 more. a: a broke");
    const test = await composeScheme(sources({ doctor: async () => ({ ...DOCTOR, facts: { ...DOCTOR.facts!, recipients: "test" } }) }));
    expect(byId(test, "alpha:setup")).toMatchObject({ state: "ok" });
  });

  it("UX pass: every row no other part covers is Agent sessions (the Notion connector's sign-in among them), with its fix", async () => {
    expect(byId(await composeScheme(sources()), "alpha:session")).toMatchObject({ state: "unknown", place: "agent" });
    const notion = (cli: "claude" | "codex") => ({ id: "mcp.answers.notion", cli, title: "notion answers", state: "warn" as const, detail: "Not signed in to Notion (HTTP 401).", fix: cli === "codex" ? "codex mcp login notion" : "/mcp" });
    const rows = [...TOOLS.rows, { id: "skills.linked", cli: "claude" as const, title: "Skills linked", state: "pass" as const, detail: "13", fix: null }, notion("claude"), notion("codex")];
    const d = await composeScheme(sources({ agentTools: () => ({ ...TOOLS, rows }) }));
    expect(byId(d, "alpha:session")).toMatchObject({ state: "warn", label: "Agent sessions", detail: "Claude Code: Not signed in to Notion (HTTP 401). Codex too.", fix: "/mcp", place: "agent" });
    expect(d.edges).toContainEqual({ from: "cli:claude", to: "alpha:session", kind: "flow" });
  });

  it("UX pass: a key that passed over an hour ago still works; failed and stuck sends are a look at the send door", async () => {
    const stale = { ...CONN, connections: CONN.connections.map((c) => (c.kind === "notion" ? { ...c, check: { state: "stale" as const, asOf: "2026-11-19T08:00:00Z", value: { detail: "ok", identity: "Hub bot" } } } : c)) };
    expect(byId(await composeScheme(sources({ connections: async () => stale })), "notion:notion:notion-token")).toMatchObject({ state: "ok", detail: "Passed its last test over an hour ago." });
    expect(byId(await composeScheme(sources({ sendTrouble: async () => ({ failed: 2, stuck: 0 }) })), "alpha:send-door")).toMatchObject({ state: "warn", detail: expect.stringContaining("2 sends failed") });
    expect(byId(await composeScheme(sources({ sendTrouble: async () => ({ failed: 0, stuck: 1 }) })), "alpha:send-door")).toMatchObject({ state: "warn", detail: expect.stringContaining("1 send is stuck") });
  });

  it("the core (P68): a required update is broken with the command as its fix; current is ok", async () => {
    const core = { pin: "v0.12.16", inUse: "v0.12.16", level: "required" as const, reason: "a security fix", tags: [], facts: { dependencies: false, migrations: false, rollback: false }, command: ["hub core update"] };
    expect(byId(await composeScheme(sources({ core: () => core })), "core")).toMatchObject({ state: "fail", label: "Core v0.12.16", fix: "hub core update", place: "mac" });
    expect(byId(await composeScheme(sources({ core: () => ({ ...core, level: "current", command: [] }) })), "core")).toMatchObject({ state: "ok", fix: null });
  });

  it("edges join only parts that exist, and the order is worst first", async () => {
    const d = await composeScheme(sources());
    const ids = new Set(d.nodes.map((n) => n.id));
    expect(d.edges.length).toBeGreaterThan(0);
    for (const e of d.edges) expect(ids.has(e.from) && ids.has(e.to), `${e.from} -> ${e.to}`).toBe(true);
    expect(worstFirst(d.nodes)[0]?.state).toBe("fail");
  });
});

describe("GET /api/scheme", () => {
  let handle: DbHandle;
  let repos: Repos;
  beforeEach(() => {
    handle = openDb(":memory:");
    repos = createRepos(handle.db);
  });
  afterEach(() => handle.close());

  it("answers a strict reply and never runs the Agent tools check (it reads the cache only)", async () => {
    const get = vi.fn(async () => TOOLS);
    const refresh = vi.fn(async () => TOOLS);
    const agentTools = { get, refresh, peek: () => null, clis: () => null } satisfies AgentToolsService;
    const app = createApp(repos, { agentTools, scheme: { projects: async () => ["alpha"], doctor: async () => DOCTOR, files: async () => FILES, connections: async () => CONN } });
    const r = await app.request("http://127.0.0.1:4317/api/scheme");
    expect(r.status).toBe(200);
    const text = await r.text();
    const d = schemeDto.parse(JSON.parse(text));
    expect(byId(d, "alpha:mail-mcp")?.state).toBe("unknown");
    expect(get).not.toHaveBeenCalled();
    expect(refresh).not.toHaveBeenCalled();
    expect(text).not.toContain("/Users/");
  });
});
