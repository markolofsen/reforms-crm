import { chmodSync, mkdirSync, mkdtempSync, realpathSync, statSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { ensureSpawnHelper, nodePtyRoot, spawnHelperPath, terminalReadiness } from "../src/readiness";

// P66: what stops every tab, with its fix, on a fake core (never this checkout's node-pty: nothing real is chmodded).

/** A throwaway core `app/` with a node-pty folder; `helper` writes its spawn-helper with that mode (none: no prebuild). */
function fakeCore(helper: number | null = 0o644): { app: string; root: string } {
  const app = path.join(realpathSync(mkdtempSync(path.join(tmpdir(), "hub-pty-"))), "app");
  mkdirSync(path.join(app, "packages", "terminal"), { recursive: true });
  writeFileSync(path.join(app, "packages", "terminal", "package.json"), JSON.stringify({ name: "@hub/terminal" }));
  const root = path.join(app, "node_modules", "node-pty");
  mkdirSync(root, { recursive: true });
  writeFileSync(path.join(root, "package.json"), JSON.stringify({ name: "node-pty", main: "index.js" }));
  writeFileSync(path.join(root, "index.js"), "module.exports = { spawn() {} };");
  if (helper !== null) {
    const file = spawnHelperPath(root);
    mkdirSync(path.dirname(file), { recursive: true });
    writeFileSync(file, "#!/bin/sh\n");
    chmodSync(file, helper);
  }
  return { app, root };
}
const mode = (f: string) => statSync(f).mode & 0o777;
const loads = () => undefined;

describe("terminalReadiness (P66)", () => {
  it("a ready core is null, and the fake node-pty folder is the one resolved", () => {
    const { app, root } = fakeCore(0o755);
    expect(nodePtyRoot(app)).toBe(root);
    expect(terminalReadiness({ app, shell: "/bin/sh", load: loads })).toBeNull();
  });

  it("a helper without +x is reported with its chmod line; with heal (the server) it gets the bit and passes", () => {
    const { app, root } = fakeCore(0o644);
    const helper = spawnHelperPath(root);
    expect(terminalReadiness({ app, shell: "/bin/sh", load: loads })).toEqual({ reason: `node-pty's spawn-helper is not executable (${helper})`, fix: `chmod +x ${helper}` });
    expect(mode(helper)).toBe(0o644); // the check alone changes nothing
    expect(terminalReadiness({ app, shell: "/bin/sh", load: loads, heal: true })).toBeNull();
    expect(mode(helper)).toBe(0o755);
  });

  it("ensureSpawnHelper adds only +x, and is null without a prebuilt helper", () => {
    const a = fakeCore(0o640);
    expect(ensureSpawnHelper(a.root)).toBe(spawnHelperPath(a.root));
    expect(mode(spawnHelperPath(a.root))).toBe(0o751);
    expect(ensureSpawnHelper(fakeCore(null).root)).toBeNull();
  });

  it("node-pty missing and node-pty that does not load each give a reason and the reinstall line", () => {
    const empty = path.join(mkdtempSync(path.join(tmpdir(), "hub-pty-")), "app");
    mkdirSync(path.join(empty, "packages", "terminal"), { recursive: true });
    writeFileSync(path.join(empty, "packages", "terminal", "package.json"), "{}");
    expect(terminalReadiness({ app: empty, shell: "/bin/sh" })).toEqual({ reason: "node-pty (the terminal's PTY module) is not installed in the core", fix: `pnpm --dir ${empty} install --frozen-lockfile` });

    const { app } = fakeCore(0o755);
    const r = terminalReadiness({ app, shell: "/bin/sh", load: () => { throw new Error("The module was compiled against a different Node.js version\nmore"); } });
    expect(r?.reason).toBe(`node-pty does not load on this Node (${process.version}): The module was compiled against a different Node.js version`);
    expect(r?.fix).toBe(`pnpm --dir ${app} install --frozen-lockfile`);
  });

  it("the real loader loads the fake module (no prebuild needed when there is none for this machine)", () => {
    expect(terminalReadiness({ app: fakeCore(null).app, shell: "/bin/sh" })).toBeNull();
  });

  it("a missing shell gives the SHELL fix", () => {
    const { app } = fakeCore(0o755);
    expect(terminalReadiness({ app, shell: "/no/such/shell", load: loads })).toEqual({
      reason: "the shell a tab starts (/no/such/shell) does not exist or is not executable",
      fix: "set SHELL to an existing shell (/bin/zsh) and restart the hub with ./run.sh up",
    });
  });
});
