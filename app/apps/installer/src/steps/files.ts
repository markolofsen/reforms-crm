import { INSTANCE_KEYS, readInstanceConfig } from "@hub/config/instance";
import { chmodSync, copyFileSync, existsSync, mkdirSync, readdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { instanceBrand } from "@hub/config/paths";
import { readJson, type McpFile, type PackageJson, type Ctx } from "../context";
import { brokenStdioCommands, RETIRED_MCP_SERVERS, rootMcpServers } from "../mcp-servers";
import type { Step } from "../types";
import { fail, pass, warn } from "./helpers";

const stateDirs = (c: Ctx) => ["runs", "clients", "history"].map((d) => path.join(c.paths.state, d));
const allDirs = (c: Ctx) => [...stateDirs(c), c.configDir];
const CONFIGS = ["mcp.json"];
const SETTINGS = ["config.json"];
const REQUIRED_CONFIG_KEYS = ["account", "mailboxes", "allow_list"];
/** Every key of `config/config.json`: the schema of `@hub/config/instance`, the one reader (P126 K1). Add a key there. */
export const CONFIG_KEYS: readonly string[] = INSTANCE_KEYS;
/** Keys under `agent` the hub read once and reads no more: `unattended` (one permission mode for every session, owner 2026-11-25). */
export const RETIRED_AGENT_KEYS: readonly string[] = ["unattended"];
const retiredAgentKeys = (cfg: object): string[] => {
  const agent: unknown = Reflect.get(cfg, "agent");
  return agent && typeof agent === "object" && !Array.isArray(agent) ? RETIRED_AGENT_KEYS.filter((k) => k in agent) : [];
};

/** Mail login files of the removed IMAP reader (decision 0026): nothing reads them; the owner deletes them. */
const OLD_MAIL_LOGIN = /^mail-[A-Za-z0-9][A-Za-z0-9._-]*\.json$/;

function copyDefaults(ctx: Ctx, files: string[]): string {
  const made: string[] = [];
  mkdirSync(ctx.paths.configDir, { recursive: true });
  for (const f of files) {
    const dst = path.join(ctx.paths.configDir, f);
    if (!existsSync(dst)) { copyFileSync(path.join(ctx.paths.templates, f), dst); made.push(f); }
  }
  return made.length ? `wrote defaults: ${made.join(", ")}` : "nothing to write (existing files kept)";
}

/** The servers as `.mcp.json` of the instance must hold them (with the core's `hub` server, `rootMcpServers`). */
const wanted = (ctx: Ctx, cfg: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> => rootMcpServers(cfg, ctx.paths);

export const fileSteps: Step[] = [
  {
    id: "files.dirs", group: "Files", title: "Working folders",
    why: "State and the private secrets folder `state/secrets` (mode 700) must exist before a session needs them.",
    verifies: "`state/runs`, `state/clients`, `state/history` and `state/secrets` (the git-ignored secrets folder, not readable by others) exist.",
    does: "Creates the folders; the secrets folder gets mode 700.",
    async check(ctx) {
      const missing = allDirs(ctx).filter((d) => !existsSync(d));
      if (missing.length) return fail(`missing: ${missing.map((d) => path.relative(ctx.paths.home, d) || d).join(", ")}`);
      if (statSync(ctx.configDir).mode & 0o077) return fail(`${ctx.configDir} is readable by others`);
      return pass(`${allDirs(ctx).length} folders`);
    },
    async apply(ctx) {
      for (const d of allDirs(ctx)) mkdirSync(d, { recursive: true });
      chmodSync(ctx.configDir, 0o700);
      return "folders created";
    },
  },
  {
    id: "files.config", group: "Files", title: "Config files (never overwritten)",
    why: "`config/mcp.json` lists the MCP servers (mail, Notion) every session uses. Your edits are never replaced.",
    verifies: "`config/mcp.json` exists and parses.",
    does: "Copies a default from `app/apps/installer/templates/` only when the file is missing.",
    async check(ctx) {
      const bad = CONFIGS.filter((f) => !readJson(path.join(ctx.paths.configDir, f))).map((f) => `${f} missing or invalid`);
      return bad.length ? fail(bad.join("; ")) : pass(CONFIGS.join(", "));
    },
    async apply(ctx) {
      return copyDefaults(ctx, CONFIGS);
    },
  },
  {
    id: "files.settings", group: "Files", title: "Settings file (never overwritten)",
    why: "`config/config.json` (mail account, mailboxes, allow-list) is what `draft.recipients: test` and `hub send` read. A manual session that only drafts does not need it.",
    verifies: "`config.json` exists, parses and has every required key.",
    does: "Copies a default from `app/apps/installer/templates/` only when the file is missing.",
    async check(ctx) {
      const bad: string[] = [];
      for (const f of SETTINGS) {
        const j = readJson(path.join(ctx.paths.configDir, f));
        if (!j) { bad.push(`${f} missing or invalid`); continue; }
        if (f === "config.json") for (const k of REQUIRED_CONFIG_KEYS) if (!(k in j)) bad.push(`config.json lacks ${k}`);
      }
      return bad.length ? fail(bad.join("; ")) : pass(SETTINGS.join(", "));
    },
    async apply(ctx) {
      return copyDefaults(ctx, SETTINGS);
    },
  },
  {
    id: "files.config-keys", group: "Files", title: "Settings file holds no key nothing reads",
    why: "`config/config.json` kept keys of the archived background daemon after it was removed: they look like settings and change nothing, so someone edits them and expects an effect.",
    verifies: `Every top-level key of \`config/config.json\` is one the hub reads (${CONFIG_KEYS.map((k) => `\`${k}\``).join(", ")}). An unknown key is a WARN naming it, never a FAIL. A retired key (${RETIRED_AGENT_KEYS.map((k) => `\`agent.${k}\``).join(", ")}: one permission mode since 2026-11-25) is a WARN too: read by nothing, it changes nothing. Nothing is changed or deleted.`,
    async check(ctx) {
      const cfg = readJson(ctx.paths.configFile);
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return pass("no readable config.json: files.settings reports that");
      const retired = retiredAgentKeys(cfg);
      if (retired.length) return warn(`config.json has retired key(s) nothing reads: ${retired.map((k) => `agent.${k}`).join(", ")}. Delete them: every session runs with no prompts and the OS sandbox on`);
      const unknown = Object.keys(cfg).filter((k) => !CONFIG_KEYS.includes(k));
      // A malformed value is left out by the reader and the rest still applies: say which, beside the unknown keys.
      const { problems } = readInstanceConfig(ctx.paths);
      const lines = [...(unknown.length ? [`config.json has key(s) nothing reads: ${unknown.join(", ")}. Delete them; the keys the hub reads are listed in this step's page`] : []), ...problems.map((p) => `${p}: the setting is ignored`)];
      return lines.length ? warn(lines.join("; ")) : pass(`${Object.keys(cfg).length} key(s), all read by the hub`);
    },
  },
  {
    id: "files.brand", group: "Files", title: "Instance brand (name and logo)",
    why: "The admin's header shows the instance's `name` and `logo` from `config/config.json`, both optional. A logo path that names no file shows a monogram instead, which looks like the logo was never set.",
    verifies: "When `logo` is set, the file exists (a relative path is read from the `config/` folder). No logo, or no name, is a PASS: the admin says \"Hub\" and draws a monogram. A missing file is a WARN.",
    manual: { steps: ["Put the logo file (svg, png, jpg or webp) where `logo` in `config/config.json` points, or remove `logo`."] },
    async check(ctx) {
      const b = instanceBrand(ctx.paths);
      if (b.logo === null) return pass(`name "${b.name}", no logo (a monogram is shown)`);
      return b.logoFound ? pass(`name "${b.name}", logo ${path.relative(ctx.paths.home, b.logo) || b.logo}`) : warn(`logo ${b.logo} does not exist: fix \`logo\` in config/config.json or remove it (a monogram is shown meanwhile)`);
    },
  },
  {
    id: "files.mail-logins", group: "Files", title: "No mail login files left",
    why: "Mail is read and sent only through Apple Mail (decision 0026): the hub holds no mail key. Old IMAP login files (`state/secrets/mail-*.json`) are no longer read, and a password nobody uses is still a password on disk.",
    verifies: "`state/secrets/` holds no `mail-*.json`. One is a WARN naming the files; nothing is deleted.",
    manual: { steps: ["Delete the `mail-*.json` files the row names from `state/secrets/`."] },
    async check(ctx) {
      let names: string[] = [];
      try { names = readdirSync(ctx.configDir).filter((n) => OLD_MAIL_LOGIN.test(n)); } catch { /* no secrets folder: nothing left */ }
      return names.length ? warn(`${names.join(", ")} in ${ctx.configDir}: no longer read (mail goes through Apple Mail only). Delete ${names.length === 1 ? "it" : "them"}`) : pass("none");
    },
  },
  {
    id: "files.mcp-json", group: "Files", title: "Project .mcp.json",
    why: "Your Claude Code in this folder sees the servers of `config/mcp.json` (mail, Notion) and the core's `hub` server (focus, project, knowledge, drafts). Claude starts in the instance folder, so a server program of the core must be named by an absolute path: a relative `app/...` path does not exist there and the server never starts.",
    verifies: "`.mcp.json` contains every server of `config/mcp.json` and the core's `hub` server (stdio programs as absolute paths under the core, `hub` on the hub's own Node), every stdio server command in it exists, and it holds no server the core no longer ships (`knowledge-mcp`, whose tools are the `hub` server's since P129).",
    does: "Merges the servers of `config/mcp.json` and the core's `hub` server into `.mcp.json` with stdio paths made absolute under the core, drops the servers the core no longer ships, keeps your other servers, saves a one-time `.mcp.json.bak`.",
    async check(ctx) {
      const cfg = readJson<McpFile>(path.join(ctx.paths.configDir, "mcp.json"))?.mcpServers;
      if (!cfg) return fail("config/mcp.json has no mcpServers");
      const want = wanted(ctx, cfg);
      const have = readJson<McpFile>(ctx.paths.mcpFile)?.mcpServers ?? {};
      const retired = RETIRED_MCP_SERVERS.filter((k) => k in have);
      if (retired.length) return fail(`.mcp.json still starts ${retired.join(", ")}, which the core no longer ships (its tools are the hub server's). Fix: \`hub install --only files.mcp-json\` drops it`);
      const broken = brokenStdioCommands(have, ctx);
      if (broken.length) return fail(`.mcp.json cannot start: ${broken.join("; ")}. Fix: \`hub install --only files.mcp-json\` rewrites them absolute under the core`);
      const off = Object.keys(want).filter((k) => JSON.stringify(have[k]) !== JSON.stringify(want[k]));
      return off.length ? fail(`out of date: ${off.join(", ")}`) : pass(`${Object.keys(want).length} servers`);
    },
    async apply(ctx) {
      const shipped = readJson<McpFile>(path.join(ctx.paths.configDir, "mcp.json"))?.mcpServers;
      if (!shipped) throw new Error("config/mcp.json has no mcpServers: `hub install --only files.config` first");
      const want = wanted(ctx, shipped);
      const f = ctx.paths.mcpFile;
      const cur = readJson<McpFile>(f) ?? {};
      if (existsSync(f) && !existsSync(`${f}.bak`)) copyFileSync(f, `${f}.bak`);
      const kept = Object.fromEntries(Object.entries(cur.mcpServers ?? {}).filter(([k]) => !RETIRED_MCP_SERVERS.includes(k)));
      const next = { ...cur, mcpServers: { ...kept, ...want } };
      const tmp = `${f}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(next, null, 2) + "\n");
      renameSync(tmp, f);
      return "merged servers into .mcp.json";
    },
  },
  {
    id: "files.app-db", group: "Files", title: "App database",
    why: "The local app keeps working state (marks, queue, run log) in one SQLite file.",
    verifies: "The database file exists (`data/app.db` of the instance).",
    does: "Runs the app's `db:migrate` script (`pnpm --dir app run db:migrate`).",
    async check(ctx) {
      if (existsSync(ctx.paths.db)) return pass(path.relative(ctx.paths.home, ctx.paths.db) || ctx.paths.db);
      const pkg = readJson<PackageJson>(path.join(ctx.paths.core, "app", "package.json"));
      if (!pkg?.scripts?.["db:migrate"]) return warn("app/ has no db:migrate script yet (app track not delivered)");
      return fail(`${path.relative(ctx.paths.home, ctx.paths.db) || ctx.paths.db} missing`);
    },
    async apply(ctx) {
      const r = await ctx.run("pnpm", ["--dir", path.join(ctx.paths.core, "app"), "run", "db:migrate"], { timeoutMs: 120000, env: { HUB_HOME: ctx.paths.home, HUB_DB: ctx.paths.db } });
      if (r.code !== 0) throw new Error(`db:migrate failed: ${r.stderr.trim().slice(0, 200)}`);
      return "migrations applied";
    },
  },
];
