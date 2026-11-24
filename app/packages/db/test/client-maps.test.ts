import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { openDb, type DbHandle } from "../src/client";
import { createRepos, type Repos } from "../src/repos";

// P135 K2 (migration 0036): the client map is the current text on the client row and every version in `client_maps`.
let h: DbHandle;
let repos: Repos;
beforeEach(() => {
  h = openDb(":memory:");
  repos = createRepos(h.db);
});
afterEach(() => h.close());

const A = "flowchart TD\n  c[Ana] --> p1[Visit]:::open\n";
const B = "flowchart TD\n  c[Ana] --> p1[Visit]:::done\n  c --> p2[Offer]:::waiting\n";

describe("clientMaps", () => {
  it("a client has no map until one is saved", async () => {
    const id = await repos.clients.create({ project: "p", email: "ana@x.test", name: "Ana" });
    expect(await repos.clientMaps.get("p", id)).toMatchObject({ source: null, updatedAt: null, previous: null, versions: 0 });
  });
  it("a redraw replaces the current text and keeps the one before it; the same text is not a new version", async () => {
    const id = await repos.clients.create({ project: "p", email: "ana@x.test", name: "Ana" });
    const one = await repos.clientMaps.save("p", id, A, new Date("2026-11-20T10:00:00.000Z"));
    expect(one).toMatchObject({ unchanged: false, versions: 1, updatedAt: "2026-11-20T10:00:00.000Z" });
    await repos.clientMaps.save("p", id, B, new Date("2026-11-21T10:00:00.000Z"));
    expect(await repos.clientMaps.save("p", id, B, new Date("2026-11-22T10:00:00.000Z"))).toMatchObject({ unchanged: true, versions: 2, updatedAt: "2026-11-21T10:00:00.000Z" });
    const m = await repos.clientMaps.get("p", id);
    expect(m).toMatchObject({ source: B, updatedAt: "2026-11-21T10:00:00.000Z", previous: { source: A, at: "2026-11-20T10:00:00.000Z" }, versions: 2 });
  });
  it("another project's client is not found, and nothing is written for it", async () => {
    const id = await repos.clients.create({ project: "p", email: "ana@x.test", name: "Ana" });
    expect(await repos.clientMaps.save("q", id, A)).toBeNull();
    expect(await repos.clientMaps.get("q", id)).toBeNull();
    expect((await repos.clientMaps.get("p", id))?.versions).toBe(0);
  });
});
