import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Client, InMemoryTransport } from "@modelcontextprotocol/client";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { createRepos, openDb } from "@hub/db";
import type { HubMcpEnv } from "../src/mcp/ports";
import { createHubMcpServer } from "../src/mcp/server";

// P135 K3: `client_map`. The replay case of verdict 4 (rebuild, not append): the agent reads the map with client_show, sends the
// whole redrawn text, and the hub keeps exactly that text as the current map and the old one as the previous version. A text that
// fails the check is refused with its line and the old map stays; another project's client is not found; nothing is sent.

let dir: string;
let dbPath: string;
let anaId: number;
beforeEach(() => {
  dir = mkdtempSync(path.join(tmpdir(), "cm-"));
  dbPath = path.join(dir, "app.db");
  const h = openDb(dbPath);
  try {
    anaId = (h.db.$client.prepare("INSERT INTO clients (project, email, name, updated_at) VALUES ('acme', 'ana@x.example', 'Ana', '2026-11-24T00:00:00.000Z') RETURNING id").get() as { id: number }).id;
    h.db.$client.prepare("INSERT INTO clients (project, email, name, updated_at) VALUES ('other', 'bo@x.example', 'Bo', '2026-11-24T00:00:00.000Z')").run();
  } finally {
    h.close();
  }
});
afterEach(() => rmSync(dir, { recursive: true, force: true }));

const V1 = 'flowchart TD\n  c["Ana Ltd"] --> p1[Visit the flat]\n  p1 --> p1a[Viewing Tuesday offered]:::waiting\n  %% src p1: 2026-11-20 mail\n  %% src p1a: <m1@x.example>\n';
const V2 = 'flowchart TD\n  c["Ana Ltd"] --> p1[Visit the flat]\n  c --> p2[Mortgage advice]\n  p1 --> p1a[Viewing Tuesday held]:::done\n  p2 --> p2a[Broker contact sent]:::open\n  %% src p1: 2026-11-20 mail\n  %% src p1a: 2026-11-24 telegram\n  %% src p2: <m2@x.example>\n  %% src p2a: <m2@x.example>\n';
/** V2 without the viewing: p1 and p1a removed, p2 kept. */
const V3 = 'flowchart TD\n  c["Ana Ltd"] --> p2[Mortgage advice]\n  p2 --> p2a[Broker contact sent]:::open\n  %% src p2: <m2@x.example>\n  %% src p2a: <m2@x.example>\n';

async function connect(env: Partial<HubMcpEnv> = {}) {
  const h = openDb(dbPath);
  const server = createHubMcpServer(createRepos(h.db), { hubProject: "acme", focusFile: path.join(dir, "focus.json"), records: { dbPath }, now: () => new Date("2026-11-24T10:00:00.000Z"), ...env });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await server.connect(b);
  const client = new Client({ name: "test", version: "0" });
  await client.connect(a);
  const call = async (name: string, args: Record<string, unknown>) => {
    const res = await client.callTool({ name, arguments: args });
    return { isError: res.isError === true, text: (res.content as Array<{ text: string }>)[0]!.text };
  };
  return { call, close: () => h.close() };
}

