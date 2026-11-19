import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { checkCoreUpdates, compareVersions, CoreCheckError, currentCoreUpdate, judgeCoreUpdate, parseLsRemote, pinLabel, readCoreUpdateCache, readCoreVersion, readPinFile, refreshCoreUpdate, sortVersions, updateCommand, type CommandRun, type CoreTag, type JudgeInput } from "../src/core-version";
import { hubPaths } from "../src/paths";

const HOME = "/x/saas";
const tag = (name: string, date: string | null = "2026-11-01T10:00:00Z", subject = `core: ${name} (things)`): CoreTag => ({ name, date, subject });
const judge = (o: Partial<JudgeInput>) => judgeCoreUpdate({ home: HOME, pin: "v0.12.11", inUse: "v0.12.11", base: { name: "v0.12.11", date: "2026-11-01T10:00:00Z", exact: true }, tags: [tag("v0.12.10"), tag("v0.12.11")], ...o });

describe("versions and the pin file", () => {
  it("orders by semver, not by text, and drops what is not a version tag", () => {
    expect(compareVersions("v0.10.0", "v0.9.9")).toBeGreaterThan(0);
    expect(sortVersions(["v0.12.10", "v0.12.9", "backup-2026", "v0.2.0", "v0.12.9"])).toEqual(["v0.2.0", "v0.12.9", "v0.12.10"]);
  });
  it("reads the pin, the managed tag mark and follows; names a sha pin by its tag", () => {
    const home = mkdtempSync(join(tmpdir(), "hub-pin-"));
    writeFileSync(join(home, "core.version"), "# the core\n# tag: v0.12.11\n6b42f24aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa\n");
    expect(readPinFile(home)).toEqual({ pin: "6b42f24aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa", tag: "v0.12.11" });
    expect(readCoreVersion(home)).toBe("6b42f24aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa");
    expect(pinLabel(readPinFile(home))).toBe("v0.12.11");
    writeFileSync(join(home, "core.version"), "# follows: main\nabcdef0123456789\n");
    expect(readPinFile(home)).toEqual({ pin: "abcdef0123456789", follows: "main" });
    expect(pinLabel(readPinFile(home))).toBe("abcdef012");
    expect(readPinFile(join(home, "nope"))).toBeUndefined();
  });
});

describe("the judge (verdict 4)", () => {
  it("current when no newer tag exists", () => {
    const r = judge({});
    expect(r.level).toBe("current");
    expect(r.command).toEqual([]);
    expect(r.newest).toBe("v0.12.11");
  });
  it("available for one patch, with the three lines that move, commit and restart", () => {
    const r = judge({ tags: [tag("v0.12.11"), tag("v0.12.12", "2026-11-03T10:00:00Z", "core: v0.12.12 (P64 resume)")], facts: { dependencies: true, migrations: false, rollback: false } });
    expect(r.level).toBe("available");
    expect(r.reason).toBe("1 newer release (patch); dependencies change");
    expect(r.tags).toEqual([{ name: "v0.12.12", date: "2026-11-03T10:00:00Z", subject: "core: v0.12.12 (P64 resume)" }]);
    expect(r.command).toEqual(["cd /x/saas && ./run.sh core update v0.12.12 --apply", 'git add core core.version && git commit -m "core: v0.12.12"', "./run.sh restart"]);
  });
  it("recommended for a new minor, for five patches, and for a tag 14 days newer", () => {
    expect(judge({ tags: [tag("v0.12.11"), tag("v0.13.0")] })).toMatchObject({ level: "recommended", reason: expect.stringContaining("new minor") });
    const five = ["v0.12.12", "v0.12.13", "v0.12.14", "v0.12.15", "v0.12.16"].map((n) => tag(n));
    expect(judge({ tags: five })).toMatchObject({ level: "recommended", reason: expect.stringContaining("5 newer releases behind") });
    expect(judge({ tags: [tag("v0.12.12", "2026-11-15T10:00:00Z")] })).toMatchObject({ level: "recommended", reason: "v0.12.12 is 14 days newer than v0.12.11" });
    expect(judge({ tags: [tag("v0.12.12", "2026-11-14T10:00:00Z")] }).level).toBe("available");
  });
  it("required when any tag in the range carries the marker, even a patch", () => {
    const r = judge({ tags: [tag("v0.12.12", null, "core: v0.12.12 (send fix) [update: required]"), tag("v0.12.13")], facts: { dependencies: false, migrations: true, rollback: false } });
    expect(r.level).toBe("required");
    expect(r.reason).toBe("v0.12.12 is marked [update: required]; database migrates");
    expect(r.tags.map((t) => t.name)).toEqual(["v0.12.13", "v0.12.12"]);
    expect(r.command[0]).toContain("v0.12.13");
  });
  it("a lightweight tag (commit subject, no tag date) still judges; at most 10 subjects, newest first", () => {
    const many = Array.from({ length: 12 }, (_, i) => tag(`v0.12.${12 + i}`, null, ""));
    const r = judge({ tags: many });
    expect(r.tags).toHaveLength(10);
    expect(r.tags[0]?.name).toBe("v0.12.23");
  });
  it("a bare-commit pin is judged from the tag below it; with none below, every tag is newer", () => {
    expect(judge({ pin: "abcdef012", base: { name: "v0.12.11", date: null, exact: false } })).toMatchObject({ level: "current", reason: "a commit after v0.12.11 is the newest release" });
    expect(judgeCoreUpdate({ home: HOME, pin: "abcdef012", inUse: "abcdef012", tags: [tag("v0.1.0")] })).toMatchObject({ level: "recommended", newest: "v0.1.0" });
  });
  it("follows main: no level, the commits behind and the branch command", () => {
    const r = judge({ follows: { branch: "main", behind: 3 } });
    expect(r).toMatchObject({ level: "follows", reason: "follows main: 3 commit(s) behind origin/main" });
    expect(r.command[0]).toBe("cd /x/saas && ./run.sh core update --branch main --apply");
    expect(judge({ follows: { branch: "main", behind: 0 } }).command).toEqual([]);
  });
  it("rollback: the pin is newer than the newest tag of origin", () => {
    const r = judge({ base: { name: "v0.12.12", date: null, exact: true }, tags: [tag("v0.12.11")] });
    expect(r).toMatchObject({ level: "current", facts: { rollback: true } });
  });
  it("names the workspace files in the commit line when the instance has its own workspace", () => {
    expect(updateCommand(HOME, "v1.0.0", true)[1]).toBe('git add core core.version package.json pnpm-workspace.yaml turbo.json && git commit -m "core: v1.0.0"');
  });
  it("ls-remote: only version tags; heads by name", () => {
    const p = parseLsRemote("aaa\trefs/tags/v0.1.0\nbbb\trefs/tags/backup-1\nccc\trefs/heads/main\n\n");
    expect([...p.tags.keys()]).toEqual(["v0.1.0"]);
    expect(p.heads.get("main")).toBe("ccc");
  });
});

