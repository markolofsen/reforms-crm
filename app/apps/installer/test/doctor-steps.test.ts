// Doctor steps added by P39 B: notion.access, telegram.getme, server.health, mcp.hub (mcp.knowledge until P129 A4), backup.*.
// No live call anywhere: fetch and the process runner are fakes; git works on throw-away local repositories.
import { execFileSync } from "node:child_process";
import { chmodSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import type { Ctx } from "../src/context";
import { STEPS } from "../src/steps/index";
import { fake, type Call } from "./helpers";

const step = (id: string) => STEPS.find((s) => s.id === id)!;
const ID = "00000000-0000-4000-8000-000000000001";
const TG = "123456789:AAH_telegram-secret-value-0123456789";
const NOTION = "ntn_doctorstepstoken0123456789";
const row = (k: string, v: string) => `| ${k} | ${v} | 2026-11-15 | owner |`;
const projectMd = (slug: string, extra: string[] = []) => ["# " + slug, "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", row("schema", "1"), row("status", "active"), row("mail.accounts", "owner@example.com"), row("notion.teamspace", "Acme teamspace"), ...extra, "", "## Notion databases", "", `- clients: ${ID}`, ""].join("\n");
const addProject = (f: ReturnType<typeof fake>, slug = "acme", extra: string[] = []) => {
  const dir = path.join(f.ctx.paths.projects, slug);
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "project.md"), projectMd(slug, extra));
  return dir;
};
const put = (dir: string, name: string, body: string, mode = 0o600) => {
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, name), body);
  chmodSync(path.join(dir, name), mode);
};
const respond = (status: number, body: unknown = {}) => (async () => new Response(JSON.stringify(body), { status })) as unknown as typeof fetch;

describe("the new steps are in the list and explain themselves", () => {
  it("every id exists exactly once, with a fix guide", () => {
    for (const id of ["notion.access", "telegram.getme", "server.health", "mcp.hub", "backup.git", "backup.db", "backup.snapshot", "backup.notion", "backup.secrets"]) {
      expect(STEPS.filter((s) => s.id === id), id).toHaveLength(1);
      expect(step(id).manual?.steps.length, id).toBeGreaterThan(0);
    }
  });
});

describe("notion.access", () => {
  it("passes when no project lists databases, warns when there is no token to test with", async () => {
    const f = fake();
    expect((await step("notion.access").check(f.ctx)).level).toBe("pass");
    addProject(f);
    const r = await step("notion.access").check(f.ctx);
    expect(r.level).toBe("warn");
    expect(r.detail).toContain("notion.token");
  });
  it("fails naming the database and where to share it; passes when every database is live", async () => {
    const f = fake();
    addProject(f);
    put(f.ctx.configDir, "notion-token", NOTION);
    f.ctx.fetch = respond(404);
    const bad = await step("notion.access").check(f.ctx);
    expect(bad.level).toBe("fail");
    expect(bad.detail).toContain("clients");
    expect(bad.detail).toContain("Connections");
    expect(bad.detail).not.toContain(NOTION);
    f.ctx.fetch = respond(200);
    expect((await step("notion.access").check(f.ctx)).level).toBe("pass");
    f.ctx.fetch = respond(200, { archived: true });
    expect((await step("notion.access").check(f.ctx)).detail).toContain("archived in Notion");
  });
  it("notion.token no longer reads the databases: it only proves the token is accepted", async () => {
    const f = fake();
    addProject(f);
    put(f.ctx.configDir, "notion-token", NOTION);
    const seen: string[] = [];
    f.ctx.fetch = (async (u: string) => { seen.push(u); return new Response(JSON.stringify({ name: "Hub" }), { status: 200 }); }) as unknown as typeof fetch;
    const r = await step("notion.token").check(f.ctx);
    expect(r.level).toBe("pass");
    expect(seen).toEqual(["https://api.notion.com/v1/users/me"]);
  });
});

