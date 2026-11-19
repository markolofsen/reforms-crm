import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { readCatalog, staleDeps } from "../src/deps";

// The start-up dependency check of bin/hub.mjs: a checkout that moved ahead of its node_modules installs before the CLI is imported.
const put = (f: string, body: string) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };
const installed = (app: string, member: string, name: string, version: string) =>
  put(path.join(app, member, "node_modules", name, "package.json"), JSON.stringify({ name, version }));

function rig() {
  const app = mkdtempSync(path.join(tmpdir(), "hub-deps-"));
  put(path.join(app, "pnpm-workspace.yaml"), "packages:\n  - apps/*\ncatalog:\n  vitest: 5.1.0\n  '@types/node': 22.20.5\nallowBuilds:\n  esbuild: true\n");
  put(path.join(app, "apps", "installer", "package.json"), JSON.stringify({
    dependencies: { "@hub/config": "workspace:*", commander: "15.1.0", zod: "^4" },
    devDependencies: { "@types/node": "catalog:" },
  }));
  installed(app, "apps/installer", "@hub/config", "0.1.0");
  installed(app, "apps/installer", "commander", "15.1.0");
  installed(app, "apps/installer", "zod", "4.0.1");
  installed(app, "apps/installer", "@types/node", "22.20.5");
  return app;
}

describe("staleDeps", () => {
  it("reads the catalog block, quotes dropped, and stops at the next key", () => {
    expect(readCatalog("packages:\n  - a\ncatalog:\n  tsx: 4.23.15\n  '@types/node': \"22.20.5\"\nallowBuilds:\n  esbuild: true\n")).toEqual({ tsx: "4.23.15", "@types/node": "22.20.5" });
  });
  it("is empty when every member has what its package.json names", () => {
    expect(staleDeps(rig())).toEqual([]);
  });
  it("names a new workspace package that is not linked yet (the crash after a pin bump)", () => {
    const app = rig();
    const pkg = path.join(app, "apps", "installer", "package.json");
    const json = JSON.parse(readFileSync(pkg, "utf8")) as { dependencies: Record<string, string> };
    json.dependencies["@hub/sequences"] = "workspace:*";
    writeFileSync(pkg, JSON.stringify(json));
    expect(staleDeps(app)).toEqual(["apps/installer: @hub/sequences is not installed"]);
  });
  it("names an exact or catalog version that moved; a range is checked for presence only", () => {
    const app = rig();
    installed(app, "apps/installer", "commander", "14.0.0");
    installed(app, "apps/installer", "@types/node", "22.19.0");
    installed(app, "apps/installer", "zod", "4.9.9");
    expect(staleDeps(app)).toEqual([
      "apps/installer: commander is 14.0.0, the checkout wants 15.1.0",
      "apps/installer: @types/node is 22.19.0, the checkout wants 22.20.5",
    ]);
  });
  it("bin/hub.mjs checks and installs before it imports the CLI", () => {
    const bin = readFileSync(path.join(__dirname, "..", "bin", "hub.mjs"), "utf8");
    // built, not quoted: the import-style gate reads this file and would take a literal for a relative import with an extension
    const dyn = (file: string) => `import("${["..", "src", file].join("/")}")`;
    const check = bin.indexOf("staleDeps(appDir)"), install = bin.indexOf("...INSTALL]"), cli = bin.indexOf(dyn("cli.ts"));
    expect(check).toBeGreaterThan(0);
    expect(install).toBeGreaterThan(check);
    expect(cli).toBeGreaterThan(install);
    // nothing above the check may pull in a package outside node: built-ins, tsx and the reexec hand-over; and the P51 prompt
    // hook and the P54 log hook, which skip the check on purpose (a hook must not run an install) and turn a failed import into silence
    expect(bin.slice(0, check).match(/import\(["'][^"']+["']\)|from ["'][^"']+["']/g)).toEqual(['from "node:child_process"', 'from "node:url"', 'from "tsx/esm/api"', dyn("focus-command.ts"), dyn("log-hook.ts"), dyn("reexec.ts"), dyn("deps.ts")]);
    expect(bin).toMatch(/try \{\n    await \(await import\("\.\.\/src\/focus-command\.ts"\)\)\.runFocusHook\(process\.env, rest\);\n  \} catch/);
    expect(bin).toMatch(/try \{\n    \(await import\("\.\.\/src\/log-hook\.ts"\)\)\.runLogHook\(rest\);\n  \} catch/);
  });
  it("deps.ts itself imports only node built-ins", () => {
    const src = readFileSync(path.join(__dirname, "..", "src", "deps.ts"), "utf8");
    for (const m of src.matchAll(/from "([^"]+)"/g)) expect(m[1]).toMatch(/^node:/);
  });
});