/** A fake git: each call is recorded; answers come from `script` by the first argument after `-C <core>`. */
function fakeGit(script: Record<string, (args: string[]) => { code?: number; stdout?: string; stderr?: string }>) {
  const calls: { args: string[]; env?: Record<string, string>; timeoutMs?: number }[] = [];
  const run: CommandRun = async (cmd, args, o = {}) => {
    expect(cmd).toBe("git");
    const rest = args.slice(2);
    calls.push({ args: rest, ...(o.env ? { env: o.env } : {}), ...(o.timeoutMs ? { timeoutMs: o.timeoutMs } : {}) });
    const key = rest[0] === "tag" ? `tag ${rest[1]}` : (rest[0] ?? "");
    const r = script[key]?.(rest) ?? {};
    return { code: r.code ?? 0, stdout: r.stdout ?? "", stderr: r.stderr ?? "" };
  };
  return { run, calls };
}

const PIN = "6b42f24aaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa";
const instance = (pinText = `# tag: v0.12.11\n${PIN}\n`) => {
  const base = mkdtempSync(join(tmpdir(), "hub-core-check-"));
  const home = join(base, "saas");
  mkdirSync(home);
  writeFileSync(join(home, "core.version"), pinText);
  return hubPaths({ home, core: join(base, "core-checkout"), env: {} });
};
const REMOTE = `${PIN}\trefs/tags/v0.12.11\nfff\trefs/tags/v0.12.12\neee\trefs/tags/old-x\n111\trefs/heads/main\n`;
const REFS = "v0.12.11\t2026-11-01T10:00:00+00:00\tcore: v0.12.11 (P60)\nv0.12.12\t2026-11-03T10:00:00+00:00\tcore: v0.12.12 (P64 resume)\n";
const base = (over: Record<string, (args: string[]) => { code?: number; stdout?: string; stderr?: string }> = {}) => ({
  "rev-parse": (a: string[]) => ({ stdout: a.includes("HEAD") ? `${PIN}\n` : a.some((x) => x.startsWith("v0.12.12")) ? "fffcommit\n" : `${PIN}\n` }),
  describe: (a: string[]) => (a.includes("--exact-match") ? { stdout: "v0.12.11\n" } : { stdout: "v0.12.11\n" }),
  "ls-remote": () => ({ stdout: REMOTE }),
  "tag --list": () => ({ stdout: "v0.12.10\nv0.12.11\n" }),
  "tag --points-at": () => ({ stdout: "v0.12.11\n" }),
  "cat-file": () => ({ code: 0 }),
  fetch: () => ({ code: 0 }),
  "for-each-ref": () => ({ stdout: REFS }),
  diff: (a: string[]) => (a.includes("--quiet") ? { code: 1 } : { stdout: "app/packages/db/drizzle/0004_core.sql\n" }),
  ...over,
});
const NOW = () => new Date("2026-11-19T12:00:00Z");