describe("telegram.getme", () => {
  it("warns without a token file, fails on a wrong shape, never prints the token", async () => {
    const f = fake();
    expect((await step("telegram.getme").check(f.ctx)).level).toBe("warn");
    put(f.ctx.configDir, "telegram-bot-token", "not-a-token");
    expect((await step("telegram.getme").check(f.ctx)).level).toBe("fail");
  });
  it("asks getMe once: valid shows the bot's name, refused fails with the fix, unreachable warns", async () => {
    const f = fake();
    put(f.ctx.configDir, "telegram-bot-token", TG);
    const urls: string[] = [];
    f.ctx.fetch = (async (u: string) => { urls.push(u); return new Response(JSON.stringify({ ok: true, result: { username: "acme_bot" } }), { status: 200 }); }) as unknown as typeof fetch;
    const good = await step("telegram.getme").check(f.ctx);
    expect(good).toEqual({ level: "pass", detail: "bot @acme_bot" });
    expect(urls).toHaveLength(1);
    expect(urls[0]!.endsWith("/getMe")).toBe(true);
    f.ctx.fetch = respond(401);
    const refused = await step("telegram.getme").check(f.ctx);
    expect(refused.level).toBe("fail");
    expect(refused.detail).not.toContain(TG);
    f.ctx.fetch = (async () => { throw new TypeError(`fetch failed ${TG}`); }) as unknown as typeof fetch;
    const down = await step("telegram.getme").check(f.ctx);
    expect(down.level).toBe("warn");
    expect(down.detail).not.toContain(TG);
  });
});

describe("server.health", () => {
  const withListeners = (lines: string[]) => fake({ run: (c: Call) => (c.cmd.endsWith("lsof") ? { code: 0, stdout: lines.map((l) => `n${l}`).join("\n"), stderr: "" } : undefined) });
  it("not running is a WARN, never a pass", async () => {
    const f = withListeners([]);
    f.ctx.fetch = (async () => { throw new TypeError("ECONNREFUSED"); }) as unknown as typeof fetch;
    expect((await step("server.health").check(f.ctx)).level).toBe("warn");
  });
  it("loopback listener answering ok passes; a bad status, ok:false or a wildcard bind fails", async () => {
    const f = withListeners(["127.0.0.1:4317"]);
    f.ctx.fetch = respond(200, { ok: true });
    expect((await step("server.health").check(f.ctx)).level).toBe("pass");
    f.ctx.fetch = respond(500);
    expect((await step("server.health").check(f.ctx)).level).toBe("fail");
    f.ctx.fetch = respond(200, { ok: false });
    expect((await step("server.health").check(f.ctx)).level).toBe("fail");
    const open = withListeners(["*:4317"]);
    open.ctx.fetch = respond(200, { ok: true });
    expect((await step("server.health").check(open.ctx)).detail).toContain("127.0.0.1 only");
  });
});

