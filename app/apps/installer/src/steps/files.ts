import { chmodSync, copyFileSync, existsSync, mkdirSync, renameSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { readJson, type Ctx } from "../context";
import { brokenStdioCommands, instanceServer } from "../mcp-servers";
import type { Step } from "../types";
import { fail, pass, warn } from "./helpers";

const stateDirs = (c: Ctx) => ["runs", "clients", "history"].map((d) => path.join(c.paths.state, d));
const allDirs = (c: Ctx) => [...stateDirs(c), c.configDir];
const CONFIGS = ["mcp.json"];
const SETTINGS = ["config.json"];
const REQUIRED_CONFIG_KEYS = ["account", "mailboxes", "allow_list"];
/**
 * Every key of `config/config.json` the hub reads or its template carries: the whole schema. Add a key here in the same change that starts reading it.
 * Readers: account, mailboxes (mail.account), allow_list (send guard), extra_dirs (hub agent), admin_port and api_port (`@hub/config/paths`), backup_dir (hub backup), backup_repos (backup.git).
 * `sent_mailbox` is carried by the template only. The keys of the archived daemon (quiet_hours, model, timeouts, budgets, lock and breaker settings) are gone; run limits live per project in `project.md`.
 */
export const CONFIG_KEYS = ["account", "mailboxes", "sent_mailbox", "allow_list", "extra_dirs", "admin_port", "api_port", "backup_dir", "backup_repos"];

function copyDefaults(ctx: Ctx, files: string[]): string {
  const made: string[] = [];
  mkdirSync(ctx.paths.configDir, { recursive: true });
  for (const f of files) {
    const dst = path.join(ctx.paths.configDir, f);
    if (!existsSync(dst)) { copyFileSync(path.join(ctx.paths.templates, f), dst); made.push(f); }
  }
  return made.length ? `wrote defaults: ${made.join(", ")}` : "nothing to write (existing files kept)";
}

/** The servers as `.mcp.json` of the instance must hold them. */
const wanted = (ctx: Ctx, cfg: Record<string, Record<string, unknown>>): Record<string, Record<string, unknown>> =>
  Object.fromEntries(Object.entries(cfg).map(([k, v]) => [k, instanceServer(v, ctx.paths)]));

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
    verifies: `Every top-level key of \`config/config.json\` is one the hub reads (${CONFIG_KEYS.map((k) => `\`${k}\``).join(", ")}). An unknown key is a WARN naming it, never a FAIL: nothing is changed or deleted.`,
    async check(ctx) {
      const cfg = readJson(ctx.paths.configFile);
      if (!cfg || typeof cfg !== "object" || Array.isArray(cfg)) return pass("no readable config.json: files.settings reports that");
      const unknown = Object.keys(cfg).filter((k) => !CONFIG_KEYS.includes(k));
      return unknown.length ? warn(`config.json has key(s) nothing reads: ${unknown.join(", ")}. Delete them; the keys the hub reads are listed in this step's page`) : pass(`${Object.keys(cfg).length} key(s), all read by the hub`);
    },
  },
  {
    id: "files.mcp-json", group: "Files", title: "Project .mcp.json",
    why: "Your Claude Code in this folder sees the servers of `config/mcp.json` (mail, Notion, knowledge). Claude starts in the instance folder, so a server program of the core must be named by an absolute path: a relative `app/...` path does not exist there and the server never starts.",
    verifies: "`.mcp.json` contains every server of `config/mcp.json` (stdio programs as absolute paths under the core), and every stdio server command in it exists.",
    does: "Merges the servers of `config/mcp.json` into `.mcp.json` with stdio paths made absolute under the core, keeps your other servers, saves a one-time `.mcp.json.bak`.",
    async check(ctx) {
      const cfg = readJson(path.join(ctx.paths.configDir, "mcp.json"))?.mcpServers;
      if (!cfg) return fail("config/mcp.json has no mcpServers");
      const want = wanted(ctx, cfg);
      const have = readJson(ctx.paths.mcpFile)?.mcpServers ?? {};
      const broken = brokenStdioCommands(have, ctx);
      if (broken.length) return fail(`.mcp.json cannot start: ${broken.join("; ")}. Fix: \`hub install --only files.mcp-json\` rewrites them absolute under the core`);
      const off = Object.keys(want).filter((k) => JSON.stringify(have[k]) !== JSON.stringify(want[k]));
      return off.length ? fail(`out of date: ${off.join(", ")}`) : pass(`${Object.keys(want).length} servers`);
    },
    async apply(ctx) {
      const want = wanted(ctx, readJson(path.join(ctx.paths.configDir, "mcp.json"))!.mcpServers);
      const f = ctx.paths.mcpFile;
      const cur = readJson(f) ?? {};
      if (existsSync(f) && !existsSync(`${f}.bak`)) copyFileSync(f, `${f}.bak`);
      const next = { ...cur, mcpServers: { ...(cur.mcpServers ?? {}), ...want } };
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
      const pkg = readJson(path.join(ctx.paths.core, "app", "package.json"));
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
