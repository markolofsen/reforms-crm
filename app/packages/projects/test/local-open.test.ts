import { mkdirSync, mkdtempSync, readFileSync, symlinkSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { beforeEach, describe, expect, it } from "vitest";
import { entryKey } from "@hub/contract/local";
import { argvOf, chooseOpener, targetRefusal, fakeOpener, isRefusal, localOpenAvailable, OPEN_BIN, openTarget, resolveTarget, type ResolveDeps, type Target } from "../src/local-open";

// P61: keys to paths inside each key's own root; never a raw path, never a link, never a program. A throw-away instance.

const ENTRY = "knowledge/files/how-can-i-pay-41806f30.md";
let home: string;
let projects: string;
let deps: ResolveDeps;

function makeInstance(projectsRoot?: string) {
  home = mkdtempSync(join(tmpdir(), "hub-local-open-"));
  projects = projectsRoot ?? join(home, "projects");
  for (const slug of ["acme-travel", "other"]) {
    const f = join(projects, slug);
    mkdirSync(join(f, "knowledge", "files"), { recursive: true });
    mkdirSync(join(f, "workflows"), { recursive: true });
    writeFileSync(join(f, "project.md"), "# P\n");
  }
  writeFileSync(join(projects, "acme-travel", ENTRY), "---\ntitle: Pay\n---\n");
  writeFileSync(join(projects, "acme-travel", "knowledge", "files", "not-indexed.md"), "x");
  mkdirSync(join(home, "state", "log", "acme-travel"), { recursive: true });
  writeFileSync(join(home, "state", "log", "acme-travel", "2026-11-19.jsonl"), "{}\n");
  const indexed: Record<string, string[]> = { "acme-travel": [ENTRY, "knowledge/files/etc-link.md", "knowledge/files/run.command", "knowledge/files/linkdir/x.md"], other: [] };
  deps = {
    projectsRoot: projects,
    logRoot: join(home, "state", "log"),
    isProject: async (s) => s in indexed,
    knowledgeHas: async (s, e) => indexed[s]?.includes(e) ?? false,
  };
}

const resolve = (action: Parameters<typeof resolveTarget>[0], key: string, project = "acme-travel") => resolveTarget(action, { project, key }, deps);
const pathOf = async (action: Parameters<typeof resolveTarget>[0], key: string) => {
  const r = await resolve(action, key);
  if (isRefusal(r) || r.kind !== "path") throw new Error(`refused: ${JSON.stringify(r)}`);
  return r.path;
};

beforeEach(() => makeInstance());

describe("resolveTarget", () => {
  it("resolves each key to its place", async () => {
    expect(await pathOf("finder.open", "project")).toBe(join(projects, "acme-travel"));
    expect(await pathOf("finder.open", "knowledge")).toBe(join(projects, "acme-travel", "knowledge"));
    expect(await pathOf("finder.open", "workflows")).toBe(join(projects, "acme-travel", "workflows"));
    expect(await pathOf("file.open", "project.md")).toBe(join(projects, "acme-travel", "project.md"));
    expect(await pathOf("file.open", entryKey(ENTRY))).toBe(join(projects, "acme-travel", ENTRY));
    expect(await pathOf("file.open", "log:2026-11-19")).toBe(join(home, "state", "log", "acme-travel", "2026-11-19.jsonl"));
    expect(await resolve("finder.reveal", "project.md")).toMatchObject({ kind: "path", verb: "reveal" });
  });
  it("refuses .., an absolute path, a ~ path and an unknown key at the schema", async () => {
    for (const k of ["knowledge:knowledge/../../../config/config.json", "../../config/config.json", "/etc/passwd", "~/.ssh", "dumps"]) {
      const r = await resolve("file.open", k);
      expect(isRefusal(r) && r.status, k).toBe(400);
    }
  });
  it("refuses a knowledge entry not in the index even when the file exists", async () => {
    expect(await resolve("file.open", entryKey("knowledge/files/not-indexed.md"))).toMatchObject({ status: 404, refused: expect.stringMatching(/index/) });
  });
  it("refuses a link inside knowledge/ that points at /etc, and a link to a folder", async () => {
    symlinkSync("/etc/hosts", join(projects, "acme-travel", "knowledge", "files", "etc-link.md"));
    expect(await resolve("file.open", entryKey("knowledge/files/etc-link.md"))).toMatchObject({ refused: "a link is never opened" });
    symlinkSync("/etc", join(projects, "acme-travel", "knowledge", "files", "linkdir"));
    expect(isRefusal(await resolve("file.open", entryKey("knowledge/files/linkdir/x.md")))).toBe(true);
  });
  it("refuses a target that is itself a link (project.md -> elsewhere)", async () => {
    const f = join(projects, "acme-travel", "project.md");
    const elsewhere = join(home, "elsewhere.md");
    writeFileSync(elsewhere, "x");
    const { rmSync } = await import("node:fs");
    rmSync(f);
    symlinkSync(elsewhere, f);
    expect(await resolve("file.open", "project.md")).toMatchObject({ refused: "a link is never opened" });
  });
  it("refuses a .app folder for finder.open and every non-text file type for file.open", async () => {
    const root = join(projects, "acme-travel");
    mkdirSync(join(root, "x.app"));
    const { realpathSync } = await import("node:fs");
    const realRoot = realpathSync(root);
    expect(targetRefusal("finder.open", join(root, "x.app"), realRoot)).toMatchObject({ refused: "a .app folder would run, not open" });
    expect(targetRefusal("finder.open", join(root, "knowledge"), realRoot)).toBeNull();
    deps.knowledgeHas = async () => true;
    for (const ext of [".command", ".sh", ".app"]) {
      const name = `run${ext}`;
      writeFileSync(join(root, "knowledge", "files", name), "#!/bin/sh\n");
      expect(await resolve("file.open", entryKey(`knowledge/files/${name}`)), ext).toMatchObject({ refused: expect.stringContaining("not a file the hub opens") });
    }
    expect(await resolve("finder.reveal", entryKey("knowledge/files/run.sh"))).toMatchObject({ kind: "path", verb: "reveal" });
  });
  it("HUB_PROJECTS outside the instance resolves", async () => {
    makeInstance(join(mkdtempSync(join(tmpdir(), "hub-projects-elsewhere-")), "projects"));
    expect(await pathOf("file.open", "project.md")).toBe(join(projects, "acme-travel", "project.md"));
  });
  it("another project's slug reaches only its own folder; an unknown slug is refused", async () => {
    expect(await pathOf("finder.open", "knowledge").then(() => resolveTarget("file.open", { project: "other", key: entryKey(ENTRY) }, deps))).toMatchObject({ status: 404 });
    expect(await resolve("finder.open", "project", "nordhaus")).toMatchObject({ status: 404 });
  });
  it("an href action resolves to its URL; the desktop handoff is not offered", async () => {
    expect(await resolveTarget("mail.openMessage", { messageId: "a@b.example" }, deps)).toEqual({ kind: "url", url: "message://%3Ca%40b.example%3E", label: "Open the client's mail" });
    expect(await resolveTarget("agent.openInDesktop", { project: "acme-travel", tab: "t1" }, deps)).toMatchObject({ status: 501, refused: expect.stringMatching(/^Not offered/) });
  });
  it("P87: Open Mail starts Apple Mail by name and takes no argument; no other application is opened", async () => {
    const t = await resolveTarget("mail.openApp", {}, deps);
    expect(t).toEqual({ kind: "app", app: "Mail", label: "Open Mail" });
    expect(argvOf(t as Target)).toEqual(["-a", "Mail"]);
    expect(await resolveTarget("mail.openApp", { app: "Terminal" }, deps)).toMatchObject({ status: 400 });
    expect(() => argvOf({ kind: "app", app: "Terminal" as "Mail", label: "x" })).toThrow(/not an application/);
  });
  it("no refusal names a path", async () => {
    const all = await Promise.all([resolve("file.open", "log:2020-01-01"), resolve("file.open", entryKey("knowledge/files/not-indexed.md")), resolve("finder.open", "project", "nordhaus")]);
    for (const r of all) expect(JSON.stringify(r)).not.toContain(home);
  });
});

describe("the runner", () => {
  it("the fake runner receives an argv array starting with /usr/bin/open", async () => {
    const log = join(home, "state", "opener.jsonl");
    const t = (await resolve("finder.reveal", "project.md")) as Target;
    await openTarget(t, fakeOpener(log));
    await openTarget((await resolve("finder.open", "knowledge")) as Target, fakeOpener(log));
    const lines = readFileSync(log, "utf8").trim().split("\n").map((l) => JSON.parse(l).argv);
    expect(lines).toEqual([[OPEN_BIN, "-R", join(projects, "acme-travel", "project.md")], [OPEN_BIN, join(projects, "acme-travel", "knowledge")]]);
  });
  it("re-checks a URL against the allowlist and a path for being absolute", () => {
    expect(() => argvOf({ kind: "url", url: "file:///etc/passwd", label: "x" })).toThrow(/file scheme/);
    expect(() => argvOf({ kind: "path", verb: "open", path: "-a", label: "x" })).toThrow(/absolute/);
    expect(argvOf({ kind: "url", url: "http://127.0.0.1:5173", label: "Admin" }, { adminPort: 5173 })).toEqual(["http://127.0.0.1:5173"]);
  });
  it("is available on macOS with open(1) only, or with the fake", () => {
    expect(localOpenAvailable("open", { platform: "darwin", exists: () => true })).toBe(true);
    expect(localOpenAvailable("open", { platform: "linux", exists: () => true })).toBe(false);
    expect(localOpenAvailable("open", { platform: "darwin", exists: () => false })).toBe(false);
    expect(localOpenAvailable("fake", { platform: "linux" })).toBe(true);
  });
  it("HUB_OPENER=fake needs HUB_DB; another value is refused", () => {
    const paths = { state: join(home, "state") };
    expect(chooseOpener({}, paths, false).kind).toBe("open");
    expect(chooseOpener({ HUB_OPENER: "fake" }, paths, true).kind).toBe("fake");
    expect(() => chooseOpener({ HUB_OPENER: "fake" }, paths, false)).toThrow(/HUB_DB/);
    expect(() => chooseOpener({ HUB_OPENER: "yes" }, paths, true)).toThrow(/HUB_OPENER/);
  });
});