describe("mcp.hub", () => {
  const HUB = (command: string, script = process.argv[1]!) => ({ mcpServers: { hub: { type: "stdio", command, args: [script, "mcp"], env: { HUB_PROJECT: "${HUB_PROJECT:-}" } } } });
  it("fails when the server is missing from .mcp.json or its program does not exist", async () => {
    const f = fake();
    expect((await step("mcp.hub").check(f.ctx)).level).toBe("fail");
    writeFileSync(f.ctx.paths.mcpFile, JSON.stringify(HUB("/no/such/node")));
    expect((await step("mcp.hub").check(f.ctx)).detail).toContain("does not exist");
    writeFileSync(f.ctx.paths.mcpFile, JSON.stringify(HUB("node", "/no/such/hub.mjs")));
    expect((await step("mcp.hub").check(f.ctx)).detail).toContain("/no/such/hub.mjs does not exist");
  });
  it("starts `node` as the hub's own Node with a throw-away database (never the real one) and passes on an initialize reply", async () => {
    const calls: { cmd: string; env?: Record<string, string>; input?: string }[] = [];
    const f = fake();
    const script = path.join(f.root, "hub.mjs");
    writeFileSync(script, "");
    writeFileSync(f.ctx.paths.mcpFile, JSON.stringify(HUB("node", script)));
    const realRun = f.ctx.run;
    f.ctx.run = async (cmd, args, opts) => {
      if (cmd !== process.execPath) return realRun(cmd, args, opts);
      calls.push({ cmd, env: opts?.env, input: opts?.input });
      return { code: 0, stdout: '{"jsonrpc":"2.0","id":1,"result":{"serverInfo":{"name":"hub"}}}\n', stderr: "" };
    };
    const r = await step("mcp.hub").check(f.ctx);
    expect(r.level, r.detail).toBe("pass");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.input).toContain('"method":"initialize"');
    expect(calls[0]!.env!.HUB_DB).not.toBe(f.ctx.paths.db);
    expect(calls[0]!.env!.HUB_PROJECT).toBe("");
    expect(path.dirname(calls[0]!.env!.HUB_DB!).includes("hub-mcp-check-")).toBe(true);
    expect(readdirSync(tmpdir()).filter((n) => n === path.basename(path.dirname(calls[0]!.env!.HUB_DB!)))).toEqual([]); // removed
    f.ctx.run = async () => ({ code: 1, stdout: "", stderr: "Error: cannot find module\nboom" });
    expect((await step("mcp.hub").check(f.ctx)).detail).toContain("boom");
    f.ctx.run = async () => ({ code: 124, stdout: "", stderr: "" });
    expect((await step("mcp.hub").check(f.ctx)).detail).toContain("45 s");
  });
});

// ---- backup.* ---------------------------------------------------------------------------------------------------------------------

const git = (dir: string, ...args: string[]) => execFileSync("git", ["-C", dir, "-c", "user.name=t", "-c", "user.email=t@example.com", ...args], { encoding: "utf8" }).trim();
function repo(base: string, name: string, remote: "none" | "pushed" | "unpushed" | "dead"): string {
  const dir = path.join(base, name);
  mkdirSync(dir, { recursive: true });
  git(dir, "init", "-q", "-b", "main");
  writeFileSync(path.join(dir, "a.txt"), "1");
  git(dir, "add", "a.txt");
  git(dir, "commit", "-q", "-m", "one");
  if (remote === "none") return dir;
  const bare = path.join(base, `${name}.git`);
  if (remote === "dead") { git(dir, "remote", "add", "origin", path.join(base, "nowhere.git")); return dir; }
  execFileSync("git", ["init", "-q", "--bare", "-b", "main", bare]);
  git(dir, "remote", "add", "origin", bare);
  git(dir, "push", "-q", "origin", "main");
  if (remote === "unpushed") { writeFileSync(path.join(dir, "a.txt"), "2"); git(dir, "commit", "-q", "-am", "two"); }
  return dir;
}
const withRepos = (f: ReturnType<typeof fake>, instance: string, core: string): Ctx => ({ ...f.ctx, paths: { ...f.ctx.paths, home: instance, core } });

