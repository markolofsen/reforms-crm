import { afterEach, describe, expect, it } from "vitest";
import { HUB_MCP_TOOLS } from "../src/mcp/server";
import { connect, fakePorts, REPLAY_CASES, replay, type FakePorts } from "../src/testing";

// P129 verdict 10 (A7): every documented path of the first five cases runs on the real tools and fake ports, with no refusal
// it does not expect, and leaves the Hub rows it says. The guard's half is the installer's replay test (it owns the guard).

let open: FakePorts[] = [];
afterEach(() => {
  for (const p of open) p.close();
  open = [];
});
const ports = (o?: Parameters<typeof fakePorts>[0]) => {
  const p = fakePorts(o);
  open.push(p);
  return p;
};

describe("@hub/agent/testing", () => {
  it("fakePorts and connect give the whole hub mcp, bound to the fixture project", async () => {
    const hub = await connect(ports());
    expect(await hub.tools()).toEqual([...HUB_MCP_TOOLS].sort());
    expect((await hub.call("project_show")).json).toMatchObject({ project: "acme", testMode: { on: false } });
  });
  it("test mode: the allow-list is the test addresses project_show names", async () => {
    const hub = await connect(ports({ recipients: { test: ["owner.test@example.com"] } }));
    expect((await hub.call("project_show")).json.testMode).toEqual({ on: true, addresses: ["owner.test@example.com"] });
  });
  it("owner_request is verified against the fake session log", async () => {
    const p = ports();
    const hub = await connect(p);
    const words = { kind: "new", to: "x@y.example", subject: "Hi", content: "Hello.", owner_request: "words he never typed here", record: { notion: { kind: "none" } } };
    expect((await hub.call("draft_write", words)).json.error).toBe("owner_words_not_found");
  });
});

describe("replay (P129 verdict 10): the first five cases", () => {
  for (const c of REPLAY_CASES) {
    it(c.title, async () => {
      const r = await replay(c, ports(c.ports));
      expect(r.unexpected, JSON.stringify(r.results)).toEqual([]);
      expect(r.drafts).toEqual([...c.drafts].sort((a, b) => a.email.localeCompare(b.email)));
    });
  }
});
