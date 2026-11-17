// `hub backup` (decision 0023): plan, apply, verify, retention, refusals, secrets never read, and the doctor step. No network: the Notion dump is a fake process.
import { execFileSync } from "node:child_process";
import { chmodSync, existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import path from "node:path";
import { openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import { INSTANCE_TEMPLATE } from "../src/init.ts";
import { CORE_ROOT } from "@hub/config/paths";
import { backup, checkManifest, KEEP, listSnapshots, MANIFEST, readManifest, resolveTarget, sha256File, staleDriveMount, verify } from "../src/backup.ts";
import { STEPS } from "../src/steps/index.ts";
import { fake, type Call } from "./helpers.ts";

const SECRET = "ntn_SENTINEL_never_copied_0123456789";
const ID = "00000000-0000-4000-8000-000000000001";
const row = (k: string, v: string) => `| ${k} | ${v} | 2026-11-15 | owner |`;
const snapshotStep = STEPS.find((s) => s.id === "backup.snapshot")!;

/** An instance with a database, a config, one project with a Notion database; the fake dump writes two files where the CLI would. */
function setup(over: { token?: boolean; config?: Record<string, unknown> } = {}) {
  const dumps: Call[] = [];
  const f = fake({
    run: (c) => {
      if (!c.cmd.endsWith("/tsx")) return undefined;
      dumps.push(c);
      const out = c.args[c.args.indexOf("--out") + 1]!;
      const day = path.join(out, c.args[c.args.indexOf("--date") + 1]!);
      mkdirSync(path.join(day, "acme"), { recursive: true });
      writeFileSync(path.join(day, "manifest.json"), "{}");
      writeFileSync(path.join(day, "acme", "index.md"), "# clients\n");
      return { code: 0, stdout: "dump acme 2026-11-17: 1 databases, 3 pages, 0 truncated, 0 errors, sha256 abc\n/x", stderr: "" };
    },
  });
  const { ctx } = f;
  mkdirSync(path.dirname(ctx.paths.db), { recursive: true });
  openDb(ctx.paths.db).close();
  writeFileSync(ctx.paths.configFile, JSON.stringify({ account: "a@example.com", ...(over.config ?? {}) }));
  const dir = path.join(ctx.paths.projects, "acme");
  mkdirSync(dir, { recursive: true });
  writeFileSync(path.join(dir, "project.md"), ["# acme", "", "## Settings", "", "| Field | Value | Answered | By |", "|---|---|---|---|", row("schema", "1"), row("status", "active"), row("mail.accounts", "a@example.com"), row("notion.teamspace", "Acme"), "", "## Notion databases", "", `- clients: ${ID}`, ""].join("\n"));
  const day = "2026-11-15";
  mkdirSync(path.join(dir, "dumps", day, "clients"), { recursive: true });
  writeFileSync(path.join(dir, "dumps", day, "manifest.json"), JSON.stringify({ date: day, totals: { errors: 0 } }));
  writeFileSync(path.join(dir, "dumps", day, "clients", "index.md"), "# clients\n");
  mkdirSync(ctx.configDir, { recursive: true, mode: 0o700 });
  if (over.token !== false) { writeFileSync(path.join(ctx.configDir, "notion-token"), SECRET, { mode: 0o000 }); chmodSync(path.join(ctx.configDir, "notion-token"), 0o000); }
  return { f, ctx, dumps, day, root: path.join(ctx.paths.home, "backups") };
}
const git = (cwd: string, ...a: string[]) => execFileSync("git", ["-C", cwd, ...a], { encoding: "utf8" });
const allFiles = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) => (e.isDirectory() ? allFiles(path.join(d, e.name)) : [path.join(d, e.name)]));
const at = (s: string) => new Date(s);

describe("hub backup: plan", () => {
  it("defaults to <instance>/backups, writes nothing and says what it would do", async () => {
    const { ctx, root } = setup();
    expect(resolveTarget(ctx).root).toBe(root);
    const r = await backup(ctx, { apply: false, now: at("2026-11-17T10:00:00") });
    expect(r.ok).toBe(true);
    const text = r.lines.join("\n");
    expect(text).toContain("dry run");
    expect(text).toContain(path.join(root, "20261117-100000"));
    expect(text).toContain("notion acme: copy the newest dump 2026-11-15 (2 day(s) old)");
    expect(text).toContain("notion-token");
    expect(existsSync(root)).toBe(false);
  });
  it("says a live dump only happens with --notion-dump", async () => {
    const { ctx } = setup();
    expect((await backup(ctx, { apply: false, notionDump: true })).lines.join("\n")).toContain("LIVE dump");
  });
});