describe("client_map", () => {
  it("replaces the whole map on a redraw, keeps the previous version, and client_show reads it back", async () => {
    const synced: Array<{ slug: string; email: string; source: string }> = [];
    const { call, close } = await connect({ syncClientMap: async (slug, m) => (synced.push({ slug, email: m.email, source: m.source }), { state: "synced" }) });
    try {
      expect(JSON.parse((await call("client_show", { id: anaId })).text).map).toBeNull();
      const one = await call("client_map", { client: anaId, map: V1 });
      expect(one.isError, one.text).toBe(false);
      expect(JSON.parse(one.text)).toMatchObject({ ok: true, project: "acme", clientId: anaId, versions: 1, unchanged: false, nodes: 3, notion: "synced" });
      expect(JSON.parse(one.text).diff.added.map((a: { id: string }) => a.id)).toEqual(["c", "p1", "p1a"]);
      // P136 verdict 4: p1a's label changed, so the redraw needs its reason; without one it is refused and V1 stays.
      const bare = await call("client_map", { email: "ana@x.example", map: V2 });
      expect(bare.isError).toBe(true);
      expect(bare.text).toContain("map_why_missing");
      expect(bare.text).toContain("p1a (renamed)");
      const two = await call("client_map", { email: "ana@x.example", map: V2, why: { p1a: "the viewing took place on Tuesday" } });
      expect(two.isError, two.text).toBe(false);
      expect(JSON.parse(two.text)).toMatchObject({ versions: 2, nodes: 5, diff: { renamed: [{ id: "p1a", from: "Viewing Tuesday offered", to: "Viewing Tuesday held" }], states: [{ id: "p1a", from: "waiting", to: "done" }], removed: [] } });
      expect(JSON.parse((await call("client_show", { id: anaId })).text).map.source).toBe(V2);
      const again = await call("client_map", { client: anaId, map: V2, why: { p1a: "unchanged" } });
      expect(JSON.parse(again.text)).toMatchObject({ versions: 2, unchanged: true, notion: "unchanged" });
      expect(synced).toEqual([{ slug: "acme", email: "ana@x.example", source: V1 }, { slug: "acme", email: "ana@x.example", source: V2 }]);
    } finally {
      close();
    }
    const h = openDb(dbPath);
    try {
      const m = await createRepos(h.db).clientMaps.get("acme", anaId);
      expect(m).toMatchObject({ source: V2, previous: { source: V1 }, versions: 2, sources: { p1a: ["2026-11-24 telegram"], p2: ["<m2@x.example>"] }, reasons: { p1a: "the viewing took place on Tuesday" } });
    } finally {
      h.close();
    }
  });
  it("refuses a removal without a reason and a node with no source; with the reasons the removal is stored (P136 replay case)", async () => {
    const { call, close } = await connect();
    try {
      await call("client_map", { client: anaId, map: V2.replace("Viewing Tuesday held]:::done", "Viewing Tuesday offered]:::waiting") });
      const half = await call("client_map", { client: anaId, map: V3, why: { p1: "they bought elsewhere" } });
      expect(half.text).toContain("map_why_missing");
      expect(half.text).toContain("p1a (removed)");
      const unsourced = await call("client_map", { client: anaId, map: V3.replace("  %% src p2a: <m2@x.example>\n", ""), why: { p1: "x y z", p1a: "x y z" } });
      expect(unsourced.text).toContain("map_invalid");
      expect(unsourced.text).toContain("p2a has no source");
      const ok = await call("client_map", { client: anaId, map: V3, why: { p1: "they bought a flat elsewhere", p1a: "the viewing is off with the goal", p9: "not a node" } });
      expect(ok.isError, ok.text).toBe(false);
      expect(JSON.parse(ok.text).diff.removed.map((r: { id: string }) => r.id)).toEqual(["p1", "p1a"]);
    } finally {
      close();
    }
    const h = openDb(dbPath);
    try {
      expect((await createRepos(h.db).clientMaps.get("acme", anaId))?.reasons).toEqual({ p1: "they bought a flat elsewhere", p1a: "the viewing is off with the goal" });
    } finally {
      h.close();
    }
  });
  it("refuses a map that fails the check with its line, and the old map stays", async () => {
    const { call, close } = await connect();
    try {
      await call("client_map", { client: anaId, map: V1 });
      const bad = await call("client_map", { client: anaId, map: "flowchart TD\n  c[Ana] --> p1[Visit]\n  classDef x fill:#f00\n" });
      expect(bad.isError).toBe(true);
      expect(bad.text).toContain("map_invalid");
      expect(bad.text).toContain("Line 3");
      expect(JSON.parse((await call("client_show", { id: anaId })).text).map.source).toBe(V1);
    } finally {
      close();
    }
  });
  it("finds no client of another project and none the hub did not record; without a Notion port the map stays in the Hub", async () => {
    const { call, close } = await connect();
    try {
      expect((await call("client_map", { email: "bo@x.example", map: V1 })).text).toContain("not_found");
      expect((await call("client_map", { email: "new@x.example", map: V1 })).text).toContain("not_found");
      expect(JSON.parse((await call("client_map", { client: anaId, map: V1 })).text).notion).toBe("off");
    } finally {
      close();
    }
  });
});