describe("the check (verdict 2), git injected", () => {
  it("ls-remote with no prompt and 15 s; one fetch because a newer tag is not local; subjects and facts from the local objects", async () => {
    const paths = instance();
    const { run, calls } = fakeGit(base());
    const r = await checkCoreUpdates(run, paths, NOW);
    const ls = calls.find((c) => c.args[0] === "ls-remote");
    expect(ls).toMatchObject({ args: ["ls-remote", "--refs", "origin"], timeoutMs: 15_000, env: { GIT_TERMINAL_PROMPT: "0" } });
    expect(calls.filter((c) => c.args[0] === "fetch").map((c) => c.args)).toEqual([["fetch", "--tags", "origin"]]);
    expect(r).toMatchObject({ pin: "v0.12.11", inUse: "v0.12.11", level: "available", newest: "v0.12.12", facts: { dependencies: true, migrations: true, rollback: false }, checkedAt: "2026-11-19T12:00:00.000Z" });
    expect(r.tags).toEqual([{ name: "v0.12.12", date: "2026-11-03T10:00:00+00:00", subject: "core: v0.12.12 (P64 resume)" }]);
  });
  it("no fetch when every newer tag is already local; a stray tag never shows", async () => {
    const { run, calls } = fakeGit(base({ "tag --list": () => ({ stdout: "v0.12.11\nv0.12.12\n" }) }));
    const r = await checkCoreUpdates(run, instance(), NOW);
    expect(calls.some((c) => c.args[0] === "fetch")).toBe(false);
    expect(JSON.stringify(r)).not.toContain("old-x");
  });
  it("a locked fetch is skipped with a note and the check still answers", async () => {
    const { run } = fakeGit(base({ fetch: () => ({ code: 128, stderr: "fatal: Unable to create '/x/.git/shallow.lock': File exists." }) }));
    const r = await checkCoreUpdates(run, instance(), NOW);
    expect(r.reason).toContain("a fetch was skipped");
    expect(r.level).toBe("available");
  });
  it("an unreachable origin (or a timeout) throws CoreCheckError with its first line", async () => {
    const { run } = fakeGit(base({ "ls-remote": () => ({ code: 128, stderr: "fatal: unable to access 'https://github.com/x/y.git/': Could not resolve host: github.com\n" }) }));
    await expect(checkCoreUpdates(run, instance(), NOW)).rejects.toThrow(CoreCheckError);
    await expect(checkCoreUpdates(run, instance(), NOW)).rejects.toThrow("origin unreachable: fatal: unable to access");
  });
  it("a core/ link (hub core dev) and a missing pin are unknown, with no git call", async () => {
    const paths = instance();
    symlinkSync(tmpdir(), join(paths.home, "core"));
    const { run, calls } = fakeGit(base());
    expect((await checkCoreUpdates(run, paths, NOW)).level).toBe("unknown");
    expect(calls).toEqual([]);
    const empty = instance("# nothing\n");
    expect((await checkCoreUpdates(run, empty, NOW)).reason).toBe("core.version is missing or empty");
  });
});

describe("the cache", () => {
  it("a failure keeps the last good answer and adds when and why; a later success clears the error", async () => {
    const paths = instance();
    const good = fakeGit(base());
    await refreshCoreUpdate(good.run, paths, NOW);
    const bad = fakeGit(base({ "ls-remote": () => ({ code: 128, stderr: "fatal: Could not resolve host: github.com" }) }));
    const kept = await refreshCoreUpdate(bad.run, paths, () => new Date("2026-11-19T15:00:00Z"));
    expect(kept).toMatchObject({ level: "available", checkedAt: "2026-11-19T12:00:00.000Z", error: { at: "2026-11-19T15:00:00.000Z", message: "origin unreachable: fatal: Could not resolve host: github.com" } });
    expect(readCoreUpdateCache(paths.coreUpdate)).toEqual(kept);
    const again = await refreshCoreUpdate(good.run, paths, NOW);
    expect(again.error).toBeUndefined();
  });
  it("a failure with no cache is unknown with the error; the pin moving makes the cache unknown", async () => {
    const paths = instance();
    const bad = fakeGit(base({ "ls-remote": () => ({ code: 128, stderr: "offline" }) }));
    expect(await refreshCoreUpdate(bad.run, paths, NOW)).toMatchObject({ level: "unknown", error: { message: "origin unreachable: offline" } });
    await refreshCoreUpdate(fakeGit(base()).run, paths, NOW);
    writeFileSync(join(paths.home, "core.version"), "# tag: v0.12.12\nfffcommit\n");
    expect(currentCoreUpdate(paths)).toMatchObject({ level: "unknown", reason: "the pin moved to v0.12.12 since the last check" });
  });
  it("a file that is not an answer reads as none", () => {
    const paths = instance();
    mkdirSync(paths.state, { recursive: true });
    writeFileSync(paths.coreUpdate, '{"level":"maybe"}');
    expect(readCoreUpdateCache(paths.coreUpdate)).toBeUndefined();
    expect(currentCoreUpdate(paths).reason).toBe("not checked yet");
    expect(readFileSync(paths.coreUpdate, "utf8")).toContain("maybe");
  });
});