describe("hub backup --apply", () => {
  it("writes the database copy, config, dump under projects/<slug> and a manifest; secrets are neither read nor copied", async () => {
    const { ctx, dumps, root, day } = setup();
    const r = await backup(ctx, { apply: true, now: at("2026-11-17T10:00:00") });
    expect(r.ok, r.lines.join("\n")).toBe(true);
    const dir = path.join(root, "20261117-100000");
    expect(r.dir).toBe(dir);
    expect(existsSync(path.join(dir, "data", "app.db"))).toBe(true);
    expect(existsSync(path.join(dir, "config", "config.json"))).toBe(true);
    expect(existsSync(path.join(dir, "projects", "acme", "dumps", "2026-11-15", "clients", "index.md"))).toBe(true);
    expect(existsSync(`${dir}.partial`)).toBe(false);
    const m = readManifest(dir)!;
    expect(m.instance).toBe(path.basename(ctx.paths.home));
    expect(m.secrets_expected).toEqual(["notion-token"]);
    expect(m.files.map((x) => x.path)).toEqual(expect.arrayContaining(["data/app.db", "config/config.json", "projects/acme/dumps/2026-11-15/manifest.json", "projects/acme/dumps/2026-11-15/clients/index.md"]));
    expect(m.files.every((x) => /^[0-9a-f]{64}$/.test(x.sha256))).toBe(true);
    // The secret file is mode 000: any read would have thrown. Its value is nowhere, and the child never got it.
    for (const file of allFiles(dir)) expect(readFileSync(file).includes(SECRET), file).toBe(false);
    expect(allFiles(dir).some((x) => x.includes("secrets") || x.includes("/state/"))).toBe(false);
    expect(JSON.stringify(dumps)).not.toContain(SECRET);
    expect(dumps, "no live dump by default").toHaveLength(0);
    expect(m.notion[0]).toMatchObject({ project: "acme", status: "copied" });
    expect(r.lines.join("\n")).toContain("copied dump 2026-11-15 (2 day(s) old)");
    expect(day).toBe("2026-11-15");
  });
  it("--notion-dump runs the live dump first into the snapshot; the child gets no secret in its environment", async () => {
    const { ctx, dumps, root } = setup();
    const r = await backup(ctx, { apply: true, notionDump: true, now: at("2026-11-17T10:00:00") });
    expect(r.ok, r.lines.join("\n")).toBe(true);
    expect(dumps).toHaveLength(1);
    expect(dumps[0]!.args).toContain("--token-file");
    expect(Object.keys(dumps[0]!.env ?? {}).sort()).toEqual(["HOME", "HUB_CONFIG_DIR", "HUB_HOME"]);
    expect(JSON.stringify(dumps)).not.toContain(SECRET);
    expect(readManifest(path.join(root, "20261117-100000"))!.notion[0]!.status).toBe("dumped");
  });
  it("without a token --notion-dump says so and copies the existing dump; a dump older than 7 days warns with the fix line; no dump at all warns", async () => {
    const { ctx, dumps } = setup({ token: false });
    const r = await backup(ctx, { apply: true, notionDump: true, now: at("2026-11-17T10:00:00") });
    expect(r.ok).toBe(true);
    expect(dumps).toHaveLength(0);
    expect(r.lines.join("\n")).toContain("--notion-dump skipped, no notion-token");
    const old = await backup(ctx, { apply: true, now: at("2026-12-01T10:00:00") });
    expect(old.ok).toBe(true);
    expect(old.lines.join("\n")).toMatch(/WARN: older than 7 days; fix: `pnpm --filter @hub\/notion notion-dump dump .*acme`/);
    const bare = setup();
    rmSync(path.join(bare.ctx.paths.projects, "acme", "dumps"), { recursive: true });
    const none = await backup(bare.ctx, { apply: true, now: at("2026-11-17T10:00:00") });
    expect(none.ok).toBe(true);
    expect(none.lines.join("\n")).toContain("WARN no dump exists yet");
  });
  it("never overwrites an existing snapshot", async () => {
    const { ctx } = setup();
    const now = at("2026-11-17T10:00:00");
    expect((await backup(ctx, { apply: true, now })).ok).toBe(true);
    const again = await backup(ctx, { apply: true, now });
    expect(again.ok).toBe(false);
    expect(again.lines.join("\n")).toContain("never overwritten");
  });
});

