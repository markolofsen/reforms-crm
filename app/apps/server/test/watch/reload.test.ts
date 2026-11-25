import { cpSync, mkdirSync, mkdtempSync, readFileSync, utimesSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { afterEach, describe, expect, it } from "vitest";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { createLlm, fakeTransport, memoryLedger } from "@hub/llm";
import { startWatch, type WatchDomain, type WatchProject } from "../../src/watch/start";

// P153 (plan verdicts 4-6, D2): watch.md and the lens's lens.json are taken while the server runs. A valid change swaps what runs
// and writes one Activity line; an invalid one keeps what runs and says why; a change to the lens's code waits for a restart.
// No Telegram, no timers: `reload()` is the 5-second check, called by hand.

const fixture = resolve(import.meta.dirname, "../../../../packages/watch/test/fixtures/packages/watch-acme");
let domain: WatchDomain | undefined;
let db: DbHandle | undefined;
afterEach(() => {
  domain?.stop();
  db?.close();
});

const list = (groups: string[], extra = "") => `# Watch\n\n| Setting | Value |\n|---|---|\n| lens | watch-acme |\n${extra}\n## Groups\n\n${groups.map((g) => `- @${g}`).join("\n")}\n`;
let tick = Date.now() / 1000;
/** Writes a file with a modification time later than any before it (the check compares stamps). */
const write = (file: string, text: string) => {
  writeFileSync(file, text);
  tick += 10;
  utimesSync(file, tick, tick);
};

async function setup(o: { brokenLens?: boolean } = {}) {
  const home = mkdtempSync(join(tmpdir(), "hub-watch-reload-"));
  const projects = join(home, "projects");
  const packages = join(home, "packages");
  mkdirSync(join(projects, "acme"), { recursive: true });
  cpSync(fixture, join(packages, "watch-acme"), { recursive: true });
  write(join(projects, "acme", "watch.md"), list(["garden_talk"]));
  const good = readFileSync(join(packages, "watch-acme", "lens.json"), "utf8");
  if (o.brokenLens) write(join(packages, "watch-acme", "lens.json"), "{ broken");
  db = openDb(join(home, "app.db"));
  const repos = createRepos(db.db);
  const llm = createLlm({ ledger: memoryLedger(), transport: fakeTransport(() => ({ content: "{}" })) });
  domain = await startWatch({ repos, paths: { projects, instancePackages: packages, watch: join(home, "data", "watch") }, telegram: () => undefined, bump: () => undefined, llm, timers: false });
  const ready = (): Extract<WatchProject, { state: "ready" }> => {
    const p = domain?.project("acme");
    if (p?.state !== "ready") throw new Error(`not ready: ${p ? p.state : "none"}`);
    return p;
  };
  const lines = async () => (await repos.runs.activity("acme")).rows.map((r) => `${r.outcome}: ${r.why ?? ""} | ${r.who}`);
  const lensJson = join(packages, "watch-acme", "lens.json");
  return { home, projects, packages, ready, lines, watchMd: join(projects, "acme", "watch.md"), lensJson, good, data: JSON.parse(good) };
}

describe("live reload of a watch list and its lens", () => {
  it("takes a valid watch.md while running and writes one Activity line", async () => {
    const s = await setup();
    write(s.watchMd, list(["garden_talk", "tools_and_more", "shed_people"], "| on | yes |\n"));
    await domain?.reload();
    expect(s.ready().config).toMatchObject({ on: true, groups: ["garden_talk", "tools_and_more", "shed_people"] });
    expect(s.ready().notice).toBeNull();
    expect(s.ready().store.groups().map((g) => g.username).sort()).toEqual(["garden_talk", "shed_people", "tools_and_more"]);
    expect(await s.lines()).toHaveLength(1);
    expect((await s.lines())[0]).toMatch(/^changed: watch.md changed.* \| \+2 groups \(@tools_and_more @shed_people\), switched on$/);
    // Nothing changed: no line.
    await domain?.reload();
    expect(await s.lines()).toHaveLength(1);
  });

  it("keeps the running list when the new one is invalid or over the cap, and says why", async () => {
    const s = await setup();
    write(s.watchMd, list(["garden_talk"], "| poll_minutes | 1 |\n"));
    await domain?.reload();
    expect(s.ready().config.pollMinutes).toBe(5);
    expect(s.ready().notice).toMatch(/^watch.md: .*at least 5 minutes.*The running list is kept/);
    write(s.watchMd, list(Array.from({ length: 16 }, (_, k) => `garden_group_${k}`)));
    await domain?.reload();
    expect(s.ready().config.groups).toEqual(["garden_talk"]);
    expect(s.ready().notice).toMatch(/at most 15/);
    // Fixed: taken, the notice cleared.
    write(s.watchMd, list(["garden_talk", "tools_and_more"]));
    await domain?.reload();
    expect(s.ready().config.groups).toEqual(["garden_talk", "tools_and_more"]);
    expect(s.ready().notice).toBeNull();
  });

  it("takes a new lens.json (version, triggers) for the next windows and keeps the old windows; an invalid one is refused", async () => {
    const s = await setup();
    s.ready().store.recordWindow({ windowKey: "w100o20:garden_talk:1-100", groupUsername: "garden_talk", firstMessageId: 1, lastMessageId: 100, messages: 100, taskVersion: 1, model: "m", costMicroUsd: 1, topics: [], mood: null, firstAt: "2026-11-20T09:00:00.000Z", lastAt: "2026-11-20T10:00:00.000Z" }, [], new Date());
    const triggers = [...s.data.triggers.slice(0, 2), { value: "rusty_tool", label: "Rusty tool" }, s.data.triggers[2]];
    write(s.lensJson, JSON.stringify({ ...s.data, version: 2, triggers }));
    await domain?.reload();
    expect(s.ready().lens.task.version).toBe(2);
    expect(s.ready().lens.triggers).toContain("rusty_tool");
    expect(s.ready().store.windowCount("2000-01-01")).toBe(1);
    expect((await s.lines())[0]).toMatch(/\| v1 to v2, \+1 trigger \(rusty_tool\)$/);
    write(s.lensJson, JSON.stringify({ ...s.data, version: 0 }));
    await domain?.reload();
    expect(s.ready().lens.task.version).toBe(2);
    expect(s.ready().notice).toMatch(/^lens watch-acme: lens.json: version.*The running lens is kept/);
  });

  it("a change to the lens's code is not loaded: the page says to restart", async () => {
    const s = await setup();
    const code = join(s.packages, "watch-acme", "src", "index.ts");
    write(code, `${readFileSync(code, "utf8")}\n// edited\n`);
    await domain?.reload();
    expect(s.ready().notice).toMatch(/code of lens watch-acme changed: restart the server/);
    expect(s.ready().lens.task.version).toBe(1);
  });

  it("a project parked on a broken lens.json starts once the file is fixed", async () => {
    const s = await setup({ brokenLens: true });
    expect(domain?.project("acme")).toMatchObject({ state: "lens", reason: expect.stringMatching(/lens.json is not JSON/) });
    write(s.lensJson, s.good);
    await domain?.reload();
    expect(s.ready().lens.id).toBe("acme");
    expect(await s.lines()).toHaveLength(1);
  });
});
