import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientMapDto } from "@hub/contract/client-map";
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
    expect(clientMapDto.parse(await (await ask("acme", id)).json())).toEqual({ clientId: id, name: "Ana", source: null, updatedAt: null, previous: null, versions: 0 });
    await repos.clientMaps.save("acme", id, "flowchart TD\n  c[Ana] --> p1[Visit]:::open\n", new Date("2026-11-20T10:00:00.000Z"));
    await repos.clientMaps.save("acme", id, "flowchart TD\n  c[Ana] --> p1[Visit]:::done\n", new Date("2026-11-21T10:00:00.000Z"));
    const m = clientMapDto.parse(await (await ask("acme", id)).json());
    expect(m).toMatchObject({ source: "flowchart TD\n  c[Ana] --> p1[Visit]:::done\n", updatedAt: "2026-11-21T10:00:00.000Z", versions: 2 });
    expect(m.previous?.source).toContain(":::open");
  });
  it("is Not found for another project's client and for a bad id", async () => {
    expect((await ask("other", id)).status).toBe(404);
    expect((await ask("acme", 9999)).status).toBe(404);
    expect((await ask("acme", "abc")).status).toBe(400);
  });
});
