import { mkdirSync, mkdtempSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { describe, expect, it } from "vitest";
import { findInstanceHome, hubPaths, HubHomeMissingError, instancePorts } from "@hub/config/paths";
import { handOver } from "../src/reexec";

// P36 U1/U2: the instance is found from the current folder; each instance has its own ports.
function instance(extra: Record<string, unknown> = {}) {
  const base = mkdtempSync(path.join(tmpdir(), "hub-cwd-"));
  const home = path.join(base, "acme");
  mkdirSync(path.join(home, "projects", "p", "deep"), { recursive: true });
  mkdirSync(path.join(home, "config"), { recursive: true });
  writeFileSync(path.join(home, "core.version"), "# pin\nabc\n");
  writeFileSync(path.join(home, "config", "config.json"), JSON.stringify(extra));
  return { base, home };
}

describe("U1: the instance comes from the current folder", () => {
  it("finds the nearest folder with core.version, from any depth", () => {
    const { home } = instance();
    expect(findInstanceHome(path.join(home, "projects", "p", "deep"))).toBe(home);
    expect(findInstanceHome(home)).toBe(home);
  });
  it("finds none outside an instance", () => {
    expect(findInstanceHome(mkdtempSync(path.join(tmpdir(), "hub-none-")))).toBeUndefined();
  });
  it("hubPaths uses it only when HUB_HOME is unset; HUB_HOME wins", () => {
    const a = instance(), b = instance();
    expect(hubPaths({ env: {}, cwd: path.join(a.home, "projects") }).home).toBe(a.home);
    expect(hubPaths({ env: { HUB_HOME: b.home }, cwd: a.home }).home).toBe(b.home);
  });
  it("outside an instance and without HUB_HOME it is the one-line error", () => {
    expect(() => hubPaths({ env: {}, cwd: mkdtempSync(path.join(tmpdir(), "hub-none-")) })).toThrow(HubHomeMissingError);
  });
  it("hands over to the instance's own core, but not to itself and not when HUB_HOME is set", () => {
    const { base, home } = instance();
    const mine = path.join(base, "running-core");
    mkdirSync(mine);
    const bin = path.join(home, "core", "app", "apps", "installer", "bin");
    mkdirSync(bin, { recursive: true });
    writeFileSync(path.join(bin, "hub.mjs"), "");
    expect(handOver(home, {}, mine)).toEqual({ home, bin: path.join(bin, "hub.mjs") });
    expect(handOver(home, { HUB_HOME: home }, mine)).toBeUndefined();
    expect(handOver(home, { HUB_REEXEC: "1" }, mine)).toBeUndefined();
    expect(handOver(path.join(base, ".."), {}, mine)).toBeUndefined();
    const same = path.join(base, "same");
    symlinkSync(path.join(home, "core"), same);
    expect(handOver(home, {}, same)).toBeUndefined();
  });
});

describe("U2: ports per instance", () => {
  it("defaults to 5173 and 4317", () => {
    const { home } = instance();
    expect(instancePorts(hubPaths({ env: {}, home }), {})).toEqual({ admin: 5173, api: 4317 });
  });
  it("reads admin_port and api_port from config.json", () => {
    const { home } = instance({ admin_port: 5174, api_port: 4318 });
    expect(instancePorts(hubPaths({ env: {}, home }), {})).toEqual({ admin: 5174, api: 4318 });
  });
  it("the environment beats the config", () => {
    const { home } = instance({ admin_port: 5174, api_port: 4318 });
    expect(instancePorts(hubPaths({ env: {}, home }), { HUB_ADMIN_PORT: "5200", HUB_PORT: "4400" })).toEqual({ admin: 5200, api: 4400 });
  });
  it("refuses a bad port and a shared port, never falls back silently", () => {
    const bad = instance({ admin_port: "abc" });
    expect(() => instancePorts(hubPaths({ env: {}, home: bad.home }), {})).toThrow(/admin_port/);
    const same = instance({ admin_port: 5000, api_port: 5000 });
    expect(() => instancePorts(hubPaths({ env: {}, home: same.home }), {})).toThrow(/both use port 5000/);
  });
});
