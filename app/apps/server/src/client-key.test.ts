import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { clientKeyDto } from "@hub/contract/client-key";
import { createRepos, openDb, type DbHandle, type Repos } from "@hub/db";
import { createApp } from "./app";

// P103 verdict 4: a client's other address (P100's identity table, kind `email`) answers with his primary key, so the
// admin replaces the address; the primary and `id-<n>` keys answer as before; an address nobody has is Not found.

const BASE = "http://127.0.0.1:4317";
let handle: DbHandle;
let repos: Repos;
let id: number;

const ask = (key: string) => createApp(repos, {}).request(`${BASE}/api/projects/acme/clients/key/${encodeURIComponent(key)}`);

beforeEach(async () => {
  handle = openDb(":memory:");
  repos = createRepos(handle.db);
  await repos.projects.replaceRegistry({ projects: [{ slug: "acme", name: "Acme", status: "active", settingsJson: "{}", hash: "acme" }], addresses: [] });
  id = await repos.clients.create({ project: "acme", email: "ana@example.com", name: "Ana" });
  await repos.messengers.addIdentifier("acme", id, "email", "ana.work@example.org");
});
afterEach(() => handle.close());

describe("GET /api/projects/:slug/clients/key/:key", () => {
  it("answers the primary key for the primary address and for id-<n>", async () => {
    expect(clientKeyDto.parse(await (await ask("ana@example.com")).json())).toEqual({ id, email: "ana@example.com", key: "ana@example.com" });
    expect(clientKeyDto.parse(await (await ask(`id-${id}`)).json()).key).toBe("ana@example.com");
  });

  it("redirects a secondary address (any case) to the primary key", async () => {
    const r = await ask("Ana.Work@example.org");
    expect(r.status).toBe(200);
    expect(clientKeyDto.parse(await r.json())).toEqual({ id, email: "ana@example.com", key: "ana@example.com" });
  });

  it("is Not found for an address nobody has", async () => {
    expect((await ask("nobody@example.com")).status).toBe(404);
  });
});