describe("hub backup --verify", () => {
  it("passes on a fresh snapshot and names the problem when a file or the database is damaged; the live database is not opened", async () => {
    const { ctx, root } = setup();
    await backup(ctx, { apply: true, now: at("2026-11-17T10:00:00") });
    const ok = verify(ctx);
    expect(ok.ok, ok.lines.join("\n")).toBe(true);
    expect(ok.lines.join("\n")).toContain("integrity_check ok");
    writeFileSync(path.join(root, "20261117-100000", "config", "config.json"), "{}");
    const bad = verify(ctx, "20261117-100000");
    expect(bad.ok).toBe(false);
    expect(bad.lines.join("\n")).toContain("config/config.json");
    const none = verify(setup().ctx);
    expect(none.ok).toBe(false);
  });
});

describe("hub backup --verify restores the database", () => {
  /** Overwrite the snapshot's database and make the manifest agree, so only a real restore can tell. */
  const replaceDb = (dir: string, body: Buffer | string) => {
    const f = path.join(dir, "data", "app.db");
    writeFileSync(f, body);
    const m = readManifest(dir)!;
    const e = m.files.find((x) => x.path === "data/app.db")!;
    e.sha256 = sha256File(f); e.size = statSync(f).size;
    writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m));
  };
  it("records table and row counts in the manifest and compares the restored file with them", async () => {
    const { ctx, root } = setup();
    await backup(ctx, { apply: true, now: at("2026-11-17T10:00:00") });
    const m = readManifest(path.join(root, "20261117-100000"))!;
    expect(m.db?.tables).toBeGreaterThan(5);
    expect(m.db?.rows).toBeGreaterThan(0);
    const r = verify(ctx);
    expect(r.ok, r.lines.join("\n")).toBe(true);
    expect(r.lines.join("\n")).toContain(`restores into a temporary file, integrity_check ok, matches the manifest (${m.db!.tables} tables, ${m.db!.rows} rows)`);
    expect(r.lines.join("\n")).toContain("0 migration(s) applied");
    // nothing is left behind and the snapshot itself is unchanged
    expect(readdirSync(path.join(root, "20261117-100000", "data"))).toEqual(["app.db"]);
  });
  it("accepts a snapshot made before counts were recorded, and says there was nothing to compare with", async () => {
    const { ctx, root } = setup();
    await backup(ctx, { apply: true, now: at("2026-11-17T10:00:00") });
    const dir = path.join(root, "20261117-100000");
    const m = readManifest(dir)!; delete m.db; writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m));
    const r = verify(ctx);
    expect(r.ok, r.lines.join("\n")).toBe(true);
    expect(r.lines.join("\n")).toContain("recorded no counts");
  });
  it("fails when the counts differ from the manifest", async () => {
    const { ctx, root } = setup();
    await backup(ctx, { apply: true, now: at("2026-11-17T10:00:00") });
    const dir = path.join(root, "20261117-100000");
    const m = readManifest(dir)!; m.db!.rows += 7; writeFileSync(path.join(dir, MANIFEST), JSON.stringify(m));
    const r = verify(ctx);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toMatch(/manifest recorded \d+ and \d+/);
  });
  it("fails a snapshot whose database hashes right but is not a database, in verify and in the doctor step", async () => {
    const { ctx, root } = setup();
    await backup(ctx, { apply: true, now: new Date() });
    const dir = path.join(root, readdirSync(root).find((n) => /^\d{8}-\d{6}$/.test(n))!);
    replaceDb(dir, "this is not a sqlite file, but its hash is in the manifest");
    expect(checkManifest(dir).problems).toEqual([]); // the hashes are fine: only a restore can tell
    const r = verify(ctx);
    expect(r.ok).toBe(false);
    expect(r.lines.join("\n")).toContain("cannot be restored");
    const d = await snapshotStep.check(ctx);
    expect(d.level).toBe("fail");
    expect(d.detail).toContain("cannot be restored");
  });
});

