import { QueryClient } from "@tanstack/react-query";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { renderToStaticMarkup } from "react-dom/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ConnectionDto, ConnectionsDto } from "@hub/contract/connections";
import { ConnectionRow } from "../src/features/settings/connections/connection-row";
import { SecretForm } from "../src/features/settings/connections/secret-form";
import { CONNECTIONS_KEY } from "../src/features/settings/connections/use-connections";
import { ApiFailure } from "../src/lib/api/client";
import { connectionsApi } from "../src/lib/api/connections";

// A fake key. The page may send it to the server; nothing it keeps, renders or reports may hold it.
const SECRET = "ntn_FAKEBROWSERSECRET1234567890";
const row = (over: Partial<ConnectionDto> = {}): ConnectionDto => ({ id: "notion:notion-token", kind: "notion", label: "Notion", secret: { state: "stored", changedAt: "2026-11-17T10:00:00Z" }, identity: null, usedBy: ["alpha"], can: ["test", "set", "remove"], check: { state: "never" }, ...over });
const reply = (r: unknown, status = 200) => vi.fn(async () => new Response(JSON.stringify(r), { status }));

afterEach(() => vi.unstubAllGlobals());

describe("a key in the browser", () => {
  it("goes to the server in the request body and comes back as a row without it; nothing cached holds it", async () => {
    const fetchMock = reply(row());
    vi.stubGlobal("fetch", fetchMock);
    const qc = new QueryClient();
    const list: ConnectionsDto = { instance: "hub", connections: [row({ secret: { state: "missing" }, can: ["set"] })], mail: [], mailRead: { state: "answered", fix: null } };
    qc.setQueryData(CONNECTIONS_KEY, list);
    const saved = await connectionsApi.setSecret("notion:notion-token", { value: SECRET });
    qc.setQueryData<ConnectionsDto>(CONNECTIONS_KEY, (old) => old && { ...old, connections: old.connections.map((c) => (c.id === saved.id ? saved : c)) });
    const [url, init] = fetchMock.mock.calls[0] as unknown as [string, { method: string; body: string }];
    expect(url).not.toContain(SECRET);
    expect(init.method).toBe("PUT");
    expect(init.body).toContain(SECRET);
    const held = JSON.stringify([qc.getQueryCache().getAll().map((q) => [q.queryKey, q.state.data]), qc.getMutationCache().getAll().map((m) => [m.state.variables, m.state.data])]);
    expect(held).not.toContain(SECRET);
  });

  it("a reply that carries a value is refused by the contract, so it can never reach the cache", async () => {
    vi.stubGlobal("fetch", reply({ ...row(), value: SECRET }));
    await expect(connectionsApi.setSecret("notion:notion-token", { value: SECRET })).rejects.toThrow();
  });

  it("a refusal shows the server's sentence, which holds no value", async () => {
    vi.stubGlobal("fetch", reply({ error: "Not stored: that does not look like a token.", code: "invalid" }, 400));
    const e = await connectionsApi.setSecret("notion:notion-token", { value: "bad" }).catch((x: unknown) => x);
    expect(e).toBeInstanceOf(ApiFailure);
    expect(e instanceof ApiFailure && e.message).toBe("Not stored: that does not look like a token.");
  });

  it("the form is write-only: a password field the browser does not remember, no value in the markup", () => {
    const tok = renderToStaticMarkup(<SecretForm busy={false} id="notion:notion-token" onClose={() => {}} onSave={async () => true} what="Integration token" />);
    expect(tok).toContain('type="password"');
    expect(tok).toContain('autoComplete="new-password"');
    expect(tok).not.toMatch(/value="[^"]/);
  });

  it("a stored row offers Replace and Remove, a missing one only Set, an environment one no Remove; the forms start closed", () => {
    const html = (r: ConnectionDto) => renderToStaticMarkup(<ConnectionRow actions={{ test: () => {}, save: async () => true, remove: async () => true }} busy={false} locked={false} now={0} row={r} />);
    const stored = html(row());
    expect(stored).toContain("Replace key");
    expect(stored).toContain("Remove");
    expect(stored).not.toContain("<form");
    expect(html(row({ secret: { state: "missing" }, can: ["set"] }))).toContain("Set key");
    expect(html(row({ secret: { state: "from-env" }, can: ["test"] }))).not.toContain("Remove");
  });

  it("the page's hook keeps a key out of a mutation's variables: it does not use useMutation", () => {
    expect(readFileSync(join(import.meta.dirname, "../src/features/settings/connections/use-connections.ts"), "utf8")).not.toContain("useMutation");
  });
});
