import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { claudeSettings, protectedEditRules } from "../src/claude";
import { codexConfigToml, codexRules } from "../src/codex";
import { commandsOf, coreAccess, coreGitViolations, type GitProbe } from "../src/core-access";
import { claudeExcludedCommands } from "../src/session";
import { sessionCapabilities } from "../src/connectors";

// P159 part 2 (owner 2026-11-26): an attended session improves the core through a worktree beside it; the live checkout stays
// read-only and main moves only by a push of a skills/@docs change. Measured on Claude Code 2.1.220 and Codex 0.153.0 in
// throwaway sessions; these tests pin the generated files and the guard rule.

function fakeCore() {
  const root = mkdtempSync(path.join(tmpdir(), "hub-core-access-"));
  const core = path.join(root, "reforms-hub");
  for (const d of [".git/hooks", "app", "skills", "@docs"]) mkdirSync(path.join(core, d), { recursive: true });
  writeFileSync(path.join(core, ".git", "config"), "");
  writeFileSync(path.join(core, "README.md"), "");
  const home = path.join(root, "inst");
  mkdirSync(path.join(home, "projects"), { recursive: true });
  return { core, home, paths: hubPaths({ home, core, env: {} }) };
}

const probe = (o: { files?: string[] | null; branch?: string; common?: string | null } = {}): GitProbe => ({
  commonDir: () => o.common ?? null,
  changed: () => (o.files === undefined ? ["skills/triage-mail/SKILL.md"] : o.files),
  branch: () => o.branch ?? "dock/fix",
});

describe("core access (P159 part 2)", () => {
  it("the checkout's entries are read-only one by one, the git dir writable but its hooks and config, the -dock folder beside it", () => {
    const { core } = fakeCore();
    const c = coreAccess(core);
    expect(c.checkout.sort()).toEqual(["@docs", "README.md", "app", "skills"].map((e) => path.join(c.core, e)).sort());
    expect(c.gitReadOnly).toEqual([path.join(c.core, ".git", "hooks"), path.join(c.core, ".git", "config")]);
    expect(c.dock).toBe(`${c.core}-dock`);
  });

  it("Claude: the core's root and the -dock folder are allowed, its entries and git hooks/config denied, git push leaves the sandbox", () => {
    const { paths } = fakeCore();
    const c = coreAccess(paths.core);
    const s = claudeSettings({ paths, projectsDir: path.join(paths.home, "projects"), slug: undefined, nodeBin: "node" });
    const fs = (s.sandbox as { filesystem: { denyWrite: string[]; allowWrite: string[] } }).filesystem;
    expect(fs.allowWrite).toEqual([c.core, c.dock]);
    for (const p of [...c.checkout, ...c.gitReadOnly]) expect(fs.denyWrite).toContain(p);
    // a deny on the core itself, its git dir or the instance's `core` link (resolved by the sandbox) would close the git dir
    for (const p of [paths.core, c.gitDir, path.join(paths.home, "core")]) expect(fs.denyWrite).not.toContain(p);
    const deny = (s.permissions as { deny: string[] }).deny;
    expect(deny).not.toContain(`Edit(/${paths.core}/**)`);
    expect(deny).toContain(`Edit(/${path.join(c.core, "skills")}/**)`);
    expect(protectedEditRules(paths)).toContain("Edit(./core/**)");
    expect(claudeExcludedCommands()).toEqual(["ssh *", "scp *", "rsync *", "git push *", "git -C * push *"]);
  });

  it("Codex: the git dir and the -dock folder writable, hooks and config read-only, the checkout read; forbidden git prefixes", () => {
    const { paths } = fakeCore();
    const c = coreAccess(paths.core);
    const t = codexConfigToml({ paths, projectsDir: path.join(paths.home, "projects"), slug: undefined, servers: {}, instructions: "x", nodeBin: "/n/node" });
    const q = JSON.stringify;
    expect(t).toContain(`${q(paths.core)} = "read"`);
    expect(t).toContain(`${q(c.gitDir)} = "write"`);
    expect(t).toContain(`${q(c.dock)} = "write"`);
    for (const p of c.gitReadOnly) expect(t).toContain(`${q(p)} = "read"`);
    const r = codexRules();
    expect(r).toContain('prefix_rule(pattern = ["git", "update-ref"], decision = "forbidden"');
    expect(r).toContain('prefix_rule(pattern = ["git", "push", "origin", "main"], decision = "forbidden"');
  });

  it("the capabilities line names the worktree, the explicit-path commit and who moves main, per CLI", () => {
    const c = sessionCapabilities("acme", [], "claude");
    expect(c).toContain("core: improve the hub's shared skills and docs");
    expect(c).toContain("worktree add --no-track");
    expect(c).toContain("never `git add -A`, a stash or a force push");
    expect(c).toContain("no client names, emails, ids or keys");
    expect(c).toContain("push origin dock/<topic>:main");
    const x = sessionCapabilities("acme", [], "codex");
    expect(x).toContain("You cannot push");
    expect(x).not.toContain("dock/<topic>:main");
  });
});

