import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientMapDto, stuckClientsDto } from "@hub/contract/client-map";
import { rankStuck } from "../src/mail/client-map-routes";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { testApp } from "./support/runtime";

// P135 K2: the Map sheet's read. A client with no map answers nulls; a redraw answers the new text and the one before it;
// another project's client and a bad id are Not found.

const BASE = "http://127.0.0.1:4317";
let handle: DbHandle;
let repos: Repos;
let id: number;

const ask = (slug: string, client: string | number) => testApp(repos, {}).request(`${BASE}/api/projects/${slug}/clients/${client}/map`);

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "acme", name: "Acme", status: "active", settingsJson: "{}", hash: "acme" }], addresses: [] });
  id = await repos.clients.create({ project: "acme", email: "ana@example.com", name: "Ana" });
});
afterEach(() => handle.close());

describe("GET /api/projects/:slug/clients/:id/map", () => {
  it("answers nulls before the first map, then the current text and the previous one", async () => {
    expect(clientMapDto.parse(await (await ask("acme", id)).json())).toEqual({ clientId: id, name: "Ana", email: "ana@example.com", source: null, updatedAt: null, previous: null, versions: 0, sources: null, reasons: null });
    await repos.clientMaps.save("acme", id, "flowchart TD\n  c[Ana] --> p1[Visit]:::open\n", new Date("2026-11-20T10:00:00.000Z"));
    await repos.clientMaps.save("acme", id, "flowchart TD\n  c[Ana] --> p1[Visit]:::done\n  %% src p1: 2026-11-21 mail\n", new Date("2026-11-21T10:00:00.000Z"), { sources: { p1: ["2026-11-21 mail"] }, reasons: { p2: "dropped: they found a flat" } });
    const m = clientMapDto.parse(await (await ask("acme", id)).json());
    expect(m).toMatchObject({ updatedAt: "2026-11-21T10:00:00.000Z", versions: 2, sources: { p1: ["2026-11-21 mail"] }, reasons: { p2: "dropped: they found a flat" } });
    expect(m.previous?.source).toContain(":::open");
  });
  it("is Not found for another project's client and for a bad id", async () => {
    expect((await ask("other", id)).status).toBe(404);
    expect((await ask("acme", 9999)).status).toBe(404);
    expect((await ask("acme", "abc")).status).toBe(400);
  });
});

// P136 Q7: Overview's "Where we are stuck" for one project.
describe("GET /api/projects/:slug/client-maps/stuck", () => {
  const stuck = async (slug: string) => stuckClientsDto.parse(await (await testApp(repos, {}).request(`${BASE}/api/projects/${slug}/client-maps/stuck`)).json());
  it("lists a client with a blocked node, or one waiting 7 days or more, and nobody else", async () => {
    const day = 86_400_000;
    const bo = await repos.clients.create({ project: "acme", email: "bo@example.com", name: "Bo" });
    await repos.clients.create({ project: "acme", email: "cy@example.com", name: "Cy" });
    await repos.clientMaps.save("acme", id, "flowchart TD\n  c[Ana] --> p1[Bank answer]:::waiting\n", new Date(Date.now() - 10 * day));
    await repos.clientMaps.save("acme", id, "flowchart TD\n  c[Ana] --> p1[Bank answer]:::waiting\n  c --> p2[Visit]:::done\n", new Date(Date.now() - 2 * day));
    await repos.clientMaps.save("acme", bo, "flowchart TD\n  c[Bo] --> p1[Contract]:::blocked\n", new Date(Date.now() - day));
    const r = await stuck("acme");
    expect(r.waitingDays).toBe(7);
    expect(r.clients.map((c) => [c.name, c.nodes.map((n) => `${n.id}:${n.state}`)])).toEqual([["Bo", ["p1:blocked"]], ["Ana", ["p1:waiting"]]]);
    expect(Date.parse(r.clients[1]!.nodes[0]!.since)).toBeLessThan(Date.now() - 9 * day);
    expect((await stuck("other")).clients).toEqual([]);
  });
  it("ranks blocked first, then the oldest wait", () => {
    const row = (name: string, state: "blocked" | "waiting", since: string) => ({ clientId: 1, name, email: `${name}@x`, nodes: [{ id: "p1", label: "L", state, since }] });
    expect(rankStuck([row("a", "waiting", "2026-11-10"), row("b", "waiting", "2026-11-01"), row("c", "blocked", "2026-11-20")]).map((r) => r.name)).toEqual(["c", "b", "a"]);
  });
});