describe("retention", () => {
  const seed = (root: string, name: string, valid = true) => {
    const d = path.join(root, name);
    mkdirSync(d, { recursive: true });
    if (valid) writeFileSync(path.join(d, "manifest.json"), JSON.stringify({ format: 1, created: "2026-01-01T00:00:00Z", instance: "x", core_version: null, files: [], secrets_expected: [], notion: [] }));
  };
  it(`keeps the newest ${KEEP}, deletes older ones only under --apply and only folders with a valid manifest`, async () => {
    const { ctx, root } = setup();
    for (let i = 1; i <= 16; i++) seed(root, `202601${String(i).padStart(2, "0")}-000000`);
    seed(root, "20250101-000000", false); // old but no manifest: not ours to delete
    seed(root, "notes", false);
    const dry = await backup(ctx, { apply: false, now: at("2026-11-17T10:00:00") });
    expect(dry.lines.join("\n")).toContain("would delete 20260103-000000, 20260102-000000, 20260101-000000");
    expect(listSnapshots(root)).toHaveLength(16);
    const r = await backup(ctx, { apply: true, now: at("2026-11-17T10:00:00") });
    expect(r.ok).toBe(true);
    const left = listSnapshots(root).map((s) => s.name);
    expect(left).toHaveLength(KEEP);
    expect(left[0]).toBe("20261117-100000");
    expect(left).not.toContain("20260101-000000");
    expect(existsSync(path.join(root, "20250101-000000"))).toBe(true);
    expect(existsSync(path.join(root, "notes"))).toBe(true);
  });
});

describe("paths in config", () => {
  it("a relative path is resolved from the instance folder, an absolute one is kept, and there is no ~", () => {
    const { ctx } = setup();
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: "../shared-backups" }));
    expect(resolveTarget(ctx)).toEqual({ root: path.resolve(ctx.paths.home, "..", "shared-backups"), instance: path.basename(ctx.paths.home) });
    const abs = path.join(path.dirname(ctx.paths.home), "elsewhere");
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: abs }));
    expect(resolveTarget(ctx).root).toBe(abs);
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: "~/x" }));
    expect(resolveTarget(ctx).root).toBe(path.join(ctx.paths.home, "~", "x")); // a literal folder named ~, never the user's home
  });
});

describe("a stale Google Drive mount", () => {
  const live = "GoogleDrive-owner@example.com";
  it("is recognised by its dated name and nothing else", () => {
    expect(staleDriveMount(`/x/CloudStorage/${live} (18.11.2026 02:12)/My Drive/hub-backups`)).toBe(`${live} (18.11.2026 02:12)`);
    expect(staleDriveMount(`/x/CloudStorage/${live}/My Drive/hub-backups`)).toBeUndefined();
    expect(staleDriveMount("/x/Other (18.11.2026 02:12)/y")).toBeUndefined();
    expect(staleDriveMount(`/x/${live} (backup copy)/y`)).toBeUndefined();
  });
  it("is refused by backup and verify and FAILs the doctor step, naming the cure; the live mount is fine", async () => {
    const { ctx } = setup();
    const base = path.join(path.dirname(ctx.paths.home), "CloudStorage");
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: path.join(base, `${live} (18.11.2026 02:12)`, "My Drive", "hub-backups") }));
    expect(() => resolveTarget(ctx)).toThrow(/stale Google Drive mount/);
    const b = await backup(ctx, { apply: true });
    expect(b.ok).toBe(false);
    expect(existsSync(path.join(base, `${live} (18.11.2026 02:12)`))).toBe(false); // nothing was written there
    expect(verify(ctx).ok).toBe(false);
    const d = await snapshotStep.check(ctx);
    expect(d.level).toBe("fail");
    expect(d.detail).toContain("NOT in your live Drive");
    expect(d.detail).toContain("without the date");
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: path.join(base, live, "My Drive", "hub-backups") }));
    expect(resolveTarget(ctx).root).toContain(live);
  });
});