describe("hub guard's core rule (coreGitViolations)", () => {
  const { core } = fakeCore();
  const c = coreAccess(core);
  const dock = path.join(c.dock, "fix");
  const run = (cmd: string, cwd = "/elsewhere", p: GitProbe = probe()) => coreGitViolations(cmd, cwd, core, p);

  it("splits a Bash line into simple commands, quotes kept", () => {
    expect(commandsOf(`git -C "${dock}" add a b && git commit -m 'x; y' | tee z`)).toEqual([["git", "-C", dock, "add", "a", "b"], ["git", "commit", "-m", "x; y"], ["tee", "z"]]);
  });

  it("lets a worktree be made, committed in and pushed by branch; a skills/@docs change goes to main", () => {
    expect(run(`git -C ${c.core} fetch origin && git -C ${c.core} worktree add --no-track ${dock} -b dock/fix origin/main`)).toEqual([]);
    expect(run(`git -C ${dock} add skills/x/SKILL.md && git -C ${dock} commit -m x`)).toEqual([]);
    expect(run(`git -C ${dock} push origin dock/fix`)).toEqual([]);
    expect(run(`git -C ${dock} push origin dock/fix:main`, "/elsewhere", probe({ files: ["skills/a/SKILL.md", "@docs/core/24-terminal.md"] }))).toEqual([]);
    expect(run(`git -C ${c.core} config --get remote.origin.url`)).toEqual([]);
  });

  it("refuses a push to main that changes code, an unreadable diff, an empty change and main itself", () => {
    expect(run(`git -C ${dock} push origin dock/fix:main`, "/x", probe({ files: ["skills/a.md", "app/x.ts"] }))[0]).toMatch(/changes app\/x\.ts outside skills\/ and @docs\/.*hand it to the coordinator/);
    expect(run(`git -C ${dock} push origin dock/fix:refs/heads/main`, "/x", probe({ files: null }))[0]).toMatch(/cannot be read/);
    expect(run(`git -C ${dock} push origin dock/fix:main`, "/x", probe({ files: [] }))[0]).toMatch(/changes nothing/);
    expect(run(`git -C ${dock} push origin main`)[0]).toMatch(/never main itself/);
  });

  it("refuses force, delete, mirror, -u, another remote, and git that moves the live checkout or main", () => {
    for (const cmd of [`git -C ${dock} push --force origin dock/fix`, `git -C ${dock} push -f origin dock/fix`, `git -C ${dock} push --delete origin dock/fix`, `git -C ${dock} push --mirror origin`, `git -C ${dock} push -u origin dock/fix`, `git -C ${dock} push origin +dock/fix:dock/fix`, `git -C ${dock} push origin :dock/fix`, `git -C ${dock} push /tmp/other dock/fix`, `git -C ${dock} push --receive-pack=sh origin dock/fix`]) expect(run(cmd), cmd).toHaveLength(1);
    for (const cmd of [`git -C ${c.core} merge --ff-only dock/fix`, `git -C ${c.core} pull`, `git -C ${c.core} reset --hard`, `git -C ${c.core} checkout dock/fix`, `git -C ${dock} update-ref refs/heads/main HEAD`, `git -C ${dock} branch -f main HEAD`, `git -C ${dock} config core.hooksPath x`]) expect(run(cmd), cmd).toHaveLength(1);
    // the main checkout as the working folder (no -C)
    expect(run("git merge dock/fix", c.core)).toHaveLength(1);
  });

  it("ignores git outside the core repository", () => {
    expect(run("git push --force origin main", "/some/other/repo")).toEqual([]);
    expect(run("echo git push --force")).toEqual([]);
  });

  it("knows a worktree elsewhere by its common git dir", () => {
    expect(run("git push --force origin x", "/elsewhere/wt", probe({ common: c.gitDir }))).toHaveLength(1);
  });
});