describe("backup.git", () => {
  it("fails with no origin, fails on an unpushed HEAD, warns when origin is unreachable, passes when pushed", async () => {
    const f = fake();
    const base = path.dirname(f.root);
    const core = repo(base, "core", "pushed");
    const none = await step("backup.git").check(withRepos(f, repo(base, "i-none", "none"), core));
    expect(none.level).toBe("fail");
    expect(none.detail).toContain("instance: no `origin` remote");
    const behind = await step("backup.git").check(withRepos(f, repo(base, "i-unpushed", "unpushed"), core));
    expect(behind.level).toBe("fail");
    expect(behind.detail).toMatch(/instance: HEAD [0-9a-f]{9} is not on origin/);
    expect((await step("backup.git").check(withRepos(f, repo(base, "i-dead", "dead"), core))).level).toBe("warn");
    const good = await step("backup.git").check(withRepos(f, repo(base, "i-pushed", "pushed"), core));
    expect(good.level, good.detail).toBe("pass");
  });
  it("a core pinned behind the tip of its branch still counts as pushed", async () => {
    const f = fake();
    const base = path.dirname(f.root);
    const core = repo(base, "core2", "pushed");
    writeFileSync(path.join(core, "a.txt"), "3");
    git(core, "commit", "-q", "-am", "three");
    git(core, "push", "-q", "origin", "main");
    git(core, "checkout", "-q", "HEAD~1"); // the pin: older than the branch tip, objects are local
    const r = await step("backup.git").check(withRepos(f, repo(base, "i2", "pushed"), core));
    expect(r.level, r.detail).toBe("pass");
  });
  it("watches the extra repositories listed in config.json (backup_repos)", async () => {
    const f = fake();
    const base = path.dirname(f.root);
    const core = repo(base, "core3", "pushed");
    const inst = repo(base, "i3", "pushed");
    const plan = repo(base, "plan", "none");
    mkdirSync(path.join(inst, "config"), { recursive: true });
    const ctx = withRepos(f, inst, core);
    ctx.paths = { ...ctx.paths, configFile: path.join(inst, "config", "config.json") };
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_repos: [plan] }));
    const r = await step("backup.git").check(ctx);
    expect(r.level).toBe("fail");
    expect(r.detail).toContain("plan: no `origin` remote");
  });
});

describe("backup.db", () => {
  const sha = (p: string) => readFileSync(p).toString("base64");
  it("copies a real database, proves the copy, removes the temporary folder and leaves the live file alone", async () => {
    const f = fake();
    mkdirSync(path.dirname(f.ctx.paths.db), { recursive: true });
    openDb(f.ctx.paths.db).close();
    const before = sha(f.ctx.paths.db);
    const mtime = statSync(f.ctx.paths.db).mtimeMs;
    const tmpBefore = readdirSync(tmpdir()).filter((n) => n.startsWith("hub-backup-check-"));
    const r = await step("backup.db").check(f.ctx);
    expect(r.level, r.detail).toBe("pass");
    expect(r.detail).toContain("integrity_check");
    expect(readdirSync(tmpdir()).filter((n) => n.startsWith("hub-backup-check-"))).toEqual(tmpBefore);
    expect(statSync(f.ctx.paths.db).mtimeMs).toBe(mtime);
    expect(sha(f.ctx.paths.db)).toBe(before);
  });
  it("warns when there is no database yet and fails on a file that is not a database", async () => {
    const f = fake();
    expect((await step("backup.db").check(f.ctx)).level).toBe("warn");
    mkdirSync(path.dirname(f.ctx.paths.db), { recursive: true });
    writeFileSync(f.ctx.paths.db, "this is not sqlite, it is just long enough to be read as a header of nothing useful at all");
    expect((await step("backup.db").check(f.ctx)).level).toBe("fail");
  });
});