describe("refusals", () => {
  it("refuses a backup folder inside state/ or the core", () => {
    const { ctx } = setup();
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: path.join(ctx.paths.state, "snap") }));
    expect(() => resolveTarget(ctx)).toThrow(/inside state\//);
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: path.join(ctx.paths.core, "x") }));
    expect(() => resolveTarget(ctx)).toThrow(/core checkout/);
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: "state/inner" }));
    expect(() => resolveTarget(ctx)).toThrow(/inside state\//);
  });
  it("refuses to run while backups/ is not ignored or is tracked by git, and runs once it is ignored", async () => {
    const { ctx, root } = setup();
    git(ctx.paths.home, "init", "-q");
    const open = await backup(ctx, { apply: true });
    expect(open.ok).toBe(false);
    expect(open.lines.join("\n")).toContain("not ignored");
    expect(existsSync(root)).toBe(false);
    writeFileSync(path.join(ctx.paths.home, ".gitignore"), "backups/\n");
    expect((await backup(ctx, { apply: true, now: at("2026-11-17T10:00:00") })).ok).toBe(true);
    // a file tracked under backups/ (forced in) stops the next run
    git(ctx.paths.home, "add", "-f", "backups/20261117-100000/manifest.json");
    const tracked = await backup(ctx, { apply: true, now: at("2026-11-17T10:00:05") });
    expect(tracked.ok).toBe(false);
    expect(tracked.lines.join("\n")).toContain("tracked by git");
  });
  it("the instance template ignores backups/, so `hub init` makes it", () => {
    expect(readFileSync(path.join(CORE_ROOT, INSTANCE_TEMPLATE, ".gitignore"), "utf8").split("\n")).toContain("backups/");
  });
});

describe("doctor step backup.snapshot", () => {
  it("is doctor-only and explains itself", () => {
    expect(snapshotStep.audit).toBe(true);
    expect(snapshotStep.manual?.steps.length).toBeGreaterThan(0);
  });
  it("WARN on a fresh instance with no snapshot, FAIL on one with data", async () => {
    const fresh = fake();
    expect((await snapshotStep.check(fresh.ctx)).level).toBe("warn");
    const { ctx } = setup();
    const r = await snapshotStep.check(ctx);
    expect(r.level).toBe("fail");
    expect(r.detail).toContain("hub backup --apply");
  });
  it("WARN for a folder inside the instance, WARN when older than 7 days, FAIL when a hash no longer matches", async () => {
    const { ctx, root } = setup();
    await backup(ctx, { apply: true, now: new Date() });
    const same = await snapshotStep.check(ctx);
    expect(same.level, same.detail).toBe("warn");
    expect(same.detail).toContain("the backups sit next to the data they protect: a dead disk takes both. Set backup_dir in config/config.json to a folder outside this computer's disk, e.g. a Google Drive folder.");
    expect(same.detail).toContain("manifest hashes valid");
    const old = setup();
    await backup(old.ctx, { apply: true, now: new Date(Date.now() - 10 * 864e5) });
    const aged = await snapshotStep.check(old.ctx);
    expect(aged.level).toBe("warn");
    expect(aged.detail).toContain("10 days old");
    const name = readdirSync(root).find((n) => /^\d{8}-\d{6}$/.test(n))!;
    writeFileSync(path.join(root, name, "config", "config.json"), "{}");
    const bad = await snapshotStep.check(ctx);
    expect(bad.level).toBe("fail");
    expect(bad.detail).toContain("does not match its manifest");
  });
  it("PASS when backup_dir points outside the instance, whatever the device id says (cloud-drive folders)", async () => {
    const { ctx } = setup();
    const outside = path.join(path.dirname(ctx.paths.home), "cloud-drive", "saas");
    writeFileSync(ctx.paths.configFile, JSON.stringify({ backup_dir: outside }));
    await backup(ctx, { apply: true, now: new Date() });
    const r = await snapshotStep.check(ctx);
    expect(r.level, r.detail).toBe("pass");
    expect(r.detail).toContain("is outside the instance");
    expect(r.detail).not.toContain("next to the data");
  });
  it("FAIL when a file under backups/ is tracked by git", async () => {
    const { ctx } = setup();
    await backup(ctx, { apply: true, now: new Date() });
    git(ctx.paths.home, "init", "-q");
    writeFileSync(path.join(ctx.paths.home, ".gitignore"), "backups/\n");
    const name = readdirSync(path.join(ctx.paths.home, "backups"))[0]!;
    git(ctx.paths.home, "add", "-f", `backups/${name}/manifest.json`);
    const tracked = await snapshotStep.check(ctx);
    expect(tracked.level).toBe("fail");
    expect(tracked.detail).toContain("tracked by git");
  });
});
