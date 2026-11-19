import { appendFileSync, mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterAll, describe, expect, it } from "vitest";
import { agentFeedDto } from "@hub/contract/agent-feed";
import type { Repos } from "@hub/db";
import type { LogStore } from "@hub/log/store";
import { createApp } from "./app";

// P59 F1: `GET /api/projects/:slug/agent-feed` reads the tail of the session log, labelled on the server.
const repos = { projects: { get: async (s: string) => (s === "acme" ? { slug: "acme" } : null) } } as unknown as Repos;
const root = mkdtempSync(join(tmpdir(), "hub-server-agent-feed-"));
afterAll(() => rmSync(root, { recursive: true, force: true }));
const store: LogStore = { dir: join(root, "log"), secrets: join(root, "secrets"), retentionDays: 90 };
const now = () => new Date("2026-11-19T12:00:00.000Z");
const line = (o: Record<string, unknown>) => JSON.stringify({ v: 1, project: "acme", session: "6a968d65-18b3", cli: "claude", turn: "t1", ...o });

describe("GET /api/projects/:slug/agent-feed", () => {
  it("labels the project's last rows, says whether the agent waits, and carries no input or output", async () => {
    mkdirSync(join(store.dir, "acme"), { recursive: true });
    appendFileSync(
      join(store.dir, "acme", "2026-11-19.jsonl"),
      [
        line({ ts: "2026-11-19T11:59:00.000Z", kind: "prompt", data: { text: "open draft 3 for owner@example.com" } }),
        line({ ts: "2026-11-19T11:59:01.000Z", kind: "tool_call", corr: "c1", data: { tool: "mcp__hub__draft_show", input: { id: 3 } } }),
        line({ ts: "2026-11-19T11:59:02.000Z", kind: "tool_result", corr: "c1", data: { tool: "mcp__hub__draft_show", output: "{\"to\":\"owner@example.com\"}" } }),
        line({ ts: "2026-11-19T11:59:03.000Z", kind: "answer", data: { text: "Formal or friendly?" } }),
      ].join("\n") + "\n",
    );
    const app = createApp(repos, { agentLog: store, now });
    const res = await app.request("http://127.0.0.1:4317/api/projects/acme/agent-feed");
    expect(res.status).toBe(200);
    const text = await res.text();
    expect(text).not.toContain("owner@example.com");
    const feed = agentFeedDto.parse(JSON.parse(text));
    expect(feed.rows.map((r) => [r.label, r.draft])).toEqual([["asks you a question", null], ["reads draft 3", 3]]);
    expect(feed).toMatchObject({ waiting: true, turns: [{ tone: "attention" }] });
  });

  it("an unknown project is 404, a project with no log is an empty feed, and without a store the route is 404", async () => {
    const app = createApp({ projects: { get: async (s: string) => (s === "acme" || s === "quiet" ? { slug: s } : null) } } as unknown as Repos, { agentLog: store, now });
    expect((await app.request("http://127.0.0.1:4317/api/projects/nobody/agent-feed")).status).toBe(404);
    expect(agentFeedDto.parse(await (await app.request("http://127.0.0.1:4317/api/projects/quiet/agent-feed")).json())).toEqual({ rows: [], turns: [], cursor: "", waiting: false });
    expect((await createApp(repos, {}).request("http://127.0.0.1:4317/api/projects/acme/agent-feed")).status).toBe(404);
  });
});
