import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { z } from "zod";
import { createRepos, openDb, type DbHandle } from "@hub/db";
import { createLlm, fakeTransport, type Ledger } from "../src/index";

// P78 L2 end to end: @hub/llm writing the real llm_calls table of @hub/db (a dev dependency only: the package imports no database).
let h: DbHandle;
let ledger: Ledger;
beforeEach(() => {
  h = openDb(":memory:");
  ledger = createRepos(h.db).llmCalls;
});
afterEach(() => h.close());

const quick = { sleep: async () => {}, random: () => 0 };
const Item = z.object({ ok: z.boolean() });

describe("@hub/llm on the llm_calls table", () => {
  it("writes a row per attempt (the failed ones included) with no text, and monthCost sums them", async () => {
    const transport = fakeTransport((_r, n) => (n === 0 ? { error: "upstream", status: 500, costUsd: 0 } : n === 1 ? { content: "nope", costUsd: 0.00003 } : { content: '{"ok":true}', costUsd: 0.00005 }));
    const llm = createLlm({ ledger, transport, retry: quick });
    const r = await llm.object({ task: "t", schema: Item, system: "SECRET SYSTEM TEXT", input: "client words", project: "p", source: { kind: "messenger_message" } });
    expect(r).toMatchObject({ value: { ok: true }, attempts: 3, costMicroUsd: 80 });
    const rows = h.db.$client.prepare("select * from llm_calls order by id").all();
    expect(rows).toHaveLength(3);
    expect(JSON.stringify(rows)).not.toMatch(/SECRET|client words|nope/);
    expect(rows.map((x) => (typeof x === "object" && x !== null && "outcome" in x ? x.outcome : null))).toEqual(["upstream", "invalid", "ok"]);
    expect(await llm.monthCost("p")).toBe(80);
    expect(await llm.monthCost()).toBe(80);
    expect(await llm.monthCost("other")).toBe(0);
  });
});