describe("backup.notion", () => {
  const day = (ago: number) => new Date(Date.now() - ago * 864e5).toISOString().slice(0, 10);
  const dump = (projectDir: string, ago: number, errors = 0) => {
    const d = path.join(projectDir, "dumps", day(ago));
    mkdirSync(d, { recursive: true });
    writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ format: 1, project: "acme", date: day(ago), databases: [], totals: { databases: 1, pages: 1, markdown_truncated: 0, errors } }));
  };
  const runner = (f: ReturnType<typeof fake>, code: number, calls: Call[] = []) => {
    const real = f.ctx.run;
    f.ctx.run = async (cmd, args, opts) => {
      if (!cmd.endsWith("/tsx")) return real(cmd, args, opts);
      calls.push({ cmd, args, ...(opts?.env ? { env: opts.env } : {}) });
      return { code, stdout: "", stderr: code ? "database clients: boom" : "" };
    };
    return calls;
  };
  it("passes with nothing to dump; fails with no dump, an old dump or a dump with errors", async () => {
    const f = fake();
    expect((await step("backup.notion").check(f.ctx)).level).toBe("pass");
    const dir = addProject(f);
    const none = await step("backup.notion").check(f.ctx);
    expect(none.level).toBe("fail");
    expect(none.detail).toContain("acme: no complete dump");
    dump(dir, 30);
    expect((await step("backup.notion").check(f.ctx)).detail).toMatch(/newest dump is 30 days old/);
    dump(dir, 1, 2);
    expect((await step("backup.notion").check(f.ctx)).detail).toContain("2 database error(s)");
  });
  it("a fresh dump needs restore --dry-run to pass (and nothing else is run); no token means a WARN, never a restore", async () => {
    const f = fake();
    const dir = addProject(f);
    dump(dir, 1);
    const calls = runner(f, 0);
    const warned = await step("backup.notion").check(f.ctx);
    expect(warned.level).toBe("warn");
    expect(calls).toEqual([]);
    put(f.ctx.configDir, "notion-token", NOTION);
    const good = await step("backup.notion").check(f.ctx);
    expect(good.level, good.detail).toBe("pass");
    expect(calls).toHaveLength(1);
    expect(calls[0]!.args!.slice(1, 4)).toEqual(["restore", dir, "--dry-run"]);
    expect(calls[0]!.args!.some((a) => a === "dump")).toBe(false);
    expect(JSON.stringify(good)).not.toContain(NOTION);
    runner(f, 2);
    const bad = await step("backup.notion").check(f.ctx);
    expect(bad.level).toBe("fail");
    expect(bad.detail).toContain("restore --dry-run exited 2");
    expect(bad.detail).not.toContain(NOTION);
  });
});

describe("backup.secrets", () => {
  it("fails on a readable folder or file (names only) and on a token file a project names but is missing", async () => {
    const f = fake();
    mkdirSync(f.ctx.configDir, { recursive: true });
    chmodSync(f.ctx.configDir, 0o700);
    put(f.ctx.configDir, "mail-work.json", "{}");
    expect((await step("backup.secrets").check(f.ctx)).level).toBe("pass");
    put(f.ctx.configDir, "telegram-bot-token", TG, 0o644);
    const loose = await step("backup.secrets").check(f.ctx);
    expect(loose.level).toBe("fail");
    expect(loose.detail).toContain("telegram-bot-token");
    expect(loose.detail).not.toContain(TG);
    chmodSync(path.join(f.ctx.configDir, "telegram-bot-token"), 0o600);
    chmodSync(f.ctx.configDir, 0o755);
    expect((await step("backup.secrets").check(f.ctx)).detail).toContain("must be 700");
    chmodSync(f.ctx.configDir, 0o700);
    addProject(f, "acme", [row("notion.token_file", "acme-notion-token")]);
    const missing = await step("backup.secrets").check(f.ctx);
    expect(missing.level).toBe("fail");
    expect(missing.detail).toContain("acme-notion-token");
  });
});

describe("dev.kanban", () => {
  it("PASS with no projects, WARN until a project has @dev, PASS after hub dev init, FAIL on a stale table", async () => {
    const { initDev } = await import("@hub/projects/dev");
    const f = fake();
    expect((await step("dev.kanban").check(f.ctx)).level).toBe("pass");
    const dir = addProject(f);
    const warn = await step("dev.kanban").check(f.ctx);
    expect(warn.level).toBe("warn");
    expect(warn.detail).toContain("hub dev init acme --apply");
    expect(initDev("acme", dir, true).ok).toBe(true);
    expect((await step("dev.kanban").check(f.ctx)).level).toBe("pass");
    mkdirSync(path.join(dir, "@dev", "active", "p1-x"), { recursive: true });
    writeFileSync(path.join(dir, "@dev", "active", "p1-x", "PLAN.md"), "# X\n\nStatus: ACTIVE\nOwner: agent\nNext action: go\n");
    const bad = await step("dev.kanban").check(f.ctx);
    expect(bad.level).toBe("fail");
    expect(bad.detail).toContain("hub dev index acme");
  });
});
