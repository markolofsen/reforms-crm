import { spawnSync } from "node:child_process";
import { existsSync, readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { defaultRoot } from "../src/context.ts";

// Core files must not carry one owner's names (`@docs/LAYERS.md`). The names are the owner's own private list,
// `config/custom-names.txt` (one regex per line, git-ignored). Without the file (a fork) the guard has nothing to check.
const root = defaultRoot();
const namesFile = path.join(root, "config", "custom-names.txt");
const CORE = ["skills", "@docs/core", "app/@rules", "app/projects/_template", "app/packages", "app/apps", "install.sh", "config/mcp.json"];
const SKIP_DIRS = new Set(["node_modules", "dist", ".turbo", "fixtures", "data"]);
const TEXT = /\.(md|ts|tsx|json|sh|mjs|txt|yaml|yml)$/;
// Owner-specific by purpose: this file names the custom layer, the guard itself.
const ALLOW = new Set(["app/apps/installer/test/layers.test.ts"]);

function* walk(dir: string): Generator<string> {
  const st = statSync(dir);
  if (st.isFile()) { yield dir; return; }
  for (const e of readdirSync(dir)) {
    if (SKIP_DIRS.has(e)) continue;
    yield* walk(path.join(dir, e));
  }
}

describe.skipIf(!existsSync(namesFile))("core layer holds no owner names", () => {
  it("no core file matches config/custom-names.txt", () => {
    const names = readFileSync(namesFile, "utf8").split("\n").map((l) => l.trim()).filter(Boolean).map((l) => new RegExp(l, "i"));
    const hits: string[] = [];
    for (const c of CORE) {
      const abs = path.join(root, c);
      if (!existsSync(abs)) continue;
      for (const f of walk(abs)) {
        const rel = path.relative(root, f);
        if (ALLOW.has(rel) || !TEXT.test(f)) continue;
        const lines = readFileSync(f, "utf8").split("\n");
        lines.forEach((l, i) => { for (const re of names) if (re.test(l)) { hits.push(`${rel}:${i + 1} /${re.source}/`); break; } });
      }
    }
    expect(hits, `core files with owner names:\n${hits.join("\n")}`).toEqual([]);
  });
});

// Secrets and one owner's local files must never reach git (P0b, `@docs/LAYERS.md`).
describe("secrets and local config stay out of git", () => {
  const ignoreLines = readFileSync(path.join(root, ".gitignore"), "utf8").split("\n").map((l) => l.trim());
  const git = (...args: string[]) => spawnSync("git", ["-C", root, ...args], { encoding: "utf8" });
  const inRepo = git("rev-parse", "--is-inside-work-tree").stdout.trim() === "true";

  it(".gitignore names state/secrets, config/config.json, .mcp.json and @refs", () => {
    for (const rule of ["state/secrets/", "config/config.json", ".mcp.json", "@refs/"]) expect(ignoreLines, rule).toContain(rule);
    expect(ignoreLines).toContain("state/*");
  });
  it.skipIf(!inRepo)("git check-ignore agrees: a file in state/secrets/ and the local config are ignored", () => {
    for (const f of ["state/secrets/notion-token", "state/secrets/mail-any.json", "config/config.json", ".mcp.json"]) {
      expect(git("check-ignore", "-q", f).status, `${f} must be git-ignored`).toBe(0);
    }
  });
  it.skipIf(!inRepo)("no secret file is tracked", () => {
    const tracked = git("ls-files").stdout.split("\n").filter(Boolean);
    const bad = tracked.filter((f) => /(^|\/)state\/secrets\//.test(f) || /(^|\/)(notion-token|claude-token|telegram-bot-token)$/.test(f) || /(^|\/)mail-[A-Za-z0-9._-]+\.json$/.test(f));
    expect(bad).toEqual([]);
  });
});

// Automation that was retired before this repository was cut must not be imported or run by anything live.
describe("nothing live depends on an archived item", () => {
  const LIVE = ["app/apps", "app/packages", "skills", "install.sh", "hub.sh", "config/mcp.json", "config/config.json"].map((r) => path.join(root, r));
  const CODE = /\.(ts|tsx|json|sh|mjs|md)$/;
  const SELF = new Set(["app/apps/installer/test/layers.test.ts"]);
  const hits = (re: RegExp): string[] => {
    const out: string[] = [];
    for (const abs of LIVE) {
      if (!existsSync(abs)) continue;
      for (const f of walk(abs)) {
        const rel = path.relative(root, f);
        if (SELF.has(rel) || !CODE.test(f) || rel.endsWith("pnpm-lock.yaml")) continue;
        if (re.test(readFileSync(f, "utf8"))) out.push(rel);
      }
    }
    return out;
  };
  it("no live file names @hub/agent-gate, the archived installer folders or the retired scripts", () => {
    expect(hits(/@hub\/agent-gate|installer\/src\/(launchd|notify)\b|installer\/bin\/job\.sh|scripts\/dump\.sh|mailToMarkdown|mail-md\b/)).toEqual([]);
  });
});
