import { execFileSync } from "node:child_process";
import { mkdirSync, mkdtempSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { openDb } from "@hub/db";
import { describe, expect, it } from "vitest";
import { findInstances, instanceStatus, statusTable } from "../src/status.ts";

// P36 U6: one table over the instances.
const put = (f: string, body: string) => { mkdirSync(path.dirname(f), { recursive: true }); writeFileSync(f, body); };
const PROJECT = (slug: string, status: string) => `# ${slug}\n\n## Settings\n\n| Field | Value | Answered | By |\n|---|---|---|---|\n| schema | 1 | 2026-11-16 | agent |\n| kind | generic | 2026-11-16 | agent |\n| name | ${slug} | 2026-11-16 | owner |\n| status | ${status} | 2026-11-16 | owner |\n| mail.accounts | a@example.com | 2026-11-16 | owner |\n`;

function instance(base: string, name: string, over: { drafts?: string[]; config?: object; pin?: string } = {}) {
  const home = path.join(base, name);
  put(path.join(home, "core.version"), `# pin\n${over.pin ?? "v0.1.0"}\n`);
  put(path.join(home, "projects", "p", "project.md"), PROJECT("p", "draft"));
  if (over.config) put(path.join(home, "config", "config.json"), JSON.stringify(over.config));
  if (over.drafts) {
    mkdirSync(path.join(home, "data"), { recursive: true });
    const h = openDb(path.join(home, "data", "app.db"));
    // only the column `hub status` reads: swap the real table for a minimal one
    h.db.$client.pragma("foreign_keys = OFF");
    h.db.$client.exec("drop table drafts; create table drafts (id integer primary key, status text)");
    for (const s of over.drafts) h.db.$client.prepare("insert into drafts (status) values (?)").run(s);
    h.close();
  }
  return home;
}

describe("hub status", () => {
  it("finds the instances next to the core, from the roots given, and the one the current folder is in", () => {
    const base = mkdtempSync(path.join(tmpdir(), "hub-status-"));
    const a = instance(base, "a"), b = instance(base, "b");
    mkdirSync(path.join(base, "not-an-instance"));
    expect(findInstances([base], base)).toEqual([a, b]);
    expect(findInstances([], path.join(a, "projects"), path.join(base, "core"))).toEqual([a, b]);
    expect(findInstances([path.join(base, "nowhere")], base)).toEqual([]);
  });

  it("reports pin, projects, drafts waiting and ports of one instance; read only", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "hub-status-"));
    const home = instance(base, "saas", { drafts: ["ready", "ready", "sent"], config: { admin_port: 5174, api_port: 4318 } });
    const s = await instanceStatus(home, { git: () => undefined, busy: async (p) => p === 5174 });
    expect(s).toMatchObject({ name: "saas", pin: "v0.1.0", follows: false, core: "missing", drift: false, drafts: { ready: 2, sent: 1 }, ports: { admin: 5174, api: 4318 }, running: true });
    expect(s.projects).toEqual([{ slug: "p", status: "draft" }]);
  });

  it("says follows main, no database, and a core that differs from its pin", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "hub-status-"));
    const home = path.join(base, "x");
    put(path.join(home, "core.version"), "# follows: main\nabcdef0123456789\n");
    put(path.join(home, "core", "hub.sh"), "");
    const git = (_: string, args: string[]) => (args[0] === "rev-parse" && args[1] === "HEAD" ? "1111111111" : args[0] === "rev-parse" ? "2222222222" : args[0] === "describe" ? undefined : "");
    const s = await instanceStatus(home, { git, busy: async () => false });
    expect(s).toMatchObject({ follows: true, drafts: null, drift: true, core: "111111111" });
    const t = statusTable([s]);
    expect(t).toContain("differs from pin");
    expect(t).toContain("(follows main)");
    expect(t).toContain("no database");
  });

  it("a real git core shows its tag", async () => {
    const base = mkdtempSync(path.join(tmpdir(), "hub-status-"));
    const home = instance(base, "t");
    const core = path.join(home, "core");
    mkdirSync(core);
    const g = (...a: string[]) => execFileSync("git", ["-C", core, ...a], { encoding: "utf8", env: { ...process.env, GIT_AUTHOR_NAME: "t", GIT_AUTHOR_EMAIL: "t@e.test", GIT_COMMITTER_NAME: "t", GIT_COMMITTER_EMAIL: "t@e.test" } });
    g("init", "-q", "-b", "main"); writeFileSync(path.join(core, "hub.sh"), ""); g("add", "-A"); g("commit", "-qm", "x"); g("tag", "v0.1.0");
    const s = await instanceStatus(home, { busy: async () => false });
    expect(s.core).toBe("v0.1.0");
    expect(s.drift).toBe(false);
  });
});
