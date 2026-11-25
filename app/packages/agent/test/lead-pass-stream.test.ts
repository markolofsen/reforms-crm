import { describe, expect, it } from "vitest";
import { leadPassMcp, leadPassPrompt, leadStream } from "../src/lead-pass";

// P147 L4: a lead turn's stream (the decision counts only when the hub answered it) and its files (bound to the lead and the pass).

const line = (o: unknown) => JSON.stringify(o);

describe("leadStream", () => {
  it("takes the decision of an answered lead_decide, never of a refused one", () => {
    const s = leadStream();
    s.push(line({ type: "system", subtype: "init", mcp_servers: [{ name: "hub", status: "connected" }], tools: ["mcp__hub__lead_decide"] }));
    s.push(line({ type: "assistant", message: { content: [{ type: "tool_use", id: "a", name: "mcp__hub__lead_decide", input: { decision: "spam" } }] } }));
    s.push(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "a", is_error: true, content: '{"error":"lead_other"}' }] } }));
    expect(s.done().decision).toBeNull();
    s.push(line({ type: "assistant", message: { content: [{ type: "tool_use", id: "b", name: "mcp__hub__lead_decide", input: { decision: "reply" } }] } }));
    s.push(line({ type: "user", message: { content: [{ type: "tool_result", tool_use_id: "b", content: '{"decision":"reply"}' }] } }));
    s.push(line({ type: "result", is_error: false, total_cost_usd: 0.01, result: "done" }));
    expect(s.done()).toMatchObject({ decision: "reply", init: { hub: "connected" }, final: { costUsd: 0.01 } });
  });

  it("the turn's hub mcp is bound to the project, the lead and the pass; the prompt marks the data", () => {
    const turn = { project: "acme", pageId: "a".repeat(32), passId: 7, actionId: "t-1", context: "Lead aaa: X" };
    const env = (leadPassMcp({ paths: { home: "/h", hubBin: "/h/hub" }, nodeBin: "/n", turn, capability: "cap" }) as { mcpServers: { hub: { env: Record<string, string> } } }).mcpServers.hub.env;
    expect(env).toMatchObject({ HUB_PROJECT: "acme", HUB_LEAD_PAGE: "a".repeat(32), HUB_LEAD_PASS: "7" });
    expect(leadPassPrompt(turn)).toContain("----- DATA -----\nLead aaa: X\n----- END DATA -----");
  });
});
