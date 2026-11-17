import { mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { hubPaths } from "@hub/config/paths";
import { makeCtx } from "../src/context";
import { workspaceCheck, workspaceInit } from "../src/workspace";

function rig() {
  const home = mkdtempSync(path.join(tmpdir(), "hub-ws-"));
  const app = path.join(home, "core", "app");
  mkdirSync(app, { recursive: true });
  writeFileSync(path.join(app, "package.json"), JSON.stringify({ name: "x", packageManager: "pnpm@12.18.0", engines: { node: ">=22" }, devDependencies: { turbo: "2.11.11", typescript: "5.9.3", other: "1" } }));
  writeFileSync(path.join(app, "pnpm-workspace.yaml"), "packages:\n  - apps/*\n  - packages/*\nallowBuilds:\n  esbuild: true\n");
  writeFileSync(path.join(app, "turbo.json"), JSON.stringify({ tasks: { test: { outputs: [] } } }));
  return { home, ctx: makeCtx({ paths: hubPaths({ core: path.join(home, "core"), home, env: {} }), log: () => {} }) };
}

describe("hub workspace", () => {
  it("dry run writes nothing, apply writes three generated files, then check passes", () => {
    const r = rig();
    expect(workspaceCheck(r.ctx).ok).toBe(false);
    expect(workspaceInit(r.ctx, false).lines.join("\n")).toContain("would write package.json");
    expect(workspaceCheck(r.ctx).ok).toBe(false);
    expect(workspaceInit(r.ctx, true).ok).toBe(true);
    const yaml = readFileSync(path.join(r.home, "pnpm-workspace.yaml"), "utf8");
    expect(yaml).toContain("  - core/app/packages/*");
    expect(yaml).toContain("  - apps/*");
    expect(yaml).toContain("allowBuilds:");
    expect(yaml.match(/- apps\/\*/g)).toHaveLength(1);
    const pkg = JSON.parse(readFileSync(path.join(r.home, "package.json"), "utf8")) as { devDependencies: Record<string, string> };
    expect(pkg.devDependencies).toEqual({ turbo: "2.11.11", typescript: "5.9.3" });
    expect(workspaceCheck(r.ctx).ok).toBe(true);
  });
  it("check fails on drift after the core moves its versions", () => {
    const r = rig();
    workspaceInit(r.ctx, true);
    writeFileSync(path.join(r.home, "core", "app", "package.json"), JSON.stringify({ packageManager: "pnpm@12.19.0", devDependencies: { turbo: "2.12.0", typescript: "5.9.3" } }));
    expect(workspaceCheck(r.ctx).ok).toBe(false);
  });
  it("never overwrites a hand-written file", () => {
    const r = rig();
    writeFileSync(path.join(r.home, "package.json"), '{"name":"mine"}');
    const o = workspaceInit(r.ctx, true);
    expect(o.ok).toBe(false);
    expect(readFileSync(path.join(r.home, "package.json"), "utf8")).toBe('{"name":"mine"}');
  });
  it("says so when core/ is not checked out", () => {
    const home = mkdtempSync(path.join(tmpdir(), "hub-ws-"));
    const ctx = makeCtx({ paths: hubPaths({ core: path.join(home, "core"), home, env: {} }), log: () => {} });
    expect(workspaceCheck(ctx).lines.join("")).toContain("hub core install");
  });
});
